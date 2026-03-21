// SPDX-License-Identifier: AGPL-3.0-or-later
// JNI bindings for OrcaSlicer's libslic3r on Android.
// Mirrors the WASM slicer_bindings.cpp API but uses JNI instead of embind.
// Called from Kotlin SlicerBridge via @JavascriptInterface.

#include <jni.h>
#include <android/log.h>

#include <string>
#include <memory>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <vector>
#include <cstring>
#include <mutex>

#include "libslic3r/Model.hpp"
#include "libslic3r/PrintBase.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Exception.hpp"
#include "libslic3r/Format/STL.hpp"
#include "libslic3r/Format/3mf.hpp"

#define LOG_TAG "SlicerJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

// Native slicer state — one instance at a time.
// Protected by mutex since JNI calls come from different threads.
struct NativeSlicer {
    Slic3r::Model model;
    Slic3r::DynamicPrintConfig config;
    std::unique_ptr<Slic3r::Print> print;
    bool model_loaded = false;
    bool needs_centering = false;
    bool sliced = false;
    bool from_3mf = false;
};

std::mutex g_mutex;
std::unique_ptr<NativeSlicer> g_slicer;

// Convert jstring to std::string
std::string jstringToString(JNIEnv* env, jstring jstr) {
    if (!jstr) return "";
    const char* chars = env->GetStringUTFChars(jstr, nullptr);
    std::string result(chars);
    env->ReleaseStringUTFChars(jstr, chars);
    return result;
}

// Throw a Java RuntimeException
void throwJavaException(JNIEnv* env, const char* msg) {
    jclass cls = env->FindClass("java/lang/RuntimeException");
    if (cls) {
        env->ThrowNew(cls, msg);
    }
}

// Parse JSON config string into key-value pairs.
// Expects: {"key1": "value1", "key2": "value2", ...}
// Uses a simple parser — no external JSON library needed at JNI level.
// nlohmann_json is available via headers but adds unnecessary complexity
// for this flat string→string map.
std::vector<std::pair<std::string, std::string>> parseJsonConfig(const std::string& json) {
    std::vector<std::pair<std::string, std::string>> result;

    // Skip to first '{'
    size_t pos = json.find('{');
    if (pos == std::string::npos) return result;
    pos++;

    auto skipWhitespace = [&]() {
        while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\n' ||
               json[pos] == '\r' || json[pos] == '\t'))
            pos++;
    };

    auto parseString = [&]() -> std::string {
        skipWhitespace();
        if (pos >= json.size() || json[pos] != '"') return "";
        pos++; // skip opening quote
        std::string s;
        while (pos < json.size() && json[pos] != '"') {
            if (json[pos] == '\\' && pos + 1 < json.size()) {
                pos++;
                switch (json[pos]) {
                    case '"': s += '"'; break;
                    case '\\': s += '\\'; break;
                    case 'n': s += '\n'; break;
                    case 't': s += '\t'; break;
                    case 'r': s += '\r'; break;
                    default: s += json[pos]; break;
                }
            } else {
                s += json[pos];
            }
            pos++;
        }
        if (pos < json.size()) pos++; // skip closing quote
        return s;
    };

    while (pos < json.size()) {
        skipWhitespace();
        if (pos >= json.size() || json[pos] == '}') break;

        // Skip comma between entries
        if (json[pos] == ',') { pos++; continue; }

        std::string key = parseString();
        if (key.empty()) break;

        skipWhitespace();
        if (pos >= json.size() || json[pos] != ':') break;
        pos++; // skip ':'

        std::string value = parseString();
        result.emplace_back(std::move(key), std::move(value));
    }

    return result;
}

// Merge multi-color 3MF objects into a single object with multiple volumes.
// Same logic as slicer_bindings.cpp — see comments there for details.
void merge3MFObjects(Slic3r::Model& model) {
    if (model.objects.size() <= 1) return;

    auto* merged = model.objects[0];
    if (merged->instances.empty()) {
        merged->add_instance();
    }

    int extruder_idx = 1;
    for (auto* vol : merged->volumes) {
        if (vol->config.get().empty() || !vol->config.get().has("extruder")) {
            vol->config.set("extruder", extruder_idx);
        }
    }

    double primary_max_z = -std::numeric_limits<double>::max();
    for (auto* vol : merged->volumes) {
        auto bb = vol->mesh().bounding_box();
        double vol_z = bb.max.z() + vol->get_offset().z();
        if (vol_z > primary_max_z) primary_max_z = vol_z;
    }

    for (size_t i = 1; i < model.objects.size(); ++i) {
        auto* src_obj = model.objects[i];
        extruder_idx = static_cast<int>(i) + 1;

        Slic3r::Vec3d src_offset(0, 0, 0);
        Slic3r::Vec3d dst_offset(0, 0, 0);
        if (!src_obj->instances.empty())
            src_offset = src_obj->instances[0]->get_offset();
        if (!merged->instances.empty())
            dst_offset = merged->instances[0]->get_offset();
        Slic3r::Vec3d delta = src_offset - dst_offset;

        double src_max_z = -std::numeric_limits<double>::max();
        for (auto* vol : src_obj->volumes) {
            auto bb = vol->mesh().bounding_box();
            double vol_z = bb.max.z() + vol->get_offset().z() + delta.z();
            if (vol_z > src_max_z) src_max_z = vol_z;
        }
        double overshoot = src_max_z - primary_max_z;
        if (overshoot > 1e-6) {
            delta.z() -= overshoot;
        }

        for (auto* vol : src_obj->volumes) {
            auto* new_vol = merged->add_volume(*vol);
            if (delta.norm() > 1e-6) {
                new_vol->translate(delta);
            }
            new_vol->config.set("extruder", extruder_idx);
        }
    }

    while (model.objects.size() > 1) {
        model.delete_object(model.objects.size() - 1);
    }
}

} // anonymous namespace


extern "C" {

// ============================================================
// JNI exports for io.github.mmmaxwwwell.openscadweb.SlicerBridge
// ============================================================

JNIEXPORT void JNICALL
Java_io_github_mmmaxwwwell_openscadweb_SlicerBridge_nativeCreate(
    JNIEnv* env, jobject /* thiz */)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    LOGI("Creating native slicer instance");
    g_slicer = std::make_unique<NativeSlicer>();
    g_slicer->config.apply(Slic3r::FullPrintConfig::defaults());
}

JNIEXPORT void JNICALL
Java_io_github_mmmaxwwwell_openscadweb_SlicerBridge_nativeLoadSTL(
    JNIEnv* env, jobject /* thiz */, jstring jpath)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_slicer) {
        throwJavaException(env, "Slicer not created. Call nativeCreate() first.");
        return;
    }

    std::string path = jstringToString(env, jpath);
    LOGI("Loading STL: %s", path.c_str());

    try {
        g_slicer->model = Slic3r::Model();
        if (!Slic3r::load_stl(path.c_str(), &g_slicer->model)) {
            throwJavaException(env, ("Failed to load STL: " + path).c_str());
            return;
        }
        if (g_slicer->model.objects.empty()) {
            throwJavaException(env, "No objects found in STL file");
            return;
        }
        for (auto* obj : g_slicer->model.objects) {
            if (obj->instances.empty()) obj->add_instance();
        }
        g_slicer->model_loaded = true;
        g_slicer->needs_centering = true;
        g_slicer->from_3mf = false;
        LOGI("STL loaded: %zu objects", g_slicer->model.objects.size());
    } catch (const std::exception& e) {
        LOGE("loadSTL failed: %s", e.what());
        throwJavaException(env, e.what());
    }
}

JNIEXPORT void JNICALL
Java_io_github_mmmaxwwwell_openscadweb_SlicerBridge_nativeLoad3MF(
    JNIEnv* env, jobject /* thiz */, jstring jpath)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_slicer) {
        throwJavaException(env, "Slicer not created. Call nativeCreate() first.");
        return;
    }

    std::string path = jstringToString(env, jpath);
    LOGI("Loading 3MF: %s", path.c_str());

    try {
        Slic3r::DynamicPrintConfig config_from_3mf;
        Slic3r::ConfigSubstitutionContext subst_ctx(
            Slic3r::ForwardCompatibilitySubstitutionRule::EnableSilent);
        g_slicer->model = Slic3r::Model();

        if (!Slic3r::load_3mf(path.c_str(), config_from_3mf, subst_ctx,
                               &g_slicer->model, false)) {
            throwJavaException(env, ("Failed to load 3MF: " + path).c_str());
            return;
        }
        if (g_slicer->model.objects.empty()) {
            throwJavaException(env, "No objects found in 3MF file");
            return;
        }

        // Merge multi-color objects (same as WASM bindings)
        merge3MFObjects(g_slicer->model);

        for (auto* obj : g_slicer->model.objects) {
            if (obj->instances.empty()) obj->add_instance();
        }

        g_slicer->model_loaded = true;
        g_slicer->needs_centering = true;
        g_slicer->from_3mf = true;
        LOGI("3MF loaded: %zu objects", g_slicer->model.objects.size());
    } catch (const std::exception& e) {
        LOGE("load3MF failed: %s", e.what());
        throwJavaException(env, e.what());
    }
}

JNIEXPORT void JNICALL
Java_io_github_mmmaxwwwell_openscadweb_SlicerBridge_nativeSetConfig(
    JNIEnv* env, jobject /* thiz */, jstring jconfigJson)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_slicer) {
        throwJavaException(env, "Slicer not created. Call nativeCreate() first.");
        return;
    }

    std::string json = jstringToString(env, jconfigJson);
    LOGI("Setting config (%zu bytes)", json.size());

    try {
        auto pairs = parseJsonConfig(json);
        int applied = 0;
        for (const auto& [key, value] : pairs) {
            try {
                g_slicer->config.set_deserialize_strict(key, value);
                applied++;
            } catch (const Slic3r::UnknownOptionException&) {
                LOGW("Ignoring unknown config key: %s", key.c_str());
            }
        }
        LOGI("Applied %d/%zu config keys", applied, pairs.size());
    } catch (const std::exception& e) {
        LOGE("setConfig failed: %s", e.what());
        throwJavaException(env, e.what());
    }
}

JNIEXPORT void JNICALL
Java_io_github_mmmaxwwwell_openscadweb_SlicerBridge_nativeSlice(
    JNIEnv* env, jobject /* thiz */)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_slicer) {
        throwJavaException(env, "Slicer not created. Call nativeCreate() first.");
        return;
    }
    if (!g_slicer->model_loaded) {
        throwJavaException(env, "No model loaded. Call nativeLoadSTL/nativeLoad3MF first.");
        return;
    }

    try {
        g_slicer->print = std::make_unique<Slic3r::Print>();

        // Center model on bed
        if (g_slicer->needs_centering) {
            LOGI("Centering model on bed...");
            auto* bed_opt = g_slicer->config.option<Slic3r::ConfigOptionPoints>("printable_area");
            if (bed_opt && !bed_opt->values.empty()) {
                Slic3r::Vec2d center(0, 0);
                for (const auto& pt : bed_opt->values) {
                    center.x() += pt.x();
                    center.y() += pt.y();
                }
                center /= static_cast<double>(bed_opt->values.size());
                g_slicer->model.center_instances_around_point(center);
            } else {
                g_slicer->model.center_instances_around_point({0, 0});
            }
            g_slicer->needs_centering = false;
        }

        // Ensure model sits on bed (Z >= 0)
        if (g_slicer->from_3mf) {
            double global_min_z = std::numeric_limits<double>::max();
            for (auto* obj : g_slicer->model.objects) {
                auto bb = obj->bounding_box_exact();
                if (bb.min.z() < global_min_z) global_min_z = bb.min.z();
            }
            if (global_min_z != 0.0 && global_min_z != std::numeric_limits<double>::max()) {
                g_slicer->model.translate(0, 0, -global_min_z);
            }
        } else {
            for (auto* obj : g_slicer->model.objects) {
                obj->ensure_on_bed();
            }
        }

        // Auto-assign extruders
        LOGI("Auto-assigning extruders...");
        for (auto* obj : g_slicer->model.objects) {
            g_slicer->print->auto_assign_extruders(obj);
        }

        // Apply model + config
        LOGI("Applying model + config...");
        g_slicer->print->apply(g_slicer->model, g_slicer->config);

        // Validate
        LOGI("Validating print...");
        Slic3r::StringObjectException warning;
        auto err = g_slicer->print->validate(&warning);
        if (!err.string.empty()) {
            throwJavaException(env, ("Validation failed: " + err.string).c_str());
            return;
        }
        if (!warning.string.empty()) {
            LOGW("Validation warning: %s", warning.string.c_str());
        }

        // Slice
        LOGI("Starting slice...");
        g_slicer->print->process();
        LOGI("Slice completed successfully");

        g_slicer->sliced = true;
    } catch (const Slic3r::SlicingError& e) {
        LOGE("Slicing error: %s", e.what());
        throwJavaException(env, (std::string("Slicing error: ") + e.what()).c_str());
    } catch (const std::exception& e) {
        LOGE("slice() failed: %s", e.what());
        throwJavaException(env, e.what());
    }
}

JNIEXPORT void JNICALL
Java_io_github_mmmaxwwwell_openscadweb_SlicerBridge_nativeExportGCode(
    JNIEnv* env, jobject /* thiz */, jstring joutputPath)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_slicer) {
        throwJavaException(env, "Slicer not created. Call nativeCreate() first.");
        return;
    }
    if (!g_slicer->sliced || !g_slicer->print) {
        throwJavaException(env, "Not sliced. Call nativeSlice() first.");
        return;
    }

    std::string outputPath = jstringToString(env, joutputPath);
    LOGI("Exporting GCode to: %s", outputPath.c_str());

    try {
        g_slicer->print->export_gcode(outputPath, nullptr, nullptr);
        LOGI("GCode exported successfully");
    } catch (const std::exception& e) {
        LOGE("exportGCode failed: %s", e.what());
        throwJavaException(env, e.what());
    }
}

JNIEXPORT void JNICALL
Java_io_github_mmmaxwwwell_openscadweb_SlicerBridge_nativeDestroy(
    JNIEnv* env, jobject /* thiz */)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    LOGI("Destroying native slicer instance");
    g_slicer.reset();
}

} // extern "C"
