# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Stage 2: Build OrcaSlicer's libslic3r.a + bundled deps from source.
# This is the expensive part — it only rebuilds when the OrcaSlicer version
# or patches change, not when you edit src/wasm/slicer_bindings.cpp.
#
# Key differences from PrusaSlicer libslic3r-lib.nix:
# - OrcaSlicer v2.3.1 source (BambuStudio fork)
# - deps_src/ instead of bundled_deps/ (different bundled dep structure)
# - No LibBGCode dependency (OrcaSlicer doesn't use binary GCode)
# - Stubs out: OpenCV, OpenCASCADE/OCCT, STEP format, SLA, FaceDetector
# - Keeps: clipper, mcut, libnest2d, admesh, libigl from deps_src/
# - Adds libnoise as external dep (fuzzy skin noise)
# - encoding_check lives in src/dev-utils/ (not build-utils/)
{ lib
, stdenv
, fetchFromGitHub
, emscripten
, cmake
, ninja
, python3
, callPackage
}:

let
  deps = callPackage ./orcaslicer-deps.nix {};

  orcaSlicerSrc = fetchFromGitHub {
    owner = "SoftFever";
    repo = "OrcaSlicer";
    rev = "v2.3.1";
    hash = "sha256-ua5ZcOnJ8oeY/g6dM9088lYdPNalWLYnD3DNDnw3Q5E=";
  };

in
stdenv.mkDerivation {
  pname = "orcaslicer-lib";
  version = "2.3.1";

  src = orcaSlicerSrc;

  dontConfigure = true;
  doCheck = false;

  nativeBuildInputs = [
    emscripten
    cmake
    ninja
    python3
  ];

  buildPhase = ''
    runHook preBuild

    # ============================================================
    # EMSCRIPTEN SETUP
    # ============================================================
    export HOME=$TMPDIR
    export EM_CACHE=$TMPDIR/emscripten-cache
    cp -r ${emscripten}/share/emscripten/cache $EM_CACHE
    chmod -R u+w $EM_CACHE

    # -D_REENTRANT: Boost.Thread headers require this (normally set by -pthread).
    # We define it manually to satisfy the header checks without pulling in
    # Emscripten's pthreads runtime (which causes deadlocks in Web Workers).
    export CFLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT -DSMALL_WASM_BINARY=1"
    export CXXFLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT -DBOOST_LOG_NO_THREADS -DSMALL_WASM_BINARY=1 -Wno-c++11-narrowing"
    export LDFLAGS="-fexceptions"
    # EMCC_CFLAGS is injected by emscripten into EVERY compile command,
    # regardless of what CMake does with CMAKE_C_FLAGS/CMAKE_CXX_FLAGS.
    export EMCC_CFLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT"

    # Work in a copy of the source tree so we can patch files
    cp -r $src $TMPDIR/orcaslicer
    chmod -R u+w $TMPDIR/orcaslicer
    patchShebangs $TMPDIR/orcaslicer
    cd $TMPDIR/orcaslicer

    # ============================================================
    # PATCH: Fix Arachne SkeletalTrapezoidation crash on complex geometry.
    # propagateBeadingsDownward() dereferences shared_ptr from weak_ptr::lock()
    # without null-checking. On complex meshes the weak_ptr can be expired,
    # causing a null deref → "memory access out of bounds" in WASM.
    # Fix: add null guards and skip propagation when beading is unavailable.
    # ============================================================
    ARACHNE_FILE=src/libslic3r/Arachne/SkeletalTrapezoidation.cpp

    # Fix 1: Add null/edge guard at function entry + guard getOrCreateBeading result
    # Insert null-edge guard after the opening brace of the single-edge overload
    sed -i '/^void SkeletalTrapezoidation::propagateBeadingsDownward(edge_t\* edge_to_peak/,/^{/{
      /^{/a\
    if (!edge_to_peak || !edge_to_peak->to || !edge_to_peak->from) return;
    }' $ARACHNE_FILE

    # Fix 2: Replace raw deref of getOrCreateBeading with null-checked version
    sed -i 's|BeadingPropagation& top_beading = \*getOrCreateBeading(edge_to_peak->to, node_beadings);|auto top_beading_ptr = getOrCreateBeading(edge_to_peak->to, node_beadings); if (!top_beading_ptr) return; BeadingPropagation\& top_beading = *top_beading_ptr;|' $ARACHNE_FILE

    # Fix 3: Replace raw deref of getBeading() with null-checked version
    sed -i 's|BeadingPropagation& bottom_beading = \*edge_to_peak->from->data.getBeading();|auto bottom_beading_ptr = edge_to_peak->from->data.getBeading(); if (!bottom_beading_ptr) return; BeadingPropagation\& bottom_beading = *bottom_beading_ptr;|' $ARACHNE_FILE

    # Fix 4: propagateBeadingsUpward — null-check getBeading() on from node (line ~1575)
    sed -i 's|BeadingPropagation& lower_beading = \*upward_edge->from->data.getBeading();|auto lower_beading_ptr = upward_edge->from->data.getBeading(); if (!lower_beading_ptr) continue; BeadingPropagation\& lower_beading = *lower_beading_ptr;|' $ARACHNE_FILE

    # Fix 5: generateJunctions — null-check getOrCreateBeading (line ~1746)
    sed -i 's|Beading\* beading = \&getOrCreateBeading(edge->to, node_beadings)->beading;|auto junc_beading_ptr = getOrCreateBeading(edge->to, node_beadings); if (!junc_beading_ptr) continue; Beading* beading = \&junc_beading_ptr->beading;|' $ARACHNE_FILE

    # Fix 6: generateLocalMaximaSingleBeads — null-check getBeading() (line ~2066)
    sed -i 's|Beading\& beading = node.data.getBeading()->beading;|auto lm_beading_ptr = node.data.getBeading(); if (!lm_beading_ptr) continue; Beading\& beading = lm_beading_ptr->beading;|' $ARACHNE_FILE

    # Fix 7: Guard upward_edge inside propagateBeadingsUpward loop
    # After "edge_t* upward_edge = *upward_quad_mids_it;" add null/pointer guards
    sed -i '/edge_t\* upward_edge = \*upward_quad_mids_it;/a\
        if (!upward_edge || !upward_edge->to || !upward_edge->from) continue;' $ARACHNE_FILE

    # Fix 8-12: Guard all twin->next traversals against null twin
    # Pattern: "variable = expr->twin->next" → "variable = (expr->twin ? expr->twin->next : nullptr)"
    # In getOrCreateBeading (line ~1821)
    sed -i 's|edge = edge->twin->next)|edge = (edge->twin ? edge->twin->next : nullptr))|g' $ARACHNE_FILE
    # In getNearestBeading (lines ~1860, 1878)
    sed -i 's|outgoing = outgoing->twin->next)|outgoing = (outgoing->twin ? outgoing->twin->next : nullptr))|g' $ARACHNE_FILE
    sed -i 's|further_edge = further_edge->twin->next)|further_edge = (further_edge->twin ? further_edge->twin->next : nullptr))|g' $ARACHNE_FILE
    # In filterCentral (line ~624)
    sed -i 's|next_edge = next_edge->twin->next)|next_edge = (next_edge->twin ? next_edge->twin->next : nullptr))|g' $ARACHNE_FILE

    # Fix 14: interpolate() — early return when toolpath_locations is empty
    # If left.toolpath_locations is empty, the for loop "size() - 1" underflows (unsigned 0-1 = 4294967295)
    # causing an immediate out-of-bounds access. Return the 3-param interpolate result instead.
    sed -i '/Beading ret = interpolate(left, ratio_left_to_whole, right);/a\
    if (left.toolpath_locations.empty() || right.toolpath_locations.empty()) return ret;' $ARACHNE_FILE

    # Fix 13: interpolate() — bounds check before accessing right.toolpath_locations[next_inset_idx]
    # next_inset_idx is computed from left.toolpath_locations but used to index right and ret,
    # which may have different (smaller) sizes → out-of-bounds crash on complex geometry.
    # Replace the unsafe block with bounds-checked version.
    sed -i '/if (ret.toolpath_locations\[next_inset_idx\] > switching_radius)/,/return interpolate(left, new_ratio, right);/{
      s|if (ret.toolpath_locations\[next_inset_idx\] > switching_radius)|if (next_inset_idx < coord_t(ret.toolpath_locations.size()) \&\& ret.toolpath_locations[next_inset_idx] > switching_radius)|
      s|float new_ratio = static_cast<float>(switching_radius - right.toolpath_locations\[next_inset_idx\]) / static_cast<float>(left.toolpath_locations\[next_inset_idx\] - right.toolpath_locations\[next_inset_idx\]);|if (next_inset_idx >= coord_t(right.toolpath_locations.size())) return ret; float new_ratio = static_cast<float>(switching_radius - right.toolpath_locations[next_inset_idx]) / static_cast<float>(left.toolpath_locations[next_inset_idx] - right.toolpath_locations[next_inset_idx]);|
    }' $ARACHNE_FILE

    echo "Patched SkeletalTrapezoidation.cpp: comprehensive null guards for all Arachne crash sites"

    # ============================================================
    # PATCH: Remove Emboss/EmbossShape (requires imgui/NanoSVG — not needed for slicing)
    # ============================================================
    sed -i '/Emboss\.cpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/Emboss\.hpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/EmbossShape\.hpp/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove STEP format support (requires OpenCASCADE/OCCT)
    # ============================================================
    sed -i '/Format\/STEP\.hpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/Format\/STEP\.cpp/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove SVG format support (requires OpenCASCADE)
    # ============================================================
    sed -i '/Format\/svg\.cpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/Format\/svg\.hpp/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove TextShape (requires OpenCASCADE)
    # ============================================================
    sed -i '/TextShape/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove FaceDetector (depends on SLA/IndexedMesh which we're removing)
    # ============================================================
    sed -i '/FaceDetector\.cpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/FaceDetector\.hpp/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove ObjColorUtils (depends on OpenCV)
    # ============================================================
    sed -i '/ObjColorUtils\.hpp/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove BlacklistedLibraryCheck (Windows-only, uses Psapi)
    # ============================================================
    sed -i '/BlacklistedLibraryCheck\.cpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/BlacklistedLibraryCheck\.hpp/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Use Python script for safe CMakeLists.txt patching.
    # Avoids sed line-deletion issues with multi-line CMake calls.
    # ============================================================
    cat > $TMPDIR/patch_cmake.py << 'PATCH_CMAKE_PY'
import re, sys

with open(sys.argv[1], "r") as f:
    content = f.read()

# 1. Remove source file entries (safe - one per line in source list)
for pattern in [
    "SLA/", "SLAPrint", "SLAPrintSteps",
    "Format/SL1", "Format/AnycubicSLA", "Format/SLAArchive",
]:
    content = re.sub(r"^.*" + re.escape(pattern) + r".*\n", "", content, flags=re.MULTILINE)

# Replace OpenVDBUtils_SOURCES reference (keep closing paren on same line)
content = content.replace("''${OpenVDBUtils_SOURCES}", "")

# 2. Replace the entire set(OCCT_LIBS ...) block with an empty variable
content = re.sub(
    r"set\(OCCT_LIBS\b.*?\)",
    "set(OCCT_LIBS)  # Emptied for WASM build",
    content,
    flags=re.DOTALL
)

# 3. Replace OpenCASCADE find_package block and OpenCV find_package
content = re.sub(r"^.*OpenCASCADE.*\n", "", content, flags=re.MULTILINE)
content = re.sub(r"^.*find_package\(OpenCV.*\n", "", content, flags=re.MULTILINE)
# libnoise is already found at top level — remove duplicate find_package
content = re.sub(r"^.*find_package\(libnoise.*\n", "", content, flags=re.MULTILINE)

# 4. In target_link_libraries, replace unwanted entries
for lib in [
    "''${CMAKE_DL_LIBS}", "''${OCCT_LIBS}", "opencv_world",
    "TBB::tbbmalloc",
]:
    content = content.replace("        " + lib + "\n", "")

# 5. Remove conditional blocks that do not work in WASM
# OpenVDB block
content = re.sub(
    r"if\s*\(TARGET OpenVDB::openvdb\).*?endif\(\)",
    "# OpenVDB removed for WASM build",
    content,
    flags=re.DOTALL
)

# Psapi block (Windows)
content = re.sub(
    r"if\s*\(WIN32\)\s*\n\s*target_link_libraries\(libslic3r PRIVATE Psapi\.lib\)\s*\nendif\(\)",
    "# Psapi removed for WASM build",
    content,
    flags=re.DOTALL
)

# freetype/OpenSSL/fontconfig block
content = re.sub(
    r"if\s*\(NOT WIN32\)\s*\n.*?FREETYPE.*?endif\(\)\s*\nendif\(\)",
    "# freetype/OpenSSL/fontconfig removed for WASM build",
    content,
    flags=re.DOTALL
)

# Apple frameworks block
content = re.sub(
    r"if\s*\(APPLE\)\s*\n\s*find_library\(FOUNDATION.*?endif\s*\(\s*\)",
    "# Apple frameworks removed for WASM build",
    content,
    flags=re.DOTALL
)

with open(sys.argv[1], "w") as f:
    f.write(content)
PATCH_CMAKE_PY
    python3 $TMPDIR/patch_cmake.py src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: deps_src — remove GUI-only dependencies
    # hidapi, imgui, imguizmo need system libs / are GUI-only
    # hints creates a native executable (can't cross-compile to WASM)
    # ============================================================
    sed -i '/hidapi/d' deps_src/CMakeLists.txt
    sed -i '/imgui/d' deps_src/CMakeLists.txt
    sed -i '/imguizmo/d' deps_src/CMakeLists.txt
    sed -i '/hints/d' deps_src/CMakeLists.txt
    # nlohmann and qhull conflict with targets we create via find_package
    sed -i '/add_subdirectory.*nlohmann/d' deps_src/CMakeLists.txt
    sed -i '/add_subdirectory.*qhull/d' deps_src/CMakeLists.txt

    # ============================================================
    # PATCH: deps_src/libnest2d — fix NLopt target name
    # Our NLopt build produces NLopt::nlopt_cxx, not NLopt::nlopt
    # Also remove tbbmalloc reference
    # ============================================================
    sed -i 's/NLopt::nlopt/NLopt::nlopt_cxx/' deps_src/libnest2d/CMakeLists.txt
    # Remove tbbmalloc from libnest2d if present
    sed -i 's/TBB::tbbmalloc//' deps_src/libnest2d/CMakeLists.txt

    # ============================================================
    # PATCH: Model.hpp — remove STEP include (OCCT headers not available)
    # Replace with a stub that provides the typedefs used by read_from_step
    # ============================================================
    sed -i '/#include "Format\/STEP.hpp"/d' src/libslic3r/Model.hpp
    # Add forward declarations for STEP types used in Model.hpp
    sed -i '/^namespace Slic3r {/a\
// Stub: STEP format support removed for WASM build\
typedef std::function<void(int, int, int, bool\&)> ImportStepProgressFn;\
typedef std::function<void(bool)> StepIsUtf8Fn;\
class Step;' src/libslic3r/Model.hpp

    # ============================================================
    # PATCH: Model.cpp — remove FaceDetector include and usage
    # ============================================================
    sed -i '/#include "FaceDetector.hpp"/d' src/libslic3r/Model.cpp
    # Stub out FaceDetector usage in ModelObject::split()
    # Replace the FaceDetector block with a no-op
    sed -i 's/FaceDetector face_detector(all_meshes, all_transfos, 1.0);/\/\/ FaceDetector removed for WASM build/' src/libslic3r/Model.cpp
    sed -i 's/face_detector.detect_exterior_face();//' src/libslic3r/Model.cpp

    # ============================================================
    # PATCH: Model.cpp — stub out read_from_step (uses STEP/OCCT)
    # Replace the function body with a stub that throws
    # ============================================================
    # Replace read_from_step function body with a stub using brace-counting
    cat > $TMPDIR/patch_step.py << 'PATCH_STEP_PY'
import sys

with open(sys.argv[1], "r") as f:
    lines = f.readlines()

# Find the function start
start = None
for i, line in enumerate(lines):
    if "Model Model::read_from_step" in line:
        start = i
        break

if start is None:
    print("WARNING: read_from_step not found, skipping patch")
    sys.exit(0)

# Find opening brace, then count braces to find closing
depth = 0
brace_start = None
end = None
for i in range(start, len(lines)):
    for ch in lines[i]:
        if ch == "{":
            if brace_start is None:
                brace_start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end is not None:
        break

# Replace lines[start..end] with stub
stub = [
    "Model Model::read_from_step(const std::string& input_file,\n",
    "                            LoadStrategy options,\n",
    "                            ImportStepProgressFn stepFn,\n",
    "                            StepIsUtf8Fn stepIsUtf8Fn,\n",
    "                            std::function<int(Slic3r::Step&, double&, double&, bool&)> step_mesh_fn,\n",
    "                            double linear_defletion,\n",
    "                            double angle_defletion,\n",
    "                            bool is_split_compound)\n",
    "{\n",
    '    throw Slic3r::RuntimeError("STEP format not supported in WASM build");\n',
    "}\n",
]
lines[start:end+1] = stub

with open(sys.argv[1], "w") as f:
    f.writelines(lines)
PATCH_STEP_PY
    python3 $TMPDIR/patch_step.py src/libslic3r/Model.cpp

    # ============================================================
    # PATCH: Utils.hpp — stub out OpenSSL include (not available in WASM)
    # Replace with a simple hash stub
    # ============================================================
    sed -i 's|#include <openssl/md5.h>|// openssl/md5.h removed for WASM build|' src/libslic3r/Utils.hpp
    # LocalesUtils.cpp missing sstream include (implicit in GCC, explicit in Emscripten clang)
    sed -i '1i #include <sstream>' src/libslic3r/LocalesUtils.cpp

    # utils.cpp: Boost.Log synchronous_sink and threading attributes not available with BOOST_LOG_NO_THREADS
    cat > $TMPDIR/patch_utils_log.py << 'PATCH_UTILS_LOG_PY'
import sys
with open(sys.argv[1], "r") as f:
    content = f.read()

# Replace the g_log_sink global declaration with a simple void* stub
content = content.replace(
    'boost::shared_ptr<boost::log::sinks::synchronous_sink<boost::log::sinks::text_file_backend>> g_log_sink;',
    '// g_log_sink removed for WASM build (no file logging)\n'
    'static bool g_log_sink = false;'
)

# Replace copy_option::overwrite_if_exists with copy_options::overwrite_existing
content = content.replace("copy_option::overwrite_if_exists", "copy_options::overwrite_existing")

# Replace the setup_logger function body that uses g_log_sink and ThreadID
import re
# Find setup_logger function and replace its body
# Pattern: void setup_logger(... to the next function
content = re.sub(
    r'(g_log_sink = boost::log::add_file_log\(.*?\);)',
    '// File logging disabled for WASM build\n    g_log_sink = true;',
    content,
    flags=re.DOTALL
)

# Remove ThreadID attribute reference
content = re.sub(r'.*current_thread_id.*\n', "", content)

# Replace g_log_sink->flush() with no-op (g_log_sink is now bool, not shared_ptr)
content = content.replace("g_log_sink->flush()", "/* flush disabled */")
content = content.replace("g_log_sink->locked_backend()", "/* locked_backend disabled */  nullptr")

with open(sys.argv[1], "w") as f:
    f.write(content)
PATCH_UTILS_LOG_PY
    python3 $TMPDIR/patch_utils_log.py src/libslic3r/utils.cpp
    # bbs_3mf.cpp uses OpenSSL MD5 — provide a stub header
    mkdir -p src/libslic3r/openssl_stub
    cat > src/libslic3r/openssl_stub/md5.h << 'MD5_STUB'
#pragma once
// Stub: OpenSSL MD5 not available in WASM build
#include <cstring>
typedef struct { int dummy; } MD5_CTX;
static inline int MD5_Init(MD5_CTX *) { return 1; }
static inline int MD5_Update(MD5_CTX *, const void *, size_t) { return 1; }
static inline int MD5_Final(unsigned char md[16], MD5_CTX *) { memset(md, 0, 16); return 1; }
MD5_STUB
    sed -i 's|#include <openssl/md5.h>|#include "openssl_stub/md5.h"|' src/libslic3r/Format/bbs_3mf.cpp
    # Stub out bbl_calc_md5 in utils.cpp (uses OpenSSL MD5 functions)
    cat > $TMPDIR/patch_md5.py << 'PATCH_MD5_PY'
import re, sys
with open(sys.argv[1], "r") as f:
    content = f.read()
# Replace the bbl_calc_md5 function body with a stub
content = re.sub(
    r"bool bbl_calc_md5\(std::string &filename, std::string &md5_out\)\s*\{.*?\n\}",
    "bool bbl_calc_md5(std::string &filename, std::string &md5_out)\n{\n    // Stubbed out for WASM build (no OpenSSL)\n    md5_out = \"\";\n    return false;\n}",
    content,
    flags=re.DOTALL
)
with open(sys.argv[1], "w") as f:
    f.write(content)
PATCH_MD5_PY
    python3 $TMPDIR/patch_md5.py src/libslic3r/utils.cpp

    # ============================================================
    # PATCH: Platform.cpp — add Emscripten/WASM platform detection
    # ============================================================
    substituteInPlace src/libslic3r/Platform.cpp \
      --replace-fail \
        '#else
	// This should not happen.
    BOOST_LOG_TRIVIAL(info) << "Platform: Unknown";
	static_assert(false, "Unknown platform detected");
	s_platform 		  = Platform::Unknown;
	s_platform_flavor = PlatformFlavor::Unknown;' \
        '#elif defined(__EMSCRIPTEN__)
    // Emscripten/WASM — no platform-specific initialisation needed
    BOOST_LOG_TRIVIAL(info) << "Platform: Emscripten/WASM";
	s_platform        = Platform::Linux;
	s_platform_flavor = PlatformFlavor::GenericLinux;
#else
	// This should not happen.
    BOOST_LOG_TRIVIAL(info) << "Platform: Unknown";
	static_assert(false, "Unknown platform detected");
	s_platform 		  = Platform::Unknown;
	s_platform_flavor = PlatformFlavor::Unknown;'

    # ============================================================
    # PATCH: Stub out OpenCV include in ObjColorUtils.hpp
    # (header is still referenced from CMakeLists via other files,
    # but we removed it from CMakeLists — this is a safety measure
    # in case it's included transitively)
    # ============================================================
    cat > src/libslic3r/ObjColorUtils.hpp << 'OPENCV_STUB'
#pragma once
// Stub: ObjColorUtils removed for WASM build (requires OpenCV)
OPENCV_STUB

    # ============================================================
    # PATCH: Stub out Format/STEP.hpp for any transitive includes
    # ============================================================
    cat > src/libslic3r/Format/STEP.hpp << 'STEP_STUB'
#pragma once
// Stub: STEP format not supported in WASM build (requires OpenCASCADE)
#include <functional>
#include <string>
#include <atomic>
namespace Slic3r {
class TriangleMesh;
class ModelObject;
typedef std::function<void(int, int, int, bool&)> ImportStepProgressFn;
typedef std::function<void(bool)> StepIsUtf8Fn;
class Step {
public:
    Step(std::string, ImportStepProgressFn = nullptr, StepIsUtf8Fn = nullptr) {}
    bool load() { return false; }
    unsigned int get_triangle_num(double, double) { return 0; }
    void clean_mesh_data() {}
    std::atomic<bool> m_stop_mesh{false};
};
}
STEP_STUB

    # ============================================================
    # PATCH: Stub out BlacklistedLibraryCheck for any transitive includes
    # ============================================================
    cat > src/libslic3r/BlacklistedLibraryCheck.hpp << 'BLC_STUB'
#pragma once
// Stub: BlacklistedLibraryCheck removed for WASM build (Windows-only)
#include <vector>
#include <string>
namespace Slic3r {
class BlacklistedLibraryCheck {
public:
    static BlacklistedLibraryCheck& get_instance() {
        static BlacklistedLibraryCheck instance;
        return instance;
    }
    bool get_blacklisted(std::vector<std::wstring>&) { return false; }
    std::wstring get_blacklisted_string() { return L""; }
    void perform_check() {}
};
}
BLC_STUB

    # ============================================================
    # PATCH: Stub out SLA/IndexedMesh.hpp for any transitive includes
    # ============================================================
    mkdir -p src/libslic3r/SLA
    cat > src/libslic3r/SLA/IndexedMesh.hpp << 'SLA_STUB'
#pragma once
// Stub: SLA/IndexedMesh removed for WASM build (FDM only)
#include <libslic3r/Point.hpp>
namespace Slic3r { namespace sla {
class IndexedMesh {
public:
    template<class T> IndexedMesh(const T&) {}
};
}}
SLA_STUB

    cat > src/libslic3r/SLA/Hollowing.hpp << 'HOLLOW_STUB'
#pragma once
// Stub: SLA/Hollowing removed for WASM build (FDM only)
#include <vector>
#include <libslic3r/Point.hpp>
namespace Slic3r { namespace sla {
struct DrainHole {
    Vec3f pos;
    Vec3f normal;
    float radius;
    float height;
    bool  failed = false;
    DrainHole() : pos(Vec3f::Zero()), normal(Vec3f::UnitZ()), radius(5.f), height(10.f) {}
    DrainHole(Vec3f p, Vec3f n, float r, float h, bool fl = false)
        : pos(p), normal(n), radius(r), height(h), failed(fl) {}
    bool operator==(const DrainHole &sp) const { return pos == sp.pos && normal == sp.normal; }
    bool operator!=(const DrainHole &sp) const { return !(sp == (*this)); }
    template<class Archive> void serialize(Archive &ar) { ar(pos, normal, radius, height, failed); }
};
using DrainHoles = std::vector<DrainHole>;
}}
HOLLOW_STUB

    cat > src/libslic3r/SLA/JobController.hpp << 'JOB_STUB'
#pragma once
// Stub: SLA/JobController removed for WASM build
JOB_STUB

    cat > src/libslic3r/SLA/Concurrency.hpp << 'CONC_STUB'
#pragma once
// Stub: SLA/Concurrency removed for WASM build
CONC_STUB

    cat > src/libslic3r/SLA/SupportPoint.hpp << 'SP_STUB'
#pragma once
// Stub: SLA/SupportPoint removed for WASM build
#include <vector>
#include <libslic3r/Point.hpp>
namespace Slic3r { namespace sla {
enum class PointsStatus {
    NoPoints,
    Generating,
    AutoGenerated,
    UserModified
};
struct SupportPoint {
    Vec3f pos;
    float head_front_radius;
    bool  is_new_island;
    SupportPoint() : pos(Vec3f::Zero()), head_front_radius(0.f), is_new_island(false) {}
    SupportPoint(float x, float y, float z, float r, bool n = false)
        : pos(x, y, z), head_front_radius(r), is_new_island(n) {}
    SupportPoint(Vec3f p, float r, bool n = false)
        : pos(p), head_front_radius(r), is_new_island(n) {}
    bool operator==(const SupportPoint &sp) const { return pos == sp.pos; }
    bool operator!=(const SupportPoint &sp) const { return !(sp == (*this)); }
    template<class Archive> void serialize(Archive &ar) { ar(pos, head_front_radius, is_new_island); }
};
using SupportPoints = std::vector<SupportPoint>;
}}
SP_STUB

    # ============================================================
    # WRITE: Custom top-level CMakeLists.txt
    # Replace OrcaSlicer's top-level CMake to avoid CURL, OpenGL,
    # GLEW, wxWidgets, etc. We only build libslic3r + bundled deps.
    # ============================================================
    cat > CMakeLists.txt << 'TOPLEVEL_CMAKE'
cmake_minimum_required(VERSION 3.13)
project(orcaslicer-wasm)

include("version.inc")
include(GNUInstallDirs)
include(CMakeDependentOption)

set(SLIC3R_RESOURCES_DIR "''${CMAKE_CURRENT_SOURCE_DIR}/resources")
set(SLIC3R_STATIC 1)
set(SLIC3R_GUI 0)
set(SLIC3R_PCH 0)
set(SLIC3R_ENABLE_FORMAT_STEP OFF)
set(SLIC3R_BUILD_TESTS OFF)
set(SLIC3R_ENC_CHECK OFF)
set(IS_CROSS_COMPILE TRUE)
set(ORCA_TOOLS OFF)
# SLIC3R_BUILD_ID is used in libslic3r_version.h.in
set(SLIC3R_BUILD_ID "wasm" CACHE STRING "" FORCE)

set(CMAKE_FIND_PACKAGE_PREFER_CONFIG ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

list(APPEND CMAKE_MODULE_PATH ''${PROJECT_SOURCE_DIR}/cmake/modules/)

add_compile_options(-fsigned-char)

# ---- Boost ----
set(MINIMUM_BOOST_VERSION "1.83.0")
set(_boost_components "system;filesystem;thread;log;locale;regex;chrono;atomic;date_time;iostreams;nowide")
set(Boost_USE_STATIC_LIBS ON)
find_package(Boost ''${MINIMUM_BOOST_VERSION} REQUIRED COMPONENTS ''${_boost_components})

add_library(boost_libs INTERFACE)
add_library(boost_headeronly INTERFACE)

if(TARGET Boost::system)
    target_link_libraries(boost_headeronly INTERFACE Boost::boost)
    set(_boost_targets "")
    foreach(comp ''${_boost_components})
        list(APPEND _boost_targets "Boost::''${comp}")
    endforeach()
    target_link_libraries(boost_libs INTERFACE boost_headeronly ''${_boost_targets})
else()
    target_include_directories(boost_headeronly INTERFACE ''${Boost_INCLUDE_DIRS})
    target_link_libraries(boost_libs INTERFACE boost_headeronly ''${Boost_LIBRARIES})
endif()

# ---- Eigen3 ----
find_package(Eigen3 3.3.7 REQUIRED)

# ---- TBB ----
set(TBB_STATIC 1)
find_package(TBB REQUIRED)

function(slic3r_remap_configs targets from_Cfg to_Cfg)
    # No-op for WASM cross-compile
endfunction()

# ---- CURL stub (not needed, but referenced by some cmake files) ----
add_library(libcurl INTERFACE)

# ---- ZLIB ----
find_package(ZLIB REQUIRED)

# ---- EXPAT ----
find_package(EXPAT REQUIRED)
add_library(libexpat INTERFACE)
if (TARGET EXPAT::EXPAT)
    target_link_libraries(libexpat INTERFACE EXPAT::EXPAT)
elseif(TARGET expat::expat)
    target_link_libraries(libexpat INTERFACE expat::expat)
else()
    target_link_libraries(libexpat INTERFACE ''${EXPAT_LIBRARIES})
endif()

# ---- PNG ----
find_package(PNG REQUIRED)

# ---- JPEG ----
find_package(JPEG REQUIRED)

# ---- cereal ----
find_package(cereal REQUIRED)
add_library(libcereal INTERFACE)
if (NOT TARGET cereal::cereal)
    target_link_libraries(libcereal INTERFACE cereal)
else()
    target_link_libraries(libcereal INTERFACE cereal::cereal)
endif()

# ---- NLopt ----
find_package(NLopt 1.4 REQUIRED)

# ---- Qhull ----
find_package(Qhull 7.2 REQUIRED)
add_library(qhull INTERFACE)
target_link_libraries(qhull INTERFACE Qhull::qhullcpp Qhull::qhullstatic_r)

# ---- nlohmann_json ----
find_package(nlohmann_json REQUIRED)

# ---- CGAL ----
find_package(CGAL REQUIRED)

# ---- libnoise (for fuzzy skin) ----
find_package(libnoise REQUIRED)

# ---- Draco (mesh compression) ----
find_package(draco REQUIRED)

# ---- Threads stub (no pthreads in WASM — TBB runs in serial mode) ----
set(CMAKE_THREAD_LIBS_INIT "" CACHE STRING "" FORCE)
set(CMAKE_HAVE_THREADS_LIBRARY 1)
set(CMAKE_USE_PTHREADS_INIT 0)
set(Threads_FOUND TRUE)
if(NOT TARGET Threads::Threads)
  add_library(Threads::Threads INTERFACE IMPORTED)
endif()

# ---- OpenCV stub (calibration features not needed for WASM slicing) ----
add_library(opencv_world INTERFACE)

set(LIBDIR_BIN ''${CMAKE_CURRENT_BINARY_DIR}/src)
include_directories(''${LIBDIR_BIN}/dev-utils)
# OrcaSlicer source uses #include <libslic3r/...> — needs src/ in include path
include_directories(''${CMAKE_CURRENT_SOURCE_DIR}/src)
include_directories(''${CMAKE_CURRENT_BINARY_DIR}/src)

# encoding_check is defined in dev-utils (disabled by IS_CROSS_COMPILE)
add_subdirectory(src/dev-utils)

# Bundled deps: admesh, miniz, glu-libtess, libigl, libnest2d, clipper, mcut, etc.
add_subdirectory(deps_src)

# libslic3r itself
add_subdirectory(src/libslic3r)

# Install libslic3r.a and headers
install(TARGETS libslic3r libslic3r_cgal ARCHIVE DESTINATION lib)
install(DIRECTORY src/libslic3r/ DESTINATION include/libslic3r
    FILES_MATCHING PATTERN "*.hpp" PATTERN "*.h")
# Install generated version header (created by configure_file in src/libslic3r/CMakeLists.txt)
install(FILES ''${CMAKE_CURRENT_BINARY_DIR}/src/libslic3r/libslic3r_version.h
    DESTINATION include/libslic3r)
TOPLEVEL_CMAKE

    # ============================================================
    # BUILD
    # ============================================================
    mkdir -p build
    cd build

    emcmake cmake \
      .. \
      -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=$TMPDIR/install \
      -DCMAKE_PREFIX_PATH=${deps} \
      -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -DCMAKE_CXX_COMPILER=em++ \
      -DCMAKE_C_COMPILER=emcc \
      -DCMAKE_C_FLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT -DSMALL_WASM_BINARY=1" \
      -DCMAKE_CXX_FLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT -DBOOST_LOG_NO_THREADS -DSMALL_WASM_BINARY=1 -Wno-c++11-narrowing" \
      -DCMAKE_FIND_ROOT_PATH=${deps} \
      -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH \
      -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=BOTH \
      -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=BOTH

    cmake --build . --parallel

    cmake --install .

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib $out/include

    # Install liblibslic3r.a, liblibslic3r_cgal.a, and headers from cmake install
    cp -r $TMPDIR/install/* $out/

    # Copy bundled dep .a files not installed by default
    find $TMPDIR/orcaslicer/build -name '*.a' -exec cp {} $out/lib/ \;

    # Install ALL bundled dependency headers comprehensively.
    # Each bundled dep uses target_include_directories(... PUBLIC/INTERFACE .)
    # which adds its own directory to the include path. Some includes reference
    # the dep name (e.g. "semver/semver.h"), so we install headers BOTH flat
    # (as direct children of include/) AND under the dep name subdirectory.
    for dir in $TMPDIR/orcaslicer/deps_src/*/; do
      depname=$(basename "$dir")
      (cd "$dir" && find . \( -name '*.h' -o -name '*.hpp' -o -name '*.hxx' \) | while read -r f; do
        # Install flat (for includes that resolved via the dep's own include path)
        install -D -m 644 "$f" "$out/include/$f"
        # Also install under dep name (for includes like "semver/semver.h")
        install -D -m 644 "$f" "$out/include/$depname/$f"
      done) || true
    done

    # Verify key outputs
    test -f $out/lib/liblibslic3r.a || (echo "ERROR: liblibslic3r.a missing" && exit 1)
    test -f $out/lib/liblibslic3r_cgal.a || (echo "ERROR: liblibslic3r_cgal.a missing" && exit 1)

    echo ""
    echo "========================================"
    echo "orcaslicer-lib: Build successful"
    echo "========================================"
    echo "Static libraries:"
    ls -lh $out/lib/*.a

    runHook postInstall
  '';

  meta = with lib; {
    description = "OrcaSlicer's libslic3r compiled to WASM static libraries";
    homepage = "https://github.com/SoftFever/OrcaSlicer";
    license = licenses.agpl3Plus;
    platforms = platforms.all;
  };
}
