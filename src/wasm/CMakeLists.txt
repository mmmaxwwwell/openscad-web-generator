# SPDX-License-Identifier: AGPL-3.0-or-later
# CMakeLists.txt for the WASM slicer bindings.
# Links slicer_bindings.cpp against OrcaSlicer's libslic3r.a + all dependencies
# and produces libslic3r.js + libslic3r.wasm via Emscripten.
#
# Usage (from the Nix build):
#   emcmake cmake -S . -B build \
#     -DLIBSLIC3R_PREFIX=/path/to/orcaslicer-lib-install \
#     -DDEPS_PREFIX=/path/to/orcaslicer-deps-install
#   cmake --build build

cmake_minimum_required(VERSION 3.13)
project(slicer-wasm-bindings)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Prefixes for finding pre-built libraries
# LIBSLIC3R_PREFIX: output of orcaslicer-lib.nix (libslic3r.a, headers, bundled deps)
# DEPS_PREFIX: output of orcaslicer-deps.nix (boost, tbb, zlib, draco, libnoise, etc.)
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

# Bundled deps (built as part of OrcaSlicer from deps_src/) — set paths directly
set(LIB_ADMESH ${LIBSLIC3R_PREFIX}/lib/libadmesh.a)
set(LIB_CLIPPER ${LIBSLIC3R_PREFIX}/lib/libclipper.a)
set(LIB_GLU_LIBTESS ${LIBSLIC3R_PREFIX}/lib/libglu-libtess.a)
set(LIB_SEMVER ${LIBSLIC3R_PREFIX}/lib/libsemver.a)

# Clipper2 — OrcaSlicer's polygon clipping library (replaces parts of legacy Clipper)
set(LIB_CLIPPER2_PATH ${LIBSLIC3R_PREFIX}/lib/libclipper2.a)
if(NOT EXISTS ${LIB_CLIPPER2_PATH})
    # Try alternate names — OrcaSlicer's deps_src/clipper2 might produce different names
    set(LIB_CLIPPER2_PATH ${LIBSLIC3R_PREFIX}/lib/libClipper2.a)
endif()
if(NOT EXISTS ${LIB_CLIPPER2_PATH})
    set(LIB_CLIPPER2_PATH ${LIBSLIC3R_PREFIX}/lib/libClipper2Lib.a)
endif()
if(EXISTS ${LIB_CLIPPER2_PATH})
    set(LIB_CLIPPER2 ${LIB_CLIPPER2_PATH})
else()
    message(STATUS "Clipper2 .a not found — may be header-only or compiled into libslic3r")
    set(LIB_CLIPPER2 "")
endif()

# mcut — mesh cutting library (bundled in deps_src/mcut/)
set(LIB_MCUT_PATH ${LIBSLIC3R_PREFIX}/lib/libmcut.a)
if(NOT EXISTS ${LIB_MCUT_PATH})
    set(LIB_MCUT_PATH ${LIBSLIC3R_PREFIX}/lib/libMCUT.a)
endif()
if(EXISTS ${LIB_MCUT_PATH})
    set(LIB_MCUT ${LIB_MCUT_PATH})
else()
    message(STATUS "mcut .a not found — may be compiled into libslic3r or not needed")
    set(LIB_MCUT "")
endif()

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
set(LIB_LOCALESUTILS_PATH ${LIBSLIC3R_PREFIX}/lib/liblocalesutils.a)
if(NOT EXISTS ${LIB_LOCALESUTILS_PATH})
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
    set(LIB_MINIZ_PATH ${LIBSLIC3R_PREFIX}/lib/libminiz.a)
endif()
if(EXISTS ${LIB_MINIZ_PATH})
    set(LIB_MINIZ ${LIB_MINIZ_PATH})
else()
    message(FATAL_ERROR "Neither libminiz_static.a nor libminiz.a found in ${LIBSLIC3R_PREFIX}/lib/ — miniz is required for 3MF support")
endif()

# External deps (from orcaslicer-deps.nix) — set paths directly
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

# Draco — mesh compression (new for OrcaSlicer)
set(LIB_DRACO ${DEPS_PREFIX}/lib/libdraco.a)

# libnoise — fuzzy skin noise generation (new for OrcaSlicer)
# The library may be named libnoise.a or liblibnoise.a depending on CMake target name
set(LIB_LIBNOISE_PATH ${DEPS_PREFIX}/lib/libnoise.a)
if(NOT EXISTS ${LIB_LIBNOISE_PATH})
    set(LIB_LIBNOISE_PATH ${DEPS_PREFIX}/lib/liblibnoise.a)
endif()
if(NOT EXISTS ${LIB_LIBNOISE_PATH})
    set(LIB_LIBNOISE_PATH ${DEPS_PREFIX}/lib/liblibnoise_static.a)
endif()
if(EXISTS ${LIB_LIBNOISE_PATH})
    set(LIB_LIBNOISE ${LIB_LIBNOISE_PATH})
else()
    message(STATUS "libnoise .a not found — fuzzy skin noise may not be available")
    set(LIB_LIBNOISE "")
endif()

# ============================================================
# Build the WASM binding
# ============================================================
add_executable(libslic3r slicer_bindings.cpp)

target_compile_options(libslic3r PRIVATE
    -fexceptions
    -matomics
    -mbulk-memory
    -DBOOST_LOG_NO_THREADS
    -Wno-c++11-narrowing
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
    ${LIB_DRACO}
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

# Link Clipper2 if it exists as a separate library
if(LIB_CLIPPER2)
    target_link_libraries(libslic3r PRIVATE ${LIB_CLIPPER2})
endif()

# Link mcut if it exists as a separate library
if(LIB_MCUT)
    target_link_libraries(libslic3r PRIVATE ${LIB_MCUT})
endif()

# Link AGG separately if it exists (not needed for FDM-only builds)
if(LIB_AGG)
    target_link_libraries(libslic3r PRIVATE ${LIB_AGG})
endif()

# Link libnest2d separately if it exists (may be header-only INTERFACE library)
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

# Link libnoise separately if it exists
if(LIB_LIBNOISE)
    target_link_libraries(libslic3r PRIVATE ${LIB_LIBNOISE})
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
        -sMAXIMUM_MEMORY=4294967296 \
        -sINITIAL_MEMORY=268435456 \
        -sALLOW_MEMORY_GROWTH=1 \
        -sSTACK_SIZE=8388608 \
        -sNO_EXIT_RUNTIME=1 \
        -sFORCE_FILESYSTEM=1 \
        -sEXPORTED_RUNTIME_METHODS=['getExceptionMessage','FS'] \
    "
)

# Output name: libslic3r.js + libslic3r.wasm (+ libslic3r.worker.js for pthreads)
set_target_properties(libslic3r PROPERTIES OUTPUT_NAME "libslic3r")
