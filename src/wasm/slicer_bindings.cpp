// SPDX-License-Identifier: AGPL-3.0-or-later
// C++ embind wrapper around PrusaSlicer's libslic3r API.
// Exposes a minimal slicing API for use from JavaScript/WASM workers.

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <emscripten.h>

#include <string>
#include <sstream>
#include <memory>
#include <fstream>
#include <cstring>
#include <stdexcept>
#include <vector>
#include <cstdlib>
#include <typeinfo>

// Stub TBB scalable allocator symbols for WASM.
// TBB's scalable_malloc/scalable_free are normally provided by libtbbmalloc,
// but for WASM we just forward to standard malloc/free.
extern "C" {
    void* scalable_malloc(size_t size) { return std::malloc(size); }
    void  scalable_free(void* ptr) { std::free(ptr); }
    void* scalable_realloc(void* ptr, size_t size) { return std::realloc(ptr, size); }
    void* scalable_calloc(size_t nelem, size_t elsize) { return std::calloc(nelem, elsize); }
}

// Stub QOI image encoder for WASM.
// PrusaSlicer uses qoi_encode for generating thumbnail images in G-code.
// Thumbnails are not needed in the WASM slicing pipeline, so we stub it out.
extern "C" {
    void* qoi_encode(const void* /*data*/, const void* /*desc*/, int* out_len) {
        if (out_len) *out_len = 0;
        return nullptr;
    }
}

// Stub pthread_setname_np — PrusaSlicer's Thread.cpp calls this to name threads.
// Even without -pthread, TBB headers may reference it.
extern "C" {
    int pthread_setname_np(unsigned long /*thread*/, const char* /*name*/) {
        return 0; // success, no-op
    }
}
#include <boost/optional/optional.hpp>

#include "libslic3r/Model.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Exception.hpp"
#include "libslic3r/Semver.hpp"
#include "libslic3r/Format/STL.hpp"
#include "libslic3r/Format/3mf.hpp"

namespace {

// Temporary file helper for WASM virtual filesystem
class TempFile {
public:
    TempFile(const std::string& ext) {
        static int counter = 0;
        m_path = "/tmp/slicer_tmp_" + std::to_string(counter++) + ext;
    }
    ~TempFile() { std::remove(m_path.c_str()); }
    const std::string& path() const { return m_path; }

    void write(const std::string& data) {
        std::ofstream f(m_path, std::ios::binary);
        if (!f) throw std::runtime_error("Failed to write temp file: " + m_path);
        f.write(data.data(), data.size());
    }
private:
    std::string m_path;
};

} // anonymous namespace


class WasmSlicer {
public:
    WasmSlicer() {
        // Initialize default config with PrusaSlicer defaults
        m_config.apply(Slic3r::FullPrintConfig::defaults());
    }

    ~WasmSlicer() = default;

    // Load an STL model from a file path on the Emscripten virtual filesystem.
    // The caller (JS side) writes binary data to the FS first via Module.FS.writeFile(),
    // then passes the path here. This avoids embind's UTF-8 string marshaling which
    // corrupts binary data (bytes >127 get multi-byte encoded).
    void loadSTLFile(const std::string& path) {
        m_model = Slic3r::Model();
        if (!Slic3r::load_stl(path.c_str(), &m_model)) {
            throw std::runtime_error("Failed to load STL file: " + path);
        }

        if (m_model.objects.empty()) {
            throw std::runtime_error("No objects found in STL file");
        }

        // Ensure each object has at least one instance (load_stl may not create one)
        for (auto* obj : m_model.objects) {
            if (obj->instances.empty()) {
                obj->add_instance();
            }
        }

        m_model_loaded = true;
        m_needs_centering = true;
        m_from_3mf = false;
    }

    // Load a 3MF model from a file path on the Emscripten virtual filesystem.
    // The caller (JS side) writes binary data to the FS first via Module.FS.writeFile(),
    // then passes the path here. This avoids embind's UTF-8 string marshaling which
    // corrupts binary data (bytes >127 get multi-byte encoded).
    void load3MFFile(const std::string& path) {
        Slic3r::DynamicPrintConfig config_from_3mf;
        Slic3r::ConfigSubstitutionContext subst_ctx(Slic3r::ForwardCompatibilitySubstitutionRule::EnableSilent);
        m_model = Slic3r::Model();
        boost::optional<Slic3r::Semver> generator_version;
        if (!Slic3r::load_3mf(path.c_str(), config_from_3mf, subst_ctx, &m_model, false, generator_version)) {
            throw std::runtime_error("Failed to load 3MF file: " + path);
        }

        if (m_model.objects.empty()) {
            throw std::runtime_error("No objects found in 3MF file");
        }

        // Multi-color 3MF from OpenSCAD: each color is a separate object.
        // PrusaSlicer validates each object independently and requires every
        // object to have extrusions on the first layer. For stacked multi-color
        // models (e.g. red cube Z=0..10, white cube Z=10..20), the top object
        // has no geometry at Z=0, causing "no extrusions in the first layer".
        //
        // Fix: merge all objects into a single object with multiple volumes,
        // each volume assigned to its original extruder. PrusaSlicer treats
        // volumes within one object as a single unit for first-layer validation.
        if (m_model.objects.size() > 1) {
            auto* merged = m_model.objects[0];
            if (merged->instances.empty()) {
                merged->add_instance();
            }

            // Each volume in the first object keeps its existing extruder assignment.
            // If no extruder is set, assign extruder 1.
            int extruder_idx = 1;
            for (auto* vol : merged->volumes) {
                if (vol->config.get().empty() || !vol->config.get().has("extruder")) {
                    vol->config.set("extruder", extruder_idx);
                }
            }

            // Compute the primary object's max Z in merged-object coordinates.
            // This is used to prevent secondary volumes from protruding above
            // the primary body due to CSG overlap artifacts (+0.01mm) from OpenSCAD.
            double primary_max_z = -std::numeric_limits<double>::max();
            for (auto* vol : merged->volumes) {
                auto bb = vol->mesh().bounding_box();
                double vol_z = bb.max.z() + vol->get_offset().z();
                if (vol_z > primary_max_z)
                    primary_max_z = vol_z;
            }

            // Move volumes from remaining objects into the first object,
            // applying instance transform offsets so vertices stay in correct positions.
            for (size_t i = 1; i < m_model.objects.size(); ++i) {
                auto* src_obj = m_model.objects[i];
                extruder_idx = static_cast<int>(i) + 1;

                // Compute relative offset between source and target instance transforms
                Slic3r::Vec3d src_offset(0, 0, 0);
                Slic3r::Vec3d dst_offset(0, 0, 0);
                if (!src_obj->instances.empty())
                    src_offset = src_obj->instances[0]->get_offset();
                if (!merged->instances.empty())
                    dst_offset = merged->instances[0]->get_offset();
                Slic3r::Vec3d delta = src_offset - dst_offset;

                // Check if any volume from this source object would protrude
                // above the primary body after applying the delta. If so, reduce
                // delta.z() so the highest point aligns with primary_max_z.
                // This corrects CSG overlap artifacts from OpenSCAD where
                // secondary color volumes have +0.01mm overlap for clean booleans.
                double src_max_z = -std::numeric_limits<double>::max();
                for (auto* vol : src_obj->volumes) {
                    auto bb = vol->mesh().bounding_box();
                    double vol_z = bb.max.z() + vol->get_offset().z() + delta.z();
                    if (vol_z > src_max_z)
                        src_max_z = vol_z;
                }
                double overshoot = src_max_z - primary_max_z;
                if (overshoot > 1e-6) {
                    delta.z() -= overshoot;
                }

                for (auto* vol : src_obj->volumes) {
                    auto* new_vol = merged->add_volume(*vol);
                    // Apply the instance offset difference to the volume
                    // so it ends up in the correct position within the merged object
                    if (delta.norm() > 1e-6) {
                        new_vol->translate(delta);
                    }

                    new_vol->config.set("extruder", extruder_idx);
                }
            }

            // Remove all objects except the merged one
            while (m_model.objects.size() > 1) {
                m_model.delete_object(m_model.objects.size() - 1);
            }
        }

        // Ensure the merged object has at least one instance
        for (auto* obj : m_model.objects) {
            if (obj->instances.empty()) {
                obj->add_instance();
            }
        }

        m_model_loaded = true;
        m_needs_centering = true;
        m_from_3mf = true;
    }

    // Set a single PrusaSlicer config key-value pair.
    // Keys and values follow PrusaSlicer .ini format.
    // Example: setConfigString("layer_height", "0.2")
    void setConfigString(const std::string& key, const std::string& value) {
        try {
            m_config.set_deserialize_strict(key, value);
        } catch (const Slic3r::UnknownOptionException&) {
            // Silently ignore unknown options — our config map may include
            // keys that don't exist in this PrusaSlicer version.
        }
    }

    // Run the slicing pipeline: validate → process → done.
    // Throws on validation or slicing errors.
    void slice() {
        if (!m_model_loaded) {
            throw std::runtime_error("No model loaded. Call loadSTL() or load3MF() first.");
        }

        try {
            m_print = std::make_unique<Slic3r::Print>();

            // Center model instances on the bed if needed
            if (m_needs_centering) {
                EM_ASM({ console.log('[slicer-wasm] Centering model on bed...'); });
                // Get bed center from config's bed_shape
                auto* bed_shape_opt = m_config.option<Slic3r::ConfigOptionPoints>("bed_shape");
                if (bed_shape_opt && !bed_shape_opt->values.empty()) {
                    Slic3r::Vec2d center(0, 0);
                    for (const auto& pt : bed_shape_opt->values) {
                        center.x() += pt.x();
                        center.y() += pt.y();
                    }
                    center /= static_cast<double>(bed_shape_opt->values.size());
                    m_model.center_instances_around_point(center);
                } else {
                    // Fallback: center around origin
                    m_model.center_instances_around_point({0, 0});
                }
                m_needs_centering = false;
            }

            // Ensure the model sits on the print bed (Z >= 0).
            // OpenSCAD models often use center=true which places geometry below Z=0.
            // Without this, PrusaSlicer clips the below-bed portion.
            if (m_from_3mf) {
                // For 3MF files: multi-color 3MF objects have correct world-space
                // positions from OpenSCAD's per-color rendering. Calling ensure_on_bed()
                // per-object would drop each color's mesh to Z=0 independently,
                // destroying stacked assemblies. Instead, find the global minimum Z
                // across all objects and translate the entire assembly uniformly.
                double global_min_z = std::numeric_limits<double>::max();
                for (auto* obj : m_model.objects) {
                    auto bb = obj->bounding_box_exact();
                    if (bb.min.z() < global_min_z) {
                        global_min_z = bb.min.z();
                    }
                }
                if (global_min_z != 0.0 && global_min_z != std::numeric_limits<double>::max()) {
                    m_model.translate(0, 0, -global_min_z);
                }
            } else {
                // For STL files: each object is independent, drop to bed individually.
                for (auto* obj : m_model.objects) {
                    obj->ensure_on_bed();
                }
            }

            // Auto-assign extruders to objects that don't have explicit assignment
            EM_ASM({ console.log('[slicer-wasm] Auto-assigning extruders...'); });
            for (auto* obj : m_model.objects) {
                m_print->auto_assign_extruders(obj);
            }

            // Apply model + config to the print object
            EM_ASM({ console.log('[slicer-wasm] Applying model + config...'); });
            m_print->apply(m_model, m_config);

            // Validate the print configuration
            EM_ASM({ console.log('[slicer-wasm] Validating print...'); });
            std::vector<std::string> warnings;
            auto err = m_print->validate(&warnings);
            if (!err.empty()) {
                throw std::runtime_error("Print validation failed: " + err);
            }
            for (const auto& w : warnings) {
                EM_ASM({ console.warn('[slicer-wasm] Validation warning:', UTF8ToString($0)); },
                       w.c_str());
            }

            // Run the slicing and G-code generation pipeline
            EM_ASM({ console.log('[slicer-wasm] Starting Print::process()...'); });
            m_print->process();
            EM_ASM({ console.log('[slicer-wasm] Print::process() completed successfully.'); });

            m_sliced = true;
        } catch (const Slic3r::SlicingError& e) {
            std::string msg = std::string("Slicing error: ") + e.what();
            EM_ASM({ console.error('[slicer-wasm]', UTF8ToString($0)); }, msg.c_str());
            throw std::runtime_error(msg);
        } catch (const std::exception& e) {
            std::string msg = std::string("slice() failed: ") + e.what();
            EM_ASM({ console.error('[slicer-wasm]', UTF8ToString($0)); }, msg.c_str());
            throw std::runtime_error(msg);
        } catch (...) {
            EM_ASM({ console.error('[slicer-wasm] slice() failed with unknown exception type'); });
            throw std::runtime_error("slice() failed with unknown C++ exception");
        }
    }

    // Export the sliced result as G-code string.
    // Must call slice() first.
    std::string exportGCode() {
        if (!m_sliced || !m_print) {
            throw std::runtime_error("Not sliced. Call slice() first.");
        }

        try {
            TempFile tmp(".gcode");

            EM_ASM({ console.log('[slicer-wasm] Exporting GCode...'); });
            m_print->export_gcode(tmp.path(), nullptr, nullptr);
            EM_ASM({ console.log('[slicer-wasm] GCode export completed.'); });

            // Read the generated file back
            std::ifstream f(tmp.path(), std::ios::binary | std::ios::ate);
            if (!f) {
                throw std::runtime_error("Failed to read generated G-code");
            }
            auto size = f.tellg();
            f.seekg(0, std::ios::beg);
            std::string gcode(size, '\0');
            f.read(&gcode[0], size);

            return gcode;
        } catch (const std::exception& e) {
            std::string msg = std::string("exportGCode() failed: ") + e.what();
            EM_ASM({ console.error('[slicer-wasm]', UTF8ToString($0)); }, msg.c_str());
            throw std::runtime_error(msg);
        } catch (...) {
            EM_ASM({ console.error('[slicer-wasm] exportGCode() failed with unknown exception'); });
            throw std::runtime_error("exportGCode() failed with unknown C++ exception");
        }
    }

private:
    Slic3r::Model m_model;
    Slic3r::DynamicPrintConfig m_config;
    std::unique_ptr<Slic3r::Print> m_print;
    bool m_model_loaded = false;
    bool m_needs_centering = false;
    bool m_sliced = false;
    bool m_from_3mf = false;
};


// Free-function wrappers for embind (embind works best with free functions
// or simple class bindings rather than complex C++ objects with move semantics)

EMSCRIPTEN_BINDINGS(slicer_module) {
    emscripten::class_<WasmSlicer>("WasmSlicer")
        .constructor<>()
        .function("loadSTLFile", &WasmSlicer::loadSTLFile)
        .function("load3MFFile", &WasmSlicer::load3MFFile)
        .function("setConfigString", &WasmSlicer::setConfigString)
        .function("slice", &WasmSlicer::slice)
        .function("exportGCode", &WasmSlicer::exportGCode)
        ;
}
