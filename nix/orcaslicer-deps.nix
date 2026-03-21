# SPDX-License-Identifier: AGPL-3.0-or-later
#
# OrcaSlicer WASM dependencies — split into individual derivations for caching.
# Each library is its own derivation; once built it stays in the Nix store.
# The top-level output is a symlinkJoin that merges them all.
#
# Based on libslic3r-deps.nix (PrusaSlicer). Changes:
# - Removed: LibBGCode, heatshrink (OrcaSlicer doesn't use binary GCode)
# - Added: Draco (mesh compression), libnoise (fuzzy skin noise generation)
# - Updated: CGAL 5.6.2→5.6.3, Qhull 8.1-alpha3→8.0.2
# - Clipper2 and mcut are bundled in OrcaSlicer's deps_src/ — built in lib stage
# - NanoSVG kept for header-only use by libslic3r internals

{ lib
, stdenv
, fetchFromGitHub
, fetchFromGitLab
, fetchurl
, emscripten
, cmake
, ninja
, pkg-config
, python3
, autoconf
, automake
, libtool
, m4
, which
, symlinkJoin
}:

let
  # ============================================================
  # Common builder for emscripten CMake libraries
  # ============================================================
  mkEmscriptenLib = { pname, version, src, cmakeFlags ? [], buildInputs ? []
                    , preBuildPhase ? "", postUnpackPhase ? ""
                    , usesCMake ? true, buildPhaseOverride ? null
                    , installPhaseOverride ? null, extraNativeBuildInputs ? []
                    , dontUnpackSrc ? false, meta ? {} }:
    stdenv.mkDerivation {
      inherit pname version meta;
      src = if dontUnpackSrc then null else src;

      dontUnpack = dontUnpackSrc;
      dontConfigure = true;
      doCheck = false;

      nativeBuildInputs = [
        emscripten cmake ninja pkg-config python3
      ] ++ extraNativeBuildInputs;

      inherit buildInputs;

      buildPhase = if buildPhaseOverride != null then buildPhaseOverride else ''
        runHook preBuild

        export HOME=$TMPDIR
        export EM_CACHE=$TMPDIR/emscripten-cache
        cp -r ${emscripten}/share/emscripten/cache $EM_CACHE
        chmod -R u+w $EM_CACHE

        # -matomics -mbulk-memory: needed for C++ atomics (TBB) without full pthreads
        # No -pthread: avoids Emscripten pthreads runtime (Web Workers) which deadlock
        export CFLAGS="-fexceptions -matomics -mbulk-memory"
        export CXXFLAGS="-fexceptions -matomics -mbulk-memory"
        export LDFLAGS="-fexceptions"
        # EMCC_CFLAGS ensures these flags reach every compile command
        # regardless of CMake or build system overrides
        export EMCC_CFLAGS="-fexceptions -matomics -mbulk-memory"

        # Fix shebangs for Nix sandbox (/usr/bin/env doesn't exist)
        patchShebangs .

        ${postUnpackPhase}

        ${preBuildPhase}

        ${if usesCMake then ''
          emcmake cmake \
            -B build \
            -G Ninja \
            -DCMAKE_INSTALL_PREFIX=$out \
            -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
            ${lib.concatStringsSep " \\\n      " cmakeFlags}
          cmake --build build --parallel
          cmake --install build
        '' else ""}

        runHook postBuild
      '';

      installPhase = if installPhaseOverride != null then installPhaseOverride else ''
        runHook preInstall
        runHook postInstall
      '';
    };

  # ============================================================
  # SOURCES
  # ============================================================
  sources = {
    zlib = fetchFromGitHub {
      owner = "madler";
      repo = "zlib";
      rev = "v1.3.1";
      hash = "sha256-TkPLWSN5QcPlL9D0kc/yhH0/puE9bFND24aj5NVDKYs=";
    };

    libexpat = fetchFromGitHub {
      owner = "libexpat";
      repo = "libexpat";
      rev = "R_2_6_4";
      hash = "sha256-ek8/3c8bKG+z7fIM+QCNsH7eoVGAt7z3bXBHZ3QjlS8=";
    };

    eigen = fetchFromGitLab {
      domain = "gitlab.com";
      owner = "libeigen";
      repo = "eigen";
      rev = "3.4.0";
      hash = "sha256-1/4xMetKMDOgZgzz3WMxfHUEpmdAm52RqZvz6i0mLEw=";
    };

    cereal = fetchFromGitHub {
      owner = "USCiLab";
      repo = "cereal";
      rev = "v1.3.2";
      hash = "sha256-HapnwM5oSNKuqoKm5x7+i2zt0sny8z8CePwobz1ITQs=";
    };

    nlohmann_json = fetchFromGitHub {
      owner = "nlohmann";
      repo = "json";
      rev = "v3.11.3";
      hash = "sha256-7F0Jon+1oWL7uqet5i1IgHX0fUw/+z0QwEcA3zs5xHg=";
    };

    gmp = fetchurl {
      urls = [
        "https://ftp.gnu.org/gnu/gmp/gmp-6.3.0.tar.xz"
        "https://gmplib.org/download/gmp/gmp-6.3.0.tar.xz"
      ];
      hash = "sha256-o8K4AgG4nmhhb0rTC8Zq7kknw85Q4zkpyoGdXENTiJg=";
    };

    mpfr = fetchurl {
      url = "https://www.mpfr.org/mpfr-4.2.1/mpfr-4.2.1.tar.xz";
      hash = "sha256-J3gHNTpnJpeJlpRa8T5Sgp46vXqaW3+yeTiU4Y8fy7I=";
    };

    boost = fetchurl {
      url = "https://archives.boost.io/release/1.87.0/source/boost_1_87_0.tar.bz2";
      hash = "sha256-r1e+JctMT0tBPtaS/jeK/7Q1LqUPvilKEe9Uj01SfYk=";
    };

    cgal = fetchFromGitHub {
      owner = "CGAL";
      repo = "cgal";
      rev = "v5.6.3";
      hash = "sha256-wS0uNyY6fZzZewAKEhsHgRDG+LH7mlZkVodLeGWxrQg=";
    };

    oneTBB = fetchFromGitHub {
      owner = "oneapi-src";
      repo = "oneTBB";
      rev = "v2021.13.0";
      hash = "sha256-ZoUzY71SweVQ8/1k09MNSXiEqab6Ae+QTbxORnar9JU=";
    };

    nlopt = fetchFromGitHub {
      owner = "stevengj";
      repo = "nlopt";
      rev = "v2.5.0";
      hash = "sha256-PFzUrbdjOY+ktorII2ofV8XYhRVIIvARFFbQmAd3f3M=";
    };

    qhull = fetchFromGitHub {
      owner = "qhull";
      repo = "qhull";
      rev = "v8.0.2";
      hash = "sha256-djUO3qzY8ch29AuhY3Bn1ajxWZ4/W70icWVrxWRAxRc=";
    };

    libpng = fetchFromGitHub {
      owner = "glennrp";
      repo = "libpng";
      rev = "v1.6.35";
      hash = "sha256-6SuOrhEHKAPzeh8bprgNOPheQlALNRo/7LNR2B6kcYE=";
    };

    libjpeg_turbo = fetchFromGitHub {
      owner = "libjpeg-turbo";
      repo = "libjpeg-turbo";
      rev = "3.0.1";
      hash = "sha256-YeFeBR0S5lrOa9aFYAZcDZXt9IryyTOuJEzDalp5PJQ=";
    };

    nanosvg = fetchFromGitHub {
      owner = "memononen";
      repo = "nanosvg";
      rev = "5cefd9847949af6df13f65027fd43af5a7513633";
      hash = "sha256-BozXqp3pNxAew+aFUbh6M3ppVQ+U7XMmMCbGT1urfWE=";
    };

    draco = fetchFromGitHub {
      owner = "google";
      repo = "draco";
      rev = "1.5.7";
      hash = "sha256-Y1bwBFe3bCklZN2+TBs6mhqDKQjrezMiT5zXlPFuMew=";
    };

    libnoise = fetchFromGitHub {
      owner = "SoftFever";
      repo = "Orca-deps-libnoise";
      rev = "1.0";
      hash = "sha256-nzvtWsYz4REVcPRpKysOPOYIlMNhfbDHTkyS7PKvY+c=";
    };
  };

  # ============================================================
  # INDIVIDUAL LIBRARY DERIVATIONS
  # ============================================================

  # ---- Header-only libraries ----

  nanosvg = stdenv.mkDerivation {
    pname = "orcaslicer-dep-nanosvg";
    version = "0-unstable-2025-11-21";
    src = sources.nanosvg;
    dontConfigure = true;
    dontBuild = true;
    doCheck = false;
    installPhase = ''
      runHook preInstall
      mkdir -p $out/include/nanosvg
      cp src/nanosvg.h $out/include/nanosvg/
      cp src/nanosvgrast.h $out/include/nanosvg/
      runHook postInstall
    '';
  };

  eigen = mkEmscriptenLib {
    pname = "orcaslicer-dep-eigen";
    version = "3.4.0";
    src = sources.eigen;
    cmakeFlags = [];
    preBuildPhase = ''
      # OrcaSlicer expects <Eigen/...> not <eigen3/Eigen/...>
      postInstallHook() {
        ln -sf $out/include/eigen3/Eigen $out/include/Eigen
        ln -sf $out/include/eigen3/unsupported $out/include/unsupported
      }
    '';
    installPhaseOverride = ''
      runHook preInstall
      # Symlinks for OrcaSlicer compatibility
      ln -sf $out/include/eigen3/Eigen $out/include/Eigen
      ln -sf $out/include/eigen3/unsupported $out/include/unsupported
      runHook postInstall
    '';
  };

  cereal = mkEmscriptenLib {
    pname = "orcaslicer-dep-cereal";
    version = "1.3.2";
    src = sources.cereal;
    cmakeFlags = [
      "-DBUILD_TESTS=OFF"
      "-DBUILD_DOC=OFF"
      "-DBUILD_SANDBOX=OFF"
      "-DSKIP_PERFORMANCE_COMPARISON=ON"
    ];
  };

  nlohmann_json = mkEmscriptenLib {
    pname = "orcaslicer-dep-nlohmann-json";
    version = "3.11.3";
    src = sources.nlohmann_json;
    cmakeFlags = [
      "-DJSON_BuildTests=OFF"
      "-DJSON_MultipleHeaders=ON"
    ];
  };

  cgal = mkEmscriptenLib {
    pname = "orcaslicer-dep-cgal";
    version = "5.6.3";
    src = sources.cgal;
    cmakeFlags = [
      "-DWITH_examples=OFF"
      "-DWITH_demos=OFF"
      "-DCGAL_ENABLE_TESTING=OFF"
    ];
  };

  # ---- Compiled libraries (no deps) ----

  zlib = mkEmscriptenLib {
    pname = "orcaslicer-dep-zlib";
    version = "1.3.1";
    src = sources.zlib;
    # zlib uses -B build differently
    usesCMake = false;
    preBuildPhase = ''
      emcmake cmake \
        -DINSTALL_PKGCONFIG_DIR="$out/lib/pkgconfig/" \
        -DCMAKE_INSTALL_PREFIX=$out \
        -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
        -DBUILD_SHARED_LIBS=OFF \
        -B build
      cmake --build build --parallel
      cmake --install build
    '';
  };

  libexpat = mkEmscriptenLib {
    pname = "orcaslicer-dep-libexpat";
    version = "2.6.4";
    src = sources.libexpat;
    usesCMake = false;
    extraNativeBuildInputs = [ autoconf automake libtool m4 which ];
    preBuildPhase = ''
      cd expat
      ./buildconf.sh
      # Unset EMCC_CFLAGS — libexpat uses autoconf, threading flags break configure
      unset EMCC_CFLAGS
      emconfigure ./configure \
        --without-docbook \
        --host wasm32-unknown-linux \
        --prefix=$out \
        --enable-shared=no \
        --disable-dependency-tracking
      emmake make
      emmake make install

      # Remove the autotools-generated cmake config files — they reference
      # libexpat.so which doesn't exist (we built static-only).  CMake's
      # built-in FindEXPAT module will find libexpat.a via standard paths.
      rm -rf $out/lib/cmake/expat-*
    '';
  };

  gmp = mkEmscriptenLib {
    pname = "orcaslicer-dep-gmp";
    version = "6.3.0";
    src = sources.gmp;
    usesCMake = false;
    # gmp is a tarball, needs special unpack
    postUnpackPhase = ''
      # Re-unpack tarball into build dir (src is a tarball, not a directory)
      mkdir -p $TMPDIR/gmp-src
      cd $TMPDIR/gmp-src
      tar xf ${sources.gmp} --strip-components=1
      patchShebangs .
      cd $TMPDIR/gmp-src
    '';
    dontUnpackSrc = true;
    preBuildPhase = ''
      cd $TMPDIR/gmp-src

      # Override CFLAGS for GMP — needs NO_ASM for WASM, plus SIMD
      export CFLAGS="-DNO_ASM -O3 -msimd128 -fexceptions"
      # Unset EMCC_CFLAGS — GMP uses autoconf, and the global threading
      # flags (-pthread -matomics -mbulk-memory) break its C++ compiler check
      unset EMCC_CFLAGS
      export CXXFLAGS="-fexceptions"

      # GMP needs a native HOST_CC to build gen-* tools that run during compilation.
      CC=emcc HOST_CC=cc ./configure \
        --enable-cxx \
        --host=none \
        --enable-fft=yes \
        --enable-alloca=malloc-notreentrant \
        --enable-shared=no \
        --enable-static=yes \
        --prefix=$out

      MPN_PATH="generic" make
      make install
    '';
  };

  mpfr = mkEmscriptenLib {
    pname = "orcaslicer-dep-mpfr";
    version = "4.2.1";
    src = sources.mpfr;
    usesCMake = false;
    dontUnpackSrc = true;
    postUnpackPhase = ''
      mkdir -p $TMPDIR/mpfr-src
      cd $TMPDIR/mpfr-src
      tar xf ${sources.mpfr} --strip-components=1
      patchShebangs .
    '';
    preBuildPhase = ''
      cd $TMPDIR/mpfr-src

      # Unset EMCC_CFLAGS — MPFR uses autoconf, threading flags break configure
      unset EMCC_CFLAGS

      emconfigure ./configure \
        --host=none \
        --with-gmp=${gmp} \
        --enable-shared=no \
        --enable-static=yes \
        --prefix=$out

      emmake make
      emmake make install
    '';
  };

  boost = mkEmscriptenLib {
    pname = "orcaslicer-dep-boost";
    version = "1.87.0";
    src = sources.boost;
    usesCMake = false;
    dontUnpackSrc = true;
    postUnpackPhase = ''
      mkdir -p $TMPDIR/boost-src
      cd $TMPDIR/boost-src
      tar xf ${sources.boost} --strip-components=1
      patchShebangs .
    '';
    preBuildPhase = ''
      cd $TMPDIR/boost-src

      # Bootstrap builds the b2 tool using the host compiler (not emscripten)
      ./bootstrap.sh

      # Build Boost libraries with emscripten toolset
      # exception-handling-method=js forces Emscripten JS-based EH (-fexceptions)
      # instead of Wasm native EH (-fwasm-exceptions) which b2 defaults to for
      # Emscripten >= 3.0. All other libs and the final link use JS-based EH.
      ./b2 \
        toolset=emscripten \
        link=static \
        threading=single \
        address-model=32 \
        variant=release \
        exception-handling=on \
        exception-handling-method=js \
        cxxflags=-fexceptions \
        cxxflags=-matomics \
        cxxflags=-mbulk-memory \
        cxxflags=-DBOOST_THREAD_POSIX \
        define=BOOST_LOG_WITHOUT_SYSLOG \
        --with-system \
        --with-filesystem \
        --with-thread \
        --with-log \
        --with-locale \
        --with-regex \
        --with-chrono \
        --with-atomic \
        --with-date_time \
        --with-iostreams \
        --with-nowide \
        --prefix=$out \
        -j$NIX_BUILD_CORES \
        install
    '';
  };

  oneTBB = mkEmscriptenLib {
    pname = "orcaslicer-dep-onetbb";
    version = "2021.13.0";
    src = sources.oneTBB;
    usesCMake = false;
    preBuildPhase = ''
      # Patch cmake/compilers/Clang.cmake for Emscripten support
      cat > cmake/compilers/Clang.cmake << 'CLANG_PATCH'
if (EMSCRIPTEN)
    set(TBB_EMSCRIPTEN 1)
    set(TBB_COMMON_COMPILE_FLAGS ''${TBB_COMMON_COMPILE_FLAGS} -fexceptions)
    set(TBB_TEST_LINK_FLAGS ''${TBB_TEST_LINK_FLAGS} -fexceptions)
    set(TBB_LIB_LINK_FLAGS ''${TBB_LIB_LINK_FLAGS} -fexceptions)
endif()

set(TBB_LINK_DEF_FILE_FLAG -Wl,-def,)
set(TBB_DEF_FILE_PREFIX )
set(TBB_MMD_FLAG -MMD)

if (NOT TBB_EMSCRIPTEN)
    if (NOT TBB_STRICT AND COMMAND tbb_remove_compile_flag)
        tbb_remove_compile_flag(-Werror)
    endif()
    if (NOT APPLE)
        set(TBB_WARNING_LEVEL -Wall -Wextra $<$<BOOL:''${TBB_STRICT}>:-Werror>)
        set(TBB_TEST_WARNING_FLAGS -Wshadow -Wcastqual -Woverloaded-virtual -Wnon-virtual-dtor)
    endif()
endif()

if (CMAKE_SYSTEM_PROCESSOR MATCHES "(x86_64|AMD64)" AND NOT EMSCRIPTEN)
    set(TBB_COMMON_COMPILE_FLAGS ''${TBB_COMMON_COMPILE_FLAGS} -mrtm $<$<AND:$<NOT:$<CXX_COMPILER_ID:IntelLLVM>>,$<NOT:$<VERSION_LESS:''${CMAKE_CXX_COMPILER_VERSION},12.0>>>:-mwaitpkg>)
endif()

if (NOT ''${CMAKE_CXX_COMPILER_ID} STREQUAL IntelLLVM)
    set(TBB_COMMON_COMPILE_FLAGS ''${TBB_COMMON_COMPILE_FLAGS}
        $<$<NOT:$<BOOL:''${EMSCRIPTEN}>>:-fstack-protector-strong>
    )
endif()

set(TBB_OPENMP_FLAG -fopenmp)
set(TBB_IPO_COMPILE_FLAGS $<$<NOT:$<CONFIG:Debug>>:-flto=thin>)
set(TBB_IPO_LINK_FLAGS $<$<NOT:$<CONFIG:Debug>>:-flto=thin>)
CLANG_PATCH

      # Patch _config.h to disable dynamic loading and weak symbols for WASM
      sed -i '/#define __TBB_DYNAMIC_LOAD_ENABLED/c\#if __EMSCRIPTEN__\n#define __TBB_DYNAMIC_LOAD_ENABLED 0\n#else\n#define __TBB_DYNAMIC_LOAD_ENABLED 1\n#endif' include/oneapi/tbb/detail/_config.h
      sed -i '/#define __TBB_WEAK_SYMBOLS_PRESENT/c\#if __EMSCRIPTEN__\n#define __TBB_WEAK_SYMBOLS_PRESENT 0\n#else\n#define __TBB_WEAK_SYMBOLS_PRESENT __TBB_DYNAMIC_LOAD_ENABLED\n#endif' include/oneapi/tbb/detail/_config.h

      # Provide Threads stub — without -pthread, find_package(Threads) would fail.
      # TBB's CMakeLists.txt requires it. We fake it so TBB builds but falls
      # back to serial execution at runtime (no actual thread creation).
      mkdir -p cmake-stubs
      cat > cmake-stubs/FindThreads.cmake << 'THREADSSTUB'
set(CMAKE_THREAD_LIBS_INIT "" CACHE STRING "" FORCE)
set(CMAKE_HAVE_THREADS_LIBRARY 1)
set(CMAKE_USE_PTHREADS_INIT 0)
set(Threads_FOUND TRUE)
if(NOT TARGET Threads::Threads)
  add_library(Threads::Threads INTERFACE IMPORTED)
endif()
THREADSSTUB

      emcmake cmake \
        -B build \
        -G Ninja \
        -DCMAKE_INSTALL_PREFIX=$out \
        -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
        -DCMAKE_MODULE_PATH=$PWD/cmake-stubs \
        -DTBB_BUILD_SHARED=OFF \
        -DBUILD_SHARED_LIBS=OFF \
        -DTBB_STRICT=OFF \
        -DTBB_TEST=OFF \
        -DTBB_EXAMPLES=OFF \
        -DTBB_DISABLE_HWLOC_AUTOMATIC_SEARCH=ON \
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -DCMAKE_CXX_COMPILER=em++ \
        -DCMAKE_C_COMPILER=emcc
      cmake --build build --parallel
      cmake --install build
    '';
  };

  nlopt = mkEmscriptenLib {
    pname = "orcaslicer-dep-nlopt";
    version = "2.5.0";
    src = sources.nlopt;
    cmakeFlags = [
      "-DBUILD_SHARED_LIBS=OFF"
      "-DNLOPT_PYTHON=OFF"
      "-DNLOPT_OCTAVE=OFF"
      "-DNLOPT_MATLAB=OFF"
      "-DNLOPT_GUILE=OFF"
      "-DNLOPT_SWIG=OFF"
      "-DNLOPT_TESTS=OFF"
      "-DNLOPT_CXX=ON"
    ];
  };

  qhull = mkEmscriptenLib {
    pname = "orcaslicer-dep-qhull";
    version = "8.0.2";
    src = sources.qhull;
    cmakeFlags = [
      "-DBUILD_SHARED_LIBS=OFF"
      "-DBUILD_APPLICATIONS=OFF"
      "-DQHULL_ENABLE_TESTING=OFF"
    ];
  };

  # ---- Libraries with dependencies ----

  libpng = mkEmscriptenLib {
    pname = "orcaslicer-dep-libpng";
    version = "1.6.35";
    src = sources.libpng;
    cmakeFlags = [
      "-DPNG_SHARED=OFF"
      "-DPNG_STATIC=ON"
      "-DPNG_TESTS=OFF"
      "-DZLIB_INCLUDE_DIR=${zlib}/include"
      "-DZLIB_LIBRARY=${zlib}/lib/libz.a"
      ''-DM_LIBRARY=""''
    ];
  };

  libjpeg_turbo = mkEmscriptenLib {
    pname = "orcaslicer-dep-libjpeg-turbo";
    version = "3.0.1";
    src = sources.libjpeg_turbo;
    cmakeFlags = [
      "-DENABLE_SHARED=OFF"
      "-DENABLE_STATIC=ON"
      "-DWITH_TURBOJPEG=OFF"
    ];
  };

  # ---- NEW: Draco (mesh compression — used by OrcaSlicer for 3MF) ----

  draco = mkEmscriptenLib {
    pname = "orcaslicer-dep-draco";
    version = "1.5.7";
    src = sources.draco;
    cmakeFlags = [
      "-DBUILD_SHARED_LIBS=OFF"
      "-DDRACO_ANIMATION_ENCODING=OFF"
      "-DDRACO_BACKWARDS_COMPATIBILITY=OFF"
      "-DDRACO_DECODER_ATTRIBUTE_DEDUPLICATION=OFF"
      "-DDRACO_JS_GLUE=OFF"
      "-DDRACO_MESH_COMPRESSION=ON"
      "-DDRACO_POINT_CLOUD_COMPRESSION=ON"
      "-DDRACO_PREDICTIVE_EDGEBREAKER=ON"
      "-DDRACO_STANDARD_EDGEBREAKER=ON"
      "-DDRACO_TESTS=OFF"
      "-DDRACO_TRANSCODER_SUPPORTED=OFF"
      "-DDRACO_WASM=ON"
    ];
    # Draco's cmake/draco_emscripten.cmake checks $EMSCRIPTEN env var
    preBuildPhase = ''
      export EMSCRIPTEN=${emscripten}/share/emscripten
    '';
  };

  # ---- NEW: libnoise (fuzzy skin noise generation) ----

  libnoise = mkEmscriptenLib {
    pname = "orcaslicer-dep-libnoise";
    version = "1.0";
    src = sources.libnoise;
    cmakeFlags = [
      "-DBUILD_SHARED_LIBS=OFF"
    ];
  };

  # ============================================================
  # All individual deps for external reference
  # ============================================================
  allDeps = [
    nanosvg eigen cereal nlohmann_json cgal
    zlib libexpat gmp mpfr boost
    oneTBB nlopt qhull
    libpng libjpeg_turbo
    draco libnoise
  ];

in
symlinkJoin {
  name = "orcaslicer-deps-0.1.0";
  paths = allDeps;

  postBuild = ''
    # Verify key outputs exist
    test -f $out/include/Eigen/Core || (echo "ERROR: Eigen headers missing" && exit 1)
    test -f $out/include/cereal/cereal.hpp || (echo "ERROR: cereal headers missing" && exit 1)
    test -f $out/include/nlohmann/json.hpp || (echo "ERROR: nlohmann_json headers missing" && exit 1)
    test -d $out/include/CGAL || (echo "ERROR: CGAL headers missing" && exit 1)
    test -f $out/lib/libz.a || (echo "ERROR: zlib missing" && exit 1)
    test -f $out/include/expat.h || (echo "ERROR: expat headers missing" && exit 1)
    test -f $out/lib/libgmp.a || (echo "ERROR: GMP library missing" && exit 1)
    test -f $out/include/gmp.h || (echo "ERROR: GMP headers missing" && exit 1)
    test -f $out/lib/libmpfr.a || (echo "ERROR: MPFR library missing" && exit 1)
    test -f $out/include/mpfr.h || (echo "ERROR: MPFR headers missing" && exit 1)
    test -d $out/include/boost || (echo "ERROR: Boost headers missing" && exit 1)
    test -f $out/include/boost/version.hpp || (echo "ERROR: Boost version.hpp missing" && exit 1)
    test -f $out/lib/libboost_filesystem.a || (echo "ERROR: Boost filesystem missing" && exit 1)
    test -f $out/lib/libboost_system.a || (echo "ERROR: Boost system missing" && exit 1)
    test -f $out/lib/libboost_thread.a || (echo "ERROR: Boost thread missing" && exit 1)
    test -f $out/lib/libboost_log.a || (echo "ERROR: Boost log missing" && exit 1)
    test -f $out/lib/libboost_regex.a || (echo "ERROR: Boost regex missing" && exit 1)
    test -f $out/lib/libboost_iostreams.a || (echo "ERROR: Boost iostreams missing" && exit 1)
    test -f $out/lib/libboost_nowide.a || (echo "ERROR: Boost nowide missing" && exit 1)
    test -f $out/lib/libtbb.a || (echo "ERROR: oneTBB library missing" && exit 1)
    test -d $out/include/oneapi/tbb || (echo "ERROR: oneTBB headers missing" && exit 1)
    test -f $out/lib/libnlopt_cxx.a || (echo "ERROR: NLopt library missing" && exit 1)
    test -f $out/include/nlopt.h || (echo "ERROR: NLopt headers missing" && exit 1)
    test -f $out/lib/libqhullstatic_r.a || (echo "ERROR: Qhull library missing" && exit 1)
    test -d $out/include/libqhull_r || (echo "ERROR: Qhull headers missing" && exit 1)
    test -f $out/lib/libpng.a || (echo "ERROR: libpng missing" && exit 1)
    test -f $out/include/png.h || (echo "ERROR: libpng headers missing" && exit 1)
    test -f $out/lib/libjpeg.a || (echo "ERROR: libjpeg missing" && exit 1)
    test -f $out/include/jpeglib.h || (echo "ERROR: libjpeg headers missing" && exit 1)
    test -f $out/include/nanosvg/nanosvg.h || (echo "ERROR: nanosvg headers missing" && exit 1)
    test -f $out/lib/libdraco.a || (echo "ERROR: draco library missing" && exit 1)
    test -d $out/include/draco || (echo "ERROR: draco headers missing" && exit 1)
    test -f $out/lib/libnoise.a || test -f $out/lib/liblibnoise.a || test -f $out/lib/liblibnoise_static.a || (echo "ERROR: libnoise missing" && exit 1)

    echo ""
    echo "========================================"
    echo "orcaslicer-deps: ALL deps built successfully"
    echo "========================================"
  '';

  meta = with lib; {
    description = "Cross-compiled WASM dependencies for OrcaSlicer's libslic3r";
    license = with licenses; [ zlib mit bsd3 lgpl3Plus lgpl21Plus bsl11 asl20 gpl3Plus agpl3Plus libpng isc asl20 ];
    platforms = platforms.all;
  };
}
