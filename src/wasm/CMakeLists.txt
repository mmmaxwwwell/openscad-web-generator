# SPDX-License-Identifier: AGPL-3.0-or-later
# CMakeLists.txt for the WASM slicer bindings.
# Links slicer_bindings.cpp against libslic3r.a + all dependencies
# and produces libslic3r.js + libslic3r.wasm via Emscripten.
#
# Usage (from the Nix build):
#   emcmake cmake -S . -B build \
#     -DLIBSLIC3R_PREFIX=/path/to/libslic3r-wasm-install \
#     -DDEPS_PREFIX=/path/to/libslic3r-deps-install
#   cmake --build build

cmake_minimum_required(VERSION 3.13)
project(slicer-wasm-bindings)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Prefixes for finding pre-built libraries
# LIBSLIC3R_PREFIX: output of libslic3r-wasm.nix (libslic3r.a, headers, bundled deps)
# DEPS_PREFIX: output of libslic3r-deps.nix (boost, tbb, zlib, etc.)
if(NOT DEFINED LIBSLIC3R_PREFIX)
    message(FATAL_ERROR "LIBSLIC3R_PREFIX must be set to the libslic3r install prefix")
endif()
if(NOT DEFINED DEPS_PREFIX)
    message(FATAL_ERROR "DEPS_PREFIX must be set to the deps install prefix")
endif()

# ============================================================
# Include paths
# ============================================================
include_directories(
    ${LIBSLIC3R_PREFIX}/include
    ${DEPS_PREFIX}/include
    # LibBGCode headers use relative includes like "binarize/export.h" from
    # within include/LibBGCode/binarize/binarize.hpp, so we need the
    # LibBGCode subdirectory on the include path as well.
    ${DEPS_PREFIX}/include/LibBGCode
)

# ============================================================
# Find all static libraries from libslic3r build
# ============================================================

# Core libslic3r — set paths directly (find_library fails under emcmake cross-compilation)
set(LIBSLIC3R ${LIBSLIC3R_PREFIX}/lib/liblibslic3r.a)
set(LIBSLIC3R_CGAL ${LIBSLIC3R_PREFIX}/lib/liblibslic3r_cgal.a)
if(NOT EXISTS ${LIBSLIC3R})
    message(FATAL_ERROR "liblibslic3r.a not found at ${LIBSLIC3R}")
endif()
if(NOT EXISTS ${LIBSLIC3R_CGAL})
    message(FATAL_ERROR "liblibslic3r_cgal.a not found at ${LIBSLIC3R_CGAL}")
endif()

# Bundled deps (built as part of PrusaSlicer) — set paths directly
set(LIB_ADMESH ${LIBSLIC3R_PREFIX}/lib/libadmesh.a)
set(LIB_CLIPPER ${LIBSLIC3R_PREFIX}/lib/libclipper.a)
set(LIB_GLU_LIBTESS ${LIBSLIC3R_PREFIX}/lib/libglu-libtess.a)
set(LIB_SEMVER ${LIBSLIC3R_PREFIX}/lib/libsemver.a)
set(LIB_AGG_PATH ${LIBSLIC3R_PREFIX}/lib/libagg.a)
if(EXISTS ${LIB_AGG_PATH})
    set(LIB_AGG ${LIB_AGG_PATH})
else()
    message(STATUS "libagg.a not found — AGG not needed for FDM-only WASM build")
    set(LIB_AGG "")
endif()
set(LIB_LIBNEST2D_PATH ${LIBSLIC3R_PREFIX}/lib/liblibnest2d.a)
if(EXISTS ${LIB_LIBNEST2D_PATH})
    set(LIB_LIBNEST2D ${LIB_LIBNEST2D_PATH})
else()
    message(STATUS "liblibnest2d.a not found — libnest2d is header-only (INTERFACE library)")
    set(LIB_LIBNEST2D "")
endif()

# miniz may be built as a separate static lib or compiled into libslic3r directly
# PrusaSlicer's bundled miniz creates a target named "miniz_static" -> libminiz_static.a
# LocalesUtils (bundled in PrusaSlicer for locale-safe number formatting)
set(LIB_LOCALESUTILS_PATH ${LIBSLIC3R_PREFIX}/lib/liblocalesutils.a)
if(NOT EXISTS ${LIB_LOCALESUTILS_PATH})
    # Try alternate naming
    set(LIB_LOCALESUTILS_PATH ${LIBSLIC3R_PREFIX}/lib/libLocalesUtils.a)
endif()
if(EXISTS ${LIB_LOCALESUTILS_PATH})
    set(LIB_LOCALESUTILS ${LIB_LOCALESUTILS_PATH})
else()
    message(STATUS "liblocalesutils.a not found — will rely on stubs or inline definitions")
    set(LIB_LOCALESUTILS "")
endif()

set(LIB_MINIZ_PATH ${LIBSLIC3R_PREFIX}/lib/libminiz_static.a)
if(NOT EXISTS ${LIB_MINIZ_PATH})
    # Fall back to libminiz.a in case the target name differs
    set(LIB_MINIZ_PATH ${LIBSLIC3R_PREFIX}/lib/libminiz.a)
endif()
if(EXISTS ${LIB_MINIZ_PATH})
    set(LIB_MINIZ ${LIB_MINIZ_PATH})
else()
    message(FATAL_ERROR "Neither libminiz_static.a nor libminiz.a found in ${LIBSLIC3R_PREFIX}/lib/ — miniz is required for 3MF support")
endif()

# External deps (from libslic3r-deps.nix) — set paths directly
set(LIB_BOOST_SYSTEM ${DEPS_PREFIX}/lib/libboost_system.a)
set(LIB_BOOST_FILESYSTEM ${DEPS_PREFIX}/lib/libboost_filesystem.a)
set(LIB_BOOST_THREAD ${DEPS_PREFIX}/lib/libboost_thread.a)
set(LIB_BOOST_LOG ${DEPS_PREFIX}/lib/libboost_log.a)
set(LIB_BOOST_LOG_SETUP ${DEPS_PREFIX}/lib/libboost_log_setup.a)
set(LIB_BOOST_LOCALE ${DEPS_PREFIX}/lib/libboost_locale.a)
set(LIB_BOOST_REGEX ${DEPS_PREFIX}/lib/libboost_regex.a)
set(LIB_BOOST_CHRONO ${DEPS_PREFIX}/lib/libboost_chrono.a)
set(LIB_BOOST_ATOMIC ${DEPS_PREFIX}/lib/libboost_atomic.a)
set(LIB_BOOST_DATE_TIME ${DEPS_PREFIX}/lib/libboost_date_time.a)
set(LIB_BOOST_IOSTREAMS ${DEPS_PREFIX}/lib/libboost_iostreams.a)
set(LIB_BOOST_NOWIDE ${DEPS_PREFIX}/lib/libboost_nowide.a)
set(LIB_TBB ${DEPS_PREFIX}/lib/libtbb.a)
set(LIB_ZLIB ${DEPS_PREFIX}/lib/libz.a)
set(LIB_EXPAT ${DEPS_PREFIX}/lib/libexpat.a)
set(LIB_GMP ${DEPS_PREFIX}/lib/libgmp.a)
set(LIB_MPFR ${DEPS_PREFIX}/lib/libmpfr.a)
set(LIB_NLOPT ${DEPS_PREFIX}/lib/libnlopt_cxx.a)
set(LIB_QHULL_CPP ${DEPS_PREFIX}/lib/libqhullcpp.a)
set(LIB_QHULL_R ${DEPS_PREFIX}/lib/libqhullstatic_r.a)
set(LIB_PNG ${DEPS_PREFIX}/lib/libpng.a)
set(LIB_JPEG ${DEPS_PREFIX}/lib/libjpeg.a)
set(LIB_BGCODE_CORE ${DEPS_PREFIX}/lib/libbgcode_core.a)
set(LIB_BGCODE_BINARIZE ${DEPS_PREFIX}/lib/libbgcode_binarize.a)
set(LIB_BGCODE_CONVERT ${DEPS_PREFIX}/lib/libbgcode_convert.a)
set(LIB_HEATSHRINK ${DEPS_PREFIX}/lib/libheatshrink.a)

# ============================================================
# Build the WASM binding
# ============================================================
add_executable(libslic3r slicer_bindings.cpp)

target_compile_options(libslic3r PRIVATE
    -fexceptions
    -matomics
    -mbulk-memory
    -DBOOST_LOG_NO_THREADS
)

# Collect all libraries in link order (dependents first)
target_link_libraries(libslic3r PRIVATE
    # Core
    ${LIBSLIC3R}
    ${LIBSLIC3R_CGAL}

    # Bundled deps
    ${LIB_ADMESH}
    ${LIB_CLIPPER}
    ${LIB_GLU_LIBTESS}
    ${LIB_SEMVER}

    # External deps
    ${LIB_BOOST_LOG_SETUP}
    ${LIB_BOOST_LOG}
    ${LIB_BOOST_FILESYSTEM}
    ${LIB_BOOST_THREAD}
    ${LIB_BOOST_LOCALE}
    ${LIB_BOOST_REGEX}
    ${LIB_BOOST_CHRONO}
    ${LIB_BOOST_ATOMIC}
    ${LIB_BOOST_DATE_TIME}
    ${LIB_BOOST_IOSTREAMS}
    ${LIB_BOOST_NOWIDE}
    ${LIB_BOOST_SYSTEM}
    ${LIB_TBB}
    ${LIB_BGCODE_CONVERT}
    ${LIB_BGCODE_BINARIZE}
    ${LIB_BGCODE_CORE}
    ${LIB_HEATSHRINK}
    ${LIB_NLOPT}
    ${LIB_QHULL_CPP}
    ${LIB_QHULL_R}
    ${LIB_PNG}
    ${LIB_JPEG}
    ${LIB_ZLIB}
    ${LIB_EXPAT}
    ${LIB_MPFR}
    ${LIB_GMP}
)

# Link AGG separately if it exists (not needed for FDM-only builds)
if(LIB_AGG)
    target_link_libraries(libslic3r PRIVATE ${LIB_AGG})
endif()

# Link libnest2d separately if it exists (it's an INTERFACE/header-only library in PrusaSlicer)
if(LIB_LIBNEST2D)
    target_link_libraries(libslic3r PRIVATE ${LIB_LIBNEST2D})
endif()

# Link miniz separately if it exists as a standalone library
if(LIB_MINIZ)
    target_link_libraries(libslic3r PRIVATE ${LIB_MINIZ})
endif()

# Link localesutils separately if it exists
if(LIB_LOCALESUTILS)
    target_link_libraries(libslic3r PRIVATE ${LIB_LOCALESUTILS})
endif()

# ============================================================
# Emscripten link flags
# ============================================================
set_target_properties(libslic3r PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS "\
        -lembind \
        -fexceptions \
        -sMODULARIZE=1 \
        -sEXPORT_NAME=createSlicerModule \
        -sENVIRONMENT=worker \
        -sMAXIMUM_MEMORY=1073741824 \
        -sINITIAL_MEMORY=268435456 \
        -sALLOW_MEMORY_GROWTH=1 \
        -sNO_EXIT_RUNTIME=1 \
        -sFORCE_FILESYSTEM=1 \
        -sEXPORTED_RUNTIME_METHODS=['getExceptionMessage','FS'] \
    "
)

# Output name: libslic3r.js + libslic3r.wasm (+ libslic3r.worker.js for pthreads)
set_target_properties(libslic3r PROPERTIES OUTPUT_NAME "libslic3r")
