# Stage 1: Build libslic3r.a + bundled deps from PrusaSlicer source.
# This is the expensive part (~90% of build time). It only rebuilds
# when the PrusaSlicer version or patches change — not when you edit
# src/wasm/slicer_bindings.cpp.
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
  deps = callPackage ./libslic3r-deps.nix {};

  prusaSlicerSrc = fetchFromGitHub {
    owner = "prusa3d";
    repo = "PrusaSlicer";
    rev = "version_2.9.4";
    hash = "sha256-1ilgr9RaIoWvj0TDVc20XjjUUcNtnicR7KlE0ii3GQE=";
  };

in
stdenv.mkDerivation {
  pname = "libslic3r-lib";
  version = "2.9.4";

  src = prusaSlicerSrc;

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
    export CXXFLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT -DBOOST_LOG_NO_THREADS -DSMALL_WASM_BINARY=1"
    export LDFLAGS="-fexceptions"
    # EMCC_CFLAGS is injected by emscripten into EVERY compile command,
    # regardless of what CMake does with CMAKE_C_FLAGS/CMAKE_CXX_FLAGS.
    export EMCC_CFLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT"

    # Work in a copy of the source tree so we can patch files
    cp -r $src $TMPDIR/prusaslicer
    chmod -R u+w $TMPDIR/prusaslicer
    patchShebangs $TMPDIR/prusaslicer
    cd $TMPDIR/prusaslicer

    # ============================================================
    # PATCH: Remove ArrangeHelper + libseqarrange dependency
    # (ArrangeHelper requires Z3 SAT solver — not needed for slicing)
    # ============================================================
    sed -i '/ArrangeHelper\.cpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/ArrangeHelper\.hpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/libseqarrange/d' src/libslic3r/CMakeLists.txt
    # Remove the #include of ArrangeHelper.hpp from Print.cpp and any other file that
    # includes it — ArrangeHelper pulls in libseqarrange which is not available in
    # the WASM build. Sequential arrange is not needed for slicing.
    sed -i '/#include.*ArrangeHelper\.hpp/d' src/libslic3r/Print.cpp
    # Stub out check_seq_conflict() call — the function lived in ArrangeHelper.cpp
    # which we removed. Replace the call with std::nullopt (no collision check needed).
    sed -i 's/check_seq_conflict(model(), config())/std::nullopt/' src/libslic3r/Print.cpp
    # Also stub out libseqarrange/seq_interface.hpp in case ArrangeHelper.hpp is
    # included transitively from other files we did not patch.
    mkdir -p src/libslic3r/libseqarrange
    cat > src/libslic3r/libseqarrange/seq_interface.hpp << 'SEQSTUB'
// Stub: libseqarrange not available in WASM build (sequential arrange not needed)
#pragma once
SEQSTUB

    # ============================================================
    # PATCH: Remove Emboss/EmbossShape (requires NanoSVG — not needed for slicing)
    # ============================================================
    sed -i '/Emboss\.cpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/Emboss\.hpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/EmbossShape\.hpp/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove STEP format support (requires OCCT)
    # ============================================================
    sed -i '/Format\/STEP\.hpp/d' src/libslic3r/CMakeLists.txt
    sed -i '/Format\/STEP\.cpp/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove OCCTWrapper, OpenVDB, Psapi references
    # ============================================================
    sed -i '/OCCTWrapper/d' src/libslic3r/CMakeLists.txt
    # Remove the entire OpenVDB if-block including the orphaned endif()
    # The block is: set(OpenVDBUtils_SOURCES "")  / if(TARGET OpenVDB::openvdb) / set(...) / endif()
    sed -i '/OpenVDBUtils_SOURCES/d' src/libslic3r/CMakeLists.txt
    sed -i '/OpenVDB::openvdb/,/endif()/d' src/libslic3r/CMakeLists.txt
    sed -i '/OpenVDB/d' src/libslic3r/CMakeLists.txt
    sed -i '/Psapi\.lib/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Strip SLA code (SMALL_WASM_BINARY — FDM only)
    # Removes ~60 SLA source files, SLAPrint, SLA format support
    # ============================================================
    # Remove all SLA/*.cpp and SLA/*.hpp from libslic3r
    sed -i '/SLA\//d' src/libslic3r/CMakeLists.txt
    # Remove SLAPrint sources
    sed -i '/SLAPrint/d' src/libslic3r/CMakeLists.txt
    sed -i '/SLAPrintSteps/d' src/libslic3r/CMakeLists.txt
    # Remove SLA format support (SL1, SL1_SVG, AnycubicSLA, SLAArchive*)
    sed -i '/Format\/SL1/d' src/libslic3r/CMakeLists.txt
    sed -i '/Format\/AnycubicSLA/d' src/libslic3r/CMakeLists.txt
    sed -i '/Format\/SLAArchive/d' src/libslic3r/CMakeLists.txt

    # Also strip SLA/SupportIslands/VoronoiDiagramCGAL from libslic3r_cgal
    sed -i '/SLA\/SupportIslands/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove tbbmalloc (not needed for WASM — emscripten
    # has its own allocator, and tbbmalloc may not build for WASM)
    # ============================================================
    sed -i '/TBB::tbbmalloc/d' src/libslic3r/CMakeLists.txt
    # Also remove tbbmalloc from bundled libnest2d
    sed -i 's/TBB::tbbmalloc//' bundled_deps/libnest2d/CMakeLists.txt
    # Fix NLopt target name: our build produces NLopt::nlopt_cxx, not NLopt::nlopt
    sed -i 's/NLopt::nlopt/NLopt::nlopt_cxx/' bundled_deps/libnest2d/CMakeLists.txt
    # Remove CMAKE_DL_LIBS (dlopen doesn't exist in WASM)
    sed -i '/CMAKE_DL_LIBS/d' src/libslic3r/CMakeLists.txt

    # ============================================================
    # PATCH: Remove avrdude and hints from bundled_deps
    # ============================================================
    sed -i '/avrdude/d' bundled_deps/CMakeLists.txt
    sed -i '/hints/d' bundled_deps/CMakeLists.txt

    # ============================================================
    # PATCH: Platform.cpp — add Emscripten/WASM platform detection
    # The static_assert(false) fires because __EMSCRIPTEN__ doesn't
    # match any of the existing #ifdef branches (Linux/Mac/Win/OpenBSD).
    # The actual #else block contains a comment + BOOST_LOG line before
    # static_assert, so we replace the whole #else block verbatim.
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
    # PATCH: DirectoriesUtils.cpp — add Emscripten/WASM case
    # GetDataDir() is only defined for _WIN32 and __linux__.
    # Add an __EMSCRIPTEN__ branch that returns "/tmp".
    # ============================================================
    substituteInPlace src/libslic3r/Utils/DirectoriesUtils.cpp \
      --replace-fail \
        '#endif

namespace Slic3r {' \
        '#elif defined(__EMSCRIPTEN__)

std::string GetDataDir()
{
    return "/tmp";
}

#endif

namespace Slic3r {'

    # ============================================================
    # WRITE: Custom top-level CMakeLists.txt
    # Replace PrusaSlicer's top-level CMake to avoid CURL, OpenGL,
    # GLEW, Z3, wxWidgets, etc. We only build libslic3r + bundled deps.
    # ============================================================
    cat > CMakeLists.txt << 'TOPLEVEL_CMAKE'
cmake_minimum_required(VERSION 3.13)
project(libslic3r-wasm)

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

# ---- LibBGCode ----
find_package(LibBGCode REQUIRED COMPONENTS Convert)

# ---- CGAL ----
find_package(CGAL REQUIRED)

# ---- Threads stub (no pthreads in WASM — TBB runs in serial mode) ----
# Provide a stub Threads::Threads target so CMake consumers don't fail.
# Without -pthread, find_package(Threads) would fail.
set(CMAKE_THREAD_LIBS_INIT "" CACHE STRING "" FORCE)
set(CMAKE_HAVE_THREADS_LIBRARY 1)
set(CMAKE_USE_PTHREADS_INIT 0)
set(Threads_FOUND TRUE)
if(NOT TARGET Threads::Threads)
  add_library(Threads::Threads INTERFACE IMPORTED)
endif()

set(LIBDIR_BIN ''${CMAKE_CURRENT_BINARY_DIR}/src)
include_directories(''${LIBDIR_BIN}/platform)

# encoding_check is defined in build-utils
add_subdirectory(build-utils)

# Bundled deps: admesh, miniz, glu-libtess, agg, libigl, libnest2d, semver, etc.
add_subdirectory(bundled_deps)

# Clipper (bundled in src/)
add_subdirectory(src/clipper)

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
      -DCMAKE_CXX_FLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT -DBOOST_LOG_NO_THREADS -DSMALL_WASM_BINARY=1" \
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
    find $TMPDIR/prusaslicer/build -name '*.a' -exec cp {} $out/lib/ \;

    # Install ALL bundled dependency headers comprehensively.
    # Each bundled dep uses target_include_directories(... PUBLIC/INTERFACE .)
    # which adds its own directory to the include path. We replicate this by
    # copying all header files from each bundled dep directory into $out/include/,
    # preserving subdirectory structure relative to each dep's directory.
    # (e.g. bundled_deps/admesh/admesh/stl.h -> $out/include/admesh/stl.h)
    # (e.g. bundled_deps/localesutils/LocalesUtils.hpp -> $out/include/LocalesUtils.hpp)
    # This prevents repeated "missing header" errors from cherry-picking files one by one.
    for dir in $TMPDIR/prusaslicer/bundled_deps/*/; do
      (cd "$dir" && find . \( -name '*.h' -o -name '*.hpp' -o -name '*.hxx' \) | while read -r f; do
        install -D -m 644 "$f" "$out/include/$f"
      done) || true
    done

    # Also install clipper headers (src/clipper uses target_include_directories(PUBLIC .))
    (cd $TMPDIR/prusaslicer/src/clipper && find . \( -name '*.h' -o -name '*.hpp' \) | while read -r f; do
      install -D -m 644 "$f" "$out/include/$f"
    done) || true

    # Verify key outputs
    test -f $out/lib/liblibslic3r.a || (echo "ERROR: liblibslic3r.a missing" && exit 1)
    test -f $out/lib/liblibslic3r_cgal.a || (echo "ERROR: liblibslic3r_cgal.a missing" && exit 1)

    echo ""
    echo "========================================"
    echo "libslic3r-lib: Build successful"
    echo "========================================"
    echo "Static libraries:"
    ls -lh $out/lib/*.a

    runHook postInstall
  '';

  meta = with lib; {
    description = "PrusaSlicer's libslic3r compiled to WASM static libraries";
    homepage = "https://github.com/prusa3d/PrusaSlicer";
    license = licenses.agpl3Plus;
    platforms = platforms.all;
  };
}
