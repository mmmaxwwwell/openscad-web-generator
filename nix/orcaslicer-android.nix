# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Cross-compile OrcaSlicer's libslic3r for Android ARM64/ARM32 using Android NDK.
#
# Produces libslic3r.so with all transitive dependencies statically linked.
# The .so exports libslic3r C++ symbols for JNI bindings (task 6.2).
#
# Usage from flake.nix:
#   packages.orcaslicer-android-arm64 = pkgs.callPackage ./nix/orcaslicer-android.nix {
#     androidNdk = "<path-to-ndk>";
#     androidAbi = "arm64-v8a";
#   };
#
# Architecture:
#   Stage 1: Cross-compile all C++ dependencies (same sources as orcaslicer-deps.nix)
#   Stage 2: Cross-compile OrcaSlicer libslic3r (same patches as orcaslicer-lib.nix)
#   Stage 3: Link everything into a single libslic3r.so
#
{ lib
, stdenv
, fetchFromGitHub
, fetchFromGitLab
, fetchurl
, cmake
, ninja
, python3
, autoconf
, automake
, libtool
, m4
, which
, symlinkJoin
, callPackage
, androidNdk
, androidAbi ? "arm64-v8a"       # "arm64-v8a" or "armeabi-v7a"
, androidPlatform ? "24"          # minimum API level (Android 7.0)
}:

let
  # ============================================================
  # NDK toolchain paths
  # ============================================================
  toolchainFile = "${androidNdk}/build/cmake/android.toolchain.cmake";
  toolchainBin = "${androidNdk}/toolchains/llvm/prebuilt/linux-x86_64/bin";
  sysroot = "${androidNdk}/toolchains/llvm/prebuilt/linux-x86_64/sysroot";

  # Map ABI to compiler triple and configure host
  triplePrefix = if androidAbi == "arm64-v8a"
    then "aarch64-linux-android"
    else "armv7a-linux-androideabi";

  configureHost = if androidAbi == "arm64-v8a"
    then "aarch64-linux-android"
    else "armv7a-linux-androideabi";

  boostArch = if androidAbi == "arm64-v8a" then "arm" else "arm";
  boostAddrModel = if androidAbi == "arm64-v8a" then "64" else "32";

  cc = "${toolchainBin}/${triplePrefix}${androidPlatform}-clang";
  cxx = "${toolchainBin}/${triplePrefix}${androidPlatform}-clang++";
  ar = "${toolchainBin}/llvm-ar";
  ranlib = "${toolchainBin}/llvm-ranlib";
  strip = "${toolchainBin}/llvm-strip";

  # Common CMake flags for Android NDK cross-compilation
  androidCmakeFlags = [
    "-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}"
    "-DANDROID_ABI=${androidAbi}"
    "-DANDROID_PLATFORM=android-${androidPlatform}"
    "-DANDROID_STL=c++_shared"
    "-DCMAKE_POLICY_VERSION_MINIMUM=3.5"
    "-DBUILD_SHARED_LIBS=OFF"
  ];

  # ============================================================
  # Common builder for Android NDK CMake libraries
  # ============================================================
  mkAndroidLib = { pname, version, src, cmakeFlags ? [], buildInputs ? []
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
        cmake ninja python3
      ] ++ extraNativeBuildInputs;

      inherit buildInputs;

      buildPhase = if buildPhaseOverride != null then buildPhaseOverride else ''
        runHook preBuild

        export HOME=$TMPDIR

        # Standard C/C++ flags for Android cross-compilation
        export CFLAGS="-fexceptions -fPIC"
        export CXXFLAGS="-fexceptions -fPIC"
        export LDFLAGS="-fexceptions"

        # Fix shebangs for Nix sandbox
        patchShebangs .

        ${postUnpackPhase}

        ${preBuildPhase}

        ${if usesCMake then ''
          cmake \
            -B build \
            -G Ninja \
            -DCMAKE_INSTALL_PREFIX=$out \
            ${lib.concatStringsSep " \\\n      " androidCmakeFlags} \
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
  # SOURCES (same as orcaslicer-deps.nix)
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

  orcaSlicerSrc = fetchFromGitHub {
    owner = "SoftFever";
    repo = "OrcaSlicer";
    rev = "v2.3.1";
    hash = "sha256-ua5ZcOnJ8oeY/g6dM9088lYdPNalWLYnD3DNDnw3Q5E=";
  };

  # ============================================================
  # INDIVIDUAL LIBRARY DERIVATIONS
  # ============================================================

  # ---- Header-only libraries ----

  nanosvg = stdenv.mkDerivation {
    pname = "orcaslicer-android-dep-nanosvg";
    version = "0-unstable";
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

  eigen = mkAndroidLib {
    pname = "orcaslicer-android-dep-eigen";
    version = "3.4.0";
    src = sources.eigen;
    cmakeFlags = [];
    installPhaseOverride = ''
      runHook preInstall
      ln -sf $out/include/eigen3/Eigen $out/include/Eigen
      ln -sf $out/include/eigen3/unsupported $out/include/unsupported
      runHook postInstall
    '';
  };

  cereal = mkAndroidLib {
    pname = "orcaslicer-android-dep-cereal";
    version = "1.3.2";
    src = sources.cereal;
    cmakeFlags = [
      "-DBUILD_TESTS=OFF"
      "-DBUILD_DOC=OFF"
      "-DBUILD_SANDBOX=OFF"
      "-DSKIP_PERFORMANCE_COMPARISON=ON"
    ];
  };

  nlohmann_json = mkAndroidLib {
    pname = "orcaslicer-android-dep-nlohmann-json";
    version = "3.11.3";
    src = sources.nlohmann_json;
    cmakeFlags = [
      "-DJSON_BuildTests=OFF"
      "-DJSON_MultipleHeaders=ON"
    ];
  };

  cgal = mkAndroidLib {
    pname = "orcaslicer-android-dep-cgal";
    version = "5.6.3";
    src = sources.cgal;
    cmakeFlags = [
      "-DWITH_examples=OFF"
      "-DWITH_demos=OFF"
      "-DCGAL_ENABLE_TESTING=OFF"
    ];
  };

  # ---- Compiled libraries (no deps) ----

  zlib = mkAndroidLib {
    pname = "orcaslicer-android-dep-zlib";
    version = "1.3.1";
    src = sources.zlib;
    usesCMake = false;
    preBuildPhase = ''
      cmake \
        -DINSTALL_PKGCONFIG_DIR="$out/lib/pkgconfig/" \
        -DCMAKE_INSTALL_PREFIX=$out \
        ${lib.concatStringsSep " \\\n        " androidCmakeFlags} \
        -B build
      cmake --build build --parallel
      cmake --install build
    '';
  };

  libexpat = mkAndroidLib {
    pname = "orcaslicer-android-dep-libexpat";
    version = "2.6.4";
    src = sources.libexpat;
    usesCMake = false;
    extraNativeBuildInputs = [ autoconf automake libtool m4 which ];
    preBuildPhase = ''
      cd expat
      ./buildconf.sh

      # Cross-compile with NDK toolchain
      export CC="${cc}"
      export CXX="${cxx}"
      export AR="${ar}"
      export RANLIB="${ranlib}"

      ./configure \
        --without-docbook \
        --host=${configureHost} \
        --prefix=$out \
        --enable-shared=no \
        --enable-static=yes \
        --disable-dependency-tracking

      make -j$NIX_BUILD_CORES
      make install

      # Remove cmake config files that reference shared lib
      rm -rf $out/lib/cmake/expat-*
    '';
  };

  gmp = mkAndroidLib {
    pname = "orcaslicer-android-dep-gmp";
    version = "6.3.0";
    src = sources.gmp;
    usesCMake = false;
    dontUnpackSrc = true;
    extraNativeBuildInputs = [ m4 ];
    postUnpackPhase = ''
      mkdir -p $TMPDIR/gmp-src
      cd $TMPDIR/gmp-src
      tar xf ${sources.gmp} --strip-components=1
      patchShebangs .
    '';
    preBuildPhase = ''
      cd $TMPDIR/gmp-src

      export CC="${cc}"
      export CXX="${cxx}"
      export AR="${ar}"
      export RANLIB="${ranlib}"
      export CFLAGS="-fPIC -fexceptions"
      export CXXFLAGS="-fPIC -fexceptions"

      ./configure \
        --enable-cxx \
        --host=${configureHost} \
        --enable-fft=yes \
        --enable-alloca=malloc-notreentrant \
        --enable-shared=no \
        --enable-static=yes \
        --with-pic \
        --prefix=$out

      make -j$NIX_BUILD_CORES
      make install
    '';
  };

  mpfr = mkAndroidLib {
    pname = "orcaslicer-android-dep-mpfr";
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

      export CC="${cc}"
      export CXX="${cxx}"
      export AR="${ar}"
      export RANLIB="${ranlib}"

      ./configure \
        --host=${configureHost} \
        --with-gmp=${gmp} \
        --enable-shared=no \
        --enable-static=yes \
        --prefix=$out

      make -j$NIX_BUILD_CORES
      make install
    '';
  };

  boost = mkAndroidLib {
    pname = "orcaslicer-android-dep-boost";
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

      # Bootstrap builds the b2 tool using the host compiler
      ./bootstrap.sh

      # Create user-config.jam for Android NDK cross-compilation
      cat > user-config.jam << 'USERCONFIG'
using clang : android
  : ${cxx}
  : <archiver>${ar}
    <ranlib>${ranlib}
  ;
USERCONFIG

      # Build Boost with Android NDK clang
      # threading=multi: Android has real pthreads
      ./b2 \
        --user-config=user-config.jam \
        toolset=clang-android \
        target-os=android \
        link=static \
        threading=multi \
        address-model=${boostAddrModel} \
        variant=release \
        cxxflags="-fPIC -fexceptions --sysroot=${sysroot}" \
        linkflags="--sysroot=${sysroot}" \
        --with-system \
        --with-filesystem \
        --with-thread \
        --with-log \
        --with-regex \
        --with-chrono \
        --with-atomic \
        --with-date_time \
        --with-iostreams \
        --with-nowide \
        --prefix=$out \
        -j$NIX_BUILD_CORES \
        install
    '' + lib.optionalString (androidAbi == "armeabi-v7a") ''
      # ARM32 workaround: Boost's GDB pretty-printer headers embed inline asm using
      # @progbits syntax which ARM32's clang integrated assembler doesn't support
      # (ARM32 ELF uses %progbits). Patch the installed headers.
      grep -rl '@progbits' $out/include/ 2>/dev/null | while read f; do
        sed -i 's/@progbits/%progbits/g' "$f"
      done || true
    '';
  };

  oneTBB = mkAndroidLib {
    pname = "orcaslicer-android-dep-onetbb";
    version = "2021.13.0";
    src = sources.oneTBB;
    # TBB uses CMake — Android NDK provides pthreads natively
    cmakeFlags = [
      "-DTBB_BUILD_SHARED=OFF"
      "-DTBB_STRICT=OFF"
      "-DTBB_TEST=OFF"
      "-DTBB_EXAMPLES=OFF"
      "-DTBB_DISABLE_HWLOC_AUTOMATIC_SEARCH=ON"
      "-DCMAKE_POSITION_INDEPENDENT_CODE=ON"
      "-DTBB_BUILD_TBBMALLOC=ON"
    ];
  };

  nlopt = mkAndroidLib {
    pname = "orcaslicer-android-dep-nlopt";
    version = "2.5.0";
    src = sources.nlopt;
    cmakeFlags = [
      "-DNLOPT_PYTHON=OFF"
      "-DNLOPT_OCTAVE=OFF"
      "-DNLOPT_MATLAB=OFF"
      "-DNLOPT_GUILE=OFF"
      "-DNLOPT_SWIG=OFF"
      "-DNLOPT_TESTS=OFF"
      "-DNLOPT_CXX=ON"
    ];
  };

  qhull = mkAndroidLib {
    pname = "orcaslicer-android-dep-qhull";
    version = "8.0.2";
    src = sources.qhull;
    cmakeFlags = [
      "-DBUILD_APPLICATIONS=OFF"
      "-DQHULL_ENABLE_TESTING=OFF"
    ];
  };

  libpng = mkAndroidLib {
    pname = "orcaslicer-android-dep-libpng";
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

  libjpeg_turbo = mkAndroidLib {
    pname = "orcaslicer-android-dep-libjpeg-turbo";
    version = "3.0.1";
    src = sources.libjpeg_turbo;
    cmakeFlags = [
      "-DENABLE_SHARED=OFF"
      "-DENABLE_STATIC=ON"
      "-DWITH_TURBOJPEG=OFF"
    ];
  };

  draco = mkAndroidLib {
    pname = "orcaslicer-android-dep-draco";
    version = "1.5.7";
    src = sources.draco;
    cmakeFlags = [
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
      "-DDRACO_WASM=OFF"
    ];
  };

  libnoise = mkAndroidLib {
    pname = "orcaslicer-android-dep-libnoise";
    version = "1.0";
    src = sources.libnoise;
    cmakeFlags = [];
  };

  # ============================================================
  # All deps merged
  # ============================================================
  allDeps = [
    nanosvg eigen cereal nlohmann_json cgal
    zlib libexpat gmp mpfr boost
    oneTBB nlopt qhull
    libpng libjpeg_turbo
    draco libnoise
  ];

  deps = symlinkJoin {
    name = "orcaslicer-android-deps-${androidAbi}";
    paths = allDeps;

    postBuild = ''
      # Verify key outputs
      test -d $out/include/Eigen || test -d $out/include/eigen3/Eigen || (echo "ERROR: Eigen headers missing" && exit 1)
      test -f $out/lib/libz.a || (echo "ERROR: zlib missing" && exit 1)
      test -f $out/lib/libgmp.a || (echo "ERROR: GMP missing" && exit 1)
      test -f $out/lib/libmpfr.a || (echo "ERROR: MPFR missing" && exit 1)
      test -d $out/include/boost || (echo "ERROR: Boost headers missing" && exit 1)
      test -f $out/lib/libtbb.a || (echo "ERROR: TBB missing" && exit 1)

      echo ""
      echo "========================================"
      echo "orcaslicer-android-deps (${androidAbi}): ALL deps built"
      echo "========================================"
    '';
  };

  # ============================================================
  # Stage 2: OrcaSlicer libslic3r static libraries
  # Same patches as orcaslicer-lib.nix but for Android NDK
  # Key differences:
  # - Real pthreads (no BOOST_LOG_NO_THREADS, no Threads stub)
  # - No Emscripten-specific flags (-matomics, -mbulk-memory)
  # - Uses NDK CMake toolchain instead of emcmake
  # ============================================================
  orcaslicerLib = stdenv.mkDerivation {
    pname = "orcaslicer-android-lib-${androidAbi}";
    version = "2.3.1";

    src = orcaSlicerSrc;

    dontConfigure = true;
    doCheck = false;

    nativeBuildInputs = [ cmake ninja python3 ];

    buildPhase = ''
      runHook preBuild

      export HOME=$TMPDIR

      # Work in a copy so we can patch
      cp -r $src $TMPDIR/orcaslicer
      chmod -R u+w $TMPDIR/orcaslicer
      patchShebangs $TMPDIR/orcaslicer
      cd $TMPDIR/orcaslicer

      # ============================================================
      # PATCHES — same as orcaslicer-lib.nix (remove SLA, STEP, etc.)
      # ============================================================

      # Remove files not needed for FDM slicing
      sed -i '/Emboss\.cpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/Emboss\.hpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/EmbossShape\.hpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/Format\/STEP\.hpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/Format\/STEP\.cpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/Format\/svg\.cpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/Format\/svg\.hpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/TextShape/d' src/libslic3r/CMakeLists.txt
      sed -i '/FaceDetector\.cpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/FaceDetector\.hpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/ObjColorUtils\.hpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/BlacklistedLibraryCheck\.cpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/BlacklistedLibraryCheck\.hpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/NSVGUtils\.cpp/d' src/libslic3r/CMakeLists.txt
      sed -i '/NSVGUtils\.hpp/d' src/libslic3r/CMakeLists.txt

      # Python-based CMakeLists.txt patching (same as WASM build)
      cat > $TMPDIR/patch_cmake.py << 'PATCH_CMAKE_PY'
import re, sys

with open(sys.argv[1], "r") as f:
    content = f.read()

for pattern in [
    "SLA/", "SLAPrint", "SLAPrintSteps",
    "Format/SL1", "Format/AnycubicSLA", "Format/SLAArchive",
]:
    content = re.sub(r"^.*" + re.escape(pattern) + r".*\n", "", content, flags=re.MULTILINE)

content = content.replace("''${OpenVDBUtils_SOURCES}", "")

content = re.sub(
    r"set\(OCCT_LIBS\b.*?\)",
    "set(OCCT_LIBS)  # Emptied for Android build",
    content,
    flags=re.DOTALL
)

content = re.sub(r"^.*OpenCASCADE.*\n", "", content, flags=re.MULTILINE)
content = re.sub(r"^.*find_package\(OpenCV.*\n", "", content, flags=re.MULTILINE)
content = re.sub(r"^.*find_package\(libnoise.*\n", "", content, flags=re.MULTILINE)

for lib in [
    "''${CMAKE_DL_LIBS}", "''${OCCT_LIBS}", "opencv_world",
    "TBB::tbbmalloc",
]:
    content = content.replace("        " + lib + "\n", "")

content = re.sub(
    r"if\s*\(TARGET OpenVDB::openvdb\).*?endif\(\)",
    "# OpenVDB removed for Android build",
    content,
    flags=re.DOTALL
)

content = re.sub(
    r"if\s*\(WIN32\)\s*\n\s*target_link_libraries\(libslic3r PRIVATE Psapi\.lib\)\s*\nendif\(\)",
    "# Psapi removed for Android build",
    content,
    flags=re.DOTALL
)

content = re.sub(
    r"if\s*\(NOT WIN32\)\s*\n.*?FREETYPE.*?endif\(\)\s*\nendif\(\)",
    "# freetype/OpenSSL/fontconfig removed for Android build",
    content,
    flags=re.DOTALL
)

content = re.sub(
    r"if\s*\(APPLE\)\s*\n\s*find_library\(FOUNDATION.*?endif\s*\(\s*\)",
    "# Apple frameworks removed for Android build",
    content,
    flags=re.DOTALL
)

with open(sys.argv[1], "w") as f:
    f.write(content)
PATCH_CMAKE_PY
      python3 $TMPDIR/patch_cmake.py src/libslic3r/CMakeLists.txt

      # Remove GUI-only bundled deps
      sed -i '/hidapi/d' deps_src/CMakeLists.txt
      sed -i '/imgui/d' deps_src/CMakeLists.txt
      sed -i '/imguizmo/d' deps_src/CMakeLists.txt
      sed -i '/hints/d' deps_src/CMakeLists.txt
      sed -i '/add_subdirectory.*nlohmann/d' deps_src/CMakeLists.txt
      sed -i '/add_subdirectory.*qhull/d' deps_src/CMakeLists.txt

      # Fix NLopt target name
      sed -i 's/NLopt::nlopt/NLopt::nlopt_cxx/' deps_src/libnest2d/CMakeLists.txt
      sed -i 's/TBB::tbbmalloc//' deps_src/libnest2d/CMakeLists.txt

      # Stub out STEP support
      sed -i '/#include "Format\/STEP.hpp"/d' src/libslic3r/Model.hpp
      sed -i '/^namespace Slic3r {/a\
typedef std::function<void(int, int, int, bool\&)> ImportStepProgressFn;\
typedef std::function<void(bool)> StepIsUtf8Fn;\
class Step;' src/libslic3r/Model.hpp

      # Stub FaceDetector
      sed -i '/#include "FaceDetector.hpp"/d' src/libslic3r/Model.cpp
      sed -i 's/FaceDetector face_detector(all_meshes, all_transfos, 1.0);/\/\/ FaceDetector removed for Android build/' src/libslic3r/Model.cpp
      sed -i 's/face_detector.detect_exterior_face();//' src/libslic3r/Model.cpp

      # Stub read_from_step
      cat > $TMPDIR/patch_step.py << 'PATCH_STEP_PY'
import sys

with open(sys.argv[1], "r") as f:
    lines = f.readlines()

start = None
for i, line in enumerate(lines):
    if "Model Model::read_from_step" in line:
        start = i
        break

if start is None:
    print("WARNING: read_from_step not found, skipping patch")
    sys.exit(0)

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
    '    throw Slic3r::RuntimeError("STEP format not supported in Android build");\n',
    "}\n",
]
lines[start:end+1] = stub

with open(sys.argv[1], "w") as f:
    f.writelines(lines)
PATCH_STEP_PY
      python3 $TMPDIR/patch_step.py src/libslic3r/Model.cpp

      # Stub OpenSSL MD5
      sed -i 's|#include <openssl/md5.h>|// openssl/md5.h removed for Android build|' src/libslic3r/Utils.hpp
      # sstream include fix
      sed -i '1i #include <sstream>' src/libslic3r/LocalesUtils.cpp

      # Stub Boost.Log file sink and copy_option compat
      cat > $TMPDIR/patch_utils_log.py << 'PATCH_UTILS_LOG_PY'
import re, sys
with open(sys.argv[1], "r") as f:
    content = f.read()

content = content.replace(
    'boost::shared_ptr<boost::log::sinks::synchronous_sink<boost::log::sinks::text_file_backend>> g_log_sink;',
    '// g_log_sink removed for Android build\n'
    'static bool g_log_sink = false;'
)

content = content.replace("copy_option::overwrite_if_exists", "copy_options::overwrite_existing")

content = re.sub(
    r'(g_log_sink = boost::log::add_file_log\(.*?\);)',
    '// File logging disabled for Android build\n    g_log_sink = true;',
    content,
    flags=re.DOTALL
)

content = re.sub(r'.*current_thread_id.*\n', "", content)
content = content.replace("g_log_sink->flush()", "/* flush disabled */")
content = content.replace("g_log_sink->locked_backend()", "/* locked_backend disabled */  nullptr")

with open(sys.argv[1], "w") as f:
    f.write(content)
PATCH_UTILS_LOG_PY
      python3 $TMPDIR/patch_utils_log.py src/libslic3r/utils.cpp

      # Stub MD5 in bbs_3mf.cpp
      mkdir -p src/libslic3r/openssl_stub
      cat > src/libslic3r/openssl_stub/md5.h << 'MD5_STUB'
#pragma once
#include <cstring>
typedef struct { int dummy; } MD5_CTX;
static inline int MD5_Init(MD5_CTX *) { return 1; }
static inline int MD5_Update(MD5_CTX *, const void *, size_t) { return 1; }
static inline int MD5_Final(unsigned char md[16], MD5_CTX *) { memset(md, 0, 16); return 1; }
MD5_STUB
      sed -i 's|#include <openssl/md5.h>|#include "openssl_stub/md5.h"|' src/libslic3r/Format/bbs_3mf.cpp

      # Stub bbl_calc_md5
      cat > $TMPDIR/patch_md5.py << 'PATCH_MD5_PY'
import re, sys
with open(sys.argv[1], "r") as f:
    content = f.read()
content = re.sub(
    r"bool bbl_calc_md5\(std::string &filename, std::string &md5_out\)\s*\{.*?\n\}",
    "bool bbl_calc_md5(std::string &filename, std::string &md5_out)\n{\n    md5_out = \"\";\n    return false;\n}",
    content,
    flags=re.DOTALL
)
with open(sys.argv[1], "w") as f:
    f.write(content)
PATCH_MD5_PY
      python3 $TMPDIR/patch_md5.py src/libslic3r/utils.cpp

      # Platform.cpp — Android is detected as __linux__ so the Linux path works.
      # But add __ANDROID__ detection for cleaner logging.
      substituteInPlace src/libslic3r/Platform.cpp \
        --replace-fail \
          '#else
	// This should not happen.
    BOOST_LOG_TRIVIAL(info) << "Platform: Unknown";
	static_assert(false, "Unknown platform detected");
	s_platform 		  = Platform::Unknown;
	s_platform_flavor = PlatformFlavor::Unknown;' \
          '#elif defined(__ANDROID__)
    BOOST_LOG_TRIVIAL(info) << "Platform: Android";
	s_platform        = Platform::Linux;
	s_platform_flavor = PlatformFlavor::GenericLinux;
#elif defined(__EMSCRIPTEN__)
    BOOST_LOG_TRIVIAL(info) << "Platform: Emscripten/WASM";
	s_platform        = Platform::Linux;
	s_platform_flavor = PlatformFlavor::GenericLinux;
#else
	// This should not happen.
    BOOST_LOG_TRIVIAL(info) << "Platform: Unknown";
	static_assert(false, "Unknown platform detected");
	s_platform 		  = Platform::Unknown;
	s_platform_flavor = PlatformFlavor::Unknown;'

      # Thread.cpp — pthread_getname_np not available until Android API 26
      # Guard it with __ANDROID__ to return empty string instead
      substituteInPlace src/libslic3r/Thread.cpp \
        --replace-fail \
          'return std::string(pthread_getname_np(pthread_self(), buf, 16) == 0 ? buf : "");' \
          '#if defined(__ANDROID__)
        return std::string("");
#else
        return std::string(pthread_getname_np(pthread_self(), buf, 16) == 0 ? buf : "");
#endif'

      # utils.cpp — stub out boost::locale on Android (requires iconv which is hard to
      # cross-compile). Replace the include and normalize_utf8_nfc with a passthrough.
      sed -i 's|#include <boost/locale.hpp>|#ifndef __ANDROID__\n#include <boost/locale.hpp>\n#endif|' src/libslic3r/utils.cpp
      cat > $TMPDIR/patch_normalize.py << 'PATCH_PY'
import re, sys
with open(sys.argv[1], "r") as f:
    content = f.read()
# Replace the normalize_utf8_nfc function with an Android-guarded version
old_func = re.search(
    r'(std::string\s+normalize_utf8_nfc\s*\([^)]*\)\s*\{)(.*?)(\n\})',
    content, re.DOTALL
)
if old_func:
    full_match = old_func.group(0)
    replacement = (
        '#ifdef __ANDROID__\n'
        'std::string normalize_utf8_nfc(const char *src) {\n'
        '    return src ? std::string(src) : std::string();\n'
        '}\n'
        '#else\n'
        + full_match + '\n'
        '#endif'
    )
    content = content.replace(full_match, replacement)
with open(sys.argv[1], "w") as f:
    f.write(content)
PATCH_PY
      python3 $TMPDIR/patch_normalize.py src/libslic3r/utils.cpp

      # Stub headers for transitive includes
      cat > src/libslic3r/ObjColorUtils.hpp << 'OPENCV_STUB'
#pragma once
OPENCV_STUB

      cat > src/libslic3r/Format/STEP.hpp << 'STEP_STUB'
#pragma once
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

      cat > src/libslic3r/BlacklistedLibraryCheck.hpp << 'BLC_STUB'
#pragma once
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

      mkdir -p src/libslic3r/SLA
      cat > src/libslic3r/SLA/IndexedMesh.hpp << 'SLA_STUB'
#pragma once
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
JOB_STUB

      cat > src/libslic3r/SLA/Concurrency.hpp << 'CONC_STUB'
#pragma once
CONC_STUB

      cat > src/libslic3r/SLA/SupportPoint.hpp << 'SP_STUB'
#pragma once
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
      # Custom top-level CMakeLists.txt (same structure as WASM but for Android)
      # Key differences:
      # - No Emscripten-specific settings
      # - Real pthreads (Threads::Threads finds pthreads natively via NDK)
      # - Uses NDK toolchain for cross-compilation
      # ============================================================
      cat > CMakeLists.txt << 'TOPLEVEL_CMAKE'
cmake_minimum_required(VERSION 3.13)
project(orcaslicer-android)

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
set(SLIC3R_BUILD_ID "android" CACHE STRING "" FORCE)

set(CMAKE_FIND_PACKAGE_PREFER_CONFIG ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

list(APPEND CMAKE_MODULE_PATH ''${PROJECT_SOURCE_DIR}/cmake/modules/)

add_compile_options(-fsigned-char -fPIC -Wno-c++11-narrowing)

# ---- Boost ----
set(MINIMUM_BOOST_VERSION "1.83.0")
set(_boost_components "system;filesystem;thread;log;regex;chrono;atomic;date_time;iostreams;nowide")
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
endfunction()

# ---- CURL stub ----
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

# ---- libnoise ----
find_package(libnoise REQUIRED)

# ---- Draco ----
find_package(draco REQUIRED)

# ---- Threads (Android has real pthreads via NDK) ----
find_package(Threads REQUIRED)

# ---- OpenCV stub ----
add_library(opencv_world INTERFACE)

set(LIBDIR_BIN ''${CMAKE_CURRENT_BINARY_DIR}/src)
include_directories(''${LIBDIR_BIN}/dev-utils)
include_directories(''${CMAKE_CURRENT_SOURCE_DIR}/src)
include_directories(''${CMAKE_CURRENT_BINARY_DIR}/src)

add_subdirectory(src/dev-utils)
add_subdirectory(deps_src)
add_subdirectory(src/libslic3r)

install(TARGETS libslic3r libslic3r_cgal ARCHIVE DESTINATION lib)
install(DIRECTORY src/libslic3r/ DESTINATION include/libslic3r
    FILES_MATCHING PATTERN "*.hpp" PATTERN "*.h")
install(FILES ''${CMAKE_CURRENT_BINARY_DIR}/src/libslic3r/libslic3r_version.h
    DESTINATION include/libslic3r)
TOPLEVEL_CMAKE

      # ============================================================
      # ARM32 workaround: GMP's gmpxx.h embeds GDB pretty-printer scripts via inline
      # asm using @progbits, which ARM32's clang integrated assembler doesn't support
      # (it expects %progbits). Copy and patch the affected headers, then prepend as
      # a system include path so they're found before the originals.
      # ============================================================
      # ============================================================
      # BUILD
      # ============================================================
      mkdir -p build
      cd build

      cmake \
        .. \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=$TMPDIR/install \
        -DCMAKE_PREFIX_PATH=${deps} \
        -DCMAKE_FIND_ROOT_PATH=${deps} \
        -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH \
        -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=BOTH \
        -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=BOTH \
        ${lib.concatStringsSep " \\\n        " androidCmakeFlags}

      cmake --build . --parallel

      cmake --install .

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out/lib $out/include

      cp -r $TMPDIR/install/* $out/

      # Copy bundled dep .a files
      find $TMPDIR/orcaslicer/build -name '*.a' -exec cp {} $out/lib/ \;

      # Install bundled dependency headers
      for dir in $TMPDIR/orcaslicer/deps_src/*/; do
        depname=$(basename "$dir")
        (cd "$dir" && find . \( -name '*.h' -o -name '*.hpp' -o -name '*.hxx' \) | while read -r f; do
          install -D -m 644 "$f" "$out/include/$f"
          install -D -m 644 "$f" "$out/include/$depname/$f"
        done) || true
      done

      # Verify key outputs
      test -f $out/lib/liblibslic3r.a || (echo "ERROR: liblibslic3r.a missing" && exit 1)
      test -f $out/lib/liblibslic3r_cgal.a || (echo "ERROR: liblibslic3r_cgal.a missing" && exit 1)

      echo ""
      echo "========================================"
      echo "orcaslicer-android-lib (${androidAbi}): Build successful"
      echo "========================================"

      runHook postInstall
    '';
  };

in

# ============================================================
# Stage 3: Link all static libraries into a single libslic3r.so
# ============================================================
stdenv.mkDerivation {
  pname = "orcaslicer-android-${androidAbi}";
  version = "2.3.1";

  # No source — we just link pre-built libraries
  dontUnpack = true;
  dontConfigure = true;
  doCheck = false;

  nativeBuildInputs = [ cmake ninja ];

  buildPhase = ''
    runHook preBuild

    export HOME=$TMPDIR

    # Create a minimal CMakeLists.txt that links everything into a .so
    cat > $TMPDIR/CMakeLists.txt << 'LINK_CMAKE'
cmake_minimum_required(VERSION 3.13)
project(orcaslicer-android-so)

set(CMAKE_CXX_STANDARD 17)

# Minimal C++ source with stubs for symbols not needed on Android
file(WRITE "''${CMAKE_BINARY_DIR}/slicer_stubs.cpp" [=[
#include <locale>
#include <string>
#include <vector>

extern "C" const char* orcaslicer_version() { return "2.3.1"; }
extern "C" const char* orcaslicer_abi() { return "${androidAbi}"; }

// boost::locale stubs are provided via source patching in lib stage (utils.cpp)

// Stub read_from_disk — used by 3MF exporter for embedded file data, not needed for basic slicing
namespace Slic3r {
  std::string read_from_disk(std::string const&) { return ""; }
}

// Stub RGB2HSV — used by FlushVolCalc, not critical for basic slicing
void RGB2HSV(float, float, float, float* h, float* s, float* v) {
  if (h) *h = 0; if (s) *s = 0; if (v) *v = 0;
}

// Stub NSVGUtils symbols (SVG embedding not needed for slicing)
namespace Slic3r {
  class Model;
  bool load_svg(const char*, Model*, std::string&) { return false; }
}

// Stub Emboss symbols (text embedding not needed for slicing)
namespace Slic3r {
  class Polygon;
  class ExPolygonsWithId;
  namespace Emboss {
    std::vector<Polygon> heal_polygons(const std::vector<Polygon>&, bool, unsigned int) { return {}; }
  }
  void center(std::vector<ExPolygonsWithId>&) {}
}
]=])


add_library(slic3r SHARED "''${CMAKE_BINARY_DIR}/slicer_stubs.cpp")
target_include_directories(slic3r PRIVATE ${deps}/include)

# Link all static libraries using whole-archive for core libs
# This ensures all C++ symbols are exported for JNI bindings
target_link_libraries(slic3r PRIVATE
    -Wl,--whole-archive
    ${orcaslicerLib}/lib/liblibslic3r.a
    ${orcaslicerLib}/lib/liblibslic3r_cgal.a
    -Wl,--no-whole-archive
)

# Bundled deps from OrcaSlicer build
file(GLOB BUNDLED_LIBS "${orcaslicerLib}/lib/lib*.a")
foreach(lib ''${BUNDLED_LIBS})
    # Skip core libs (already whole-archived above)
    get_filename_component(libname "''${lib}" NAME)
    if(NOT libname MATCHES "^liblibslic3r")
        target_link_libraries(slic3r PRIVATE "''${lib}")
    endif()
endforeach()

# External dependencies
target_link_libraries(slic3r PRIVATE
    ${deps}/lib/libboost_log_setup.a
    ${deps}/lib/libboost_log.a
    ${deps}/lib/libboost_filesystem.a
    ${deps}/lib/libboost_thread.a
    ${deps}/lib/libboost_regex.a
    ${deps}/lib/libboost_chrono.a
    ${deps}/lib/libboost_atomic.a
    ${deps}/lib/libboost_date_time.a
    ${deps}/lib/libboost_iostreams.a
    ${deps}/lib/libboost_nowide.a
    ${deps}/lib/libboost_system.a
    ${deps}/lib/libtbb.a
    ${deps}/lib/libtbbmalloc.a
    ${deps}/lib/libdraco.a
    ${deps}/lib/libpng.a
    ${deps}/lib/libjpeg.a
    ${deps}/lib/libz.a
    ${deps}/lib/libexpat.a
    ${deps}/lib/libmpfr.a
    ${deps}/lib/libgmp.a
)

# NLopt — may be named libnlopt_cxx.a or libnlopt.a
if(EXISTS "${deps}/lib/libnlopt_cxx.a")
    target_link_libraries(slic3r PRIVATE ${deps}/lib/libnlopt_cxx.a)
elseif(EXISTS "${deps}/lib/libnlopt.a")
    target_link_libraries(slic3r PRIVATE ${deps}/lib/libnlopt.a)
endif()

# Qhull
if(EXISTS "${deps}/lib/libqhullcpp.a")
    target_link_libraries(slic3r PRIVATE ${deps}/lib/libqhullcpp.a)
endif()
if(EXISTS "${deps}/lib/libqhullstatic_r.a")
    target_link_libraries(slic3r PRIVATE ${deps}/lib/libqhullstatic_r.a)
endif()

# libnoise
if(EXISTS "${deps}/lib/libnoise.a")
    target_link_libraries(slic3r PRIVATE ${deps}/lib/libnoise.a)
elseif(EXISTS "${deps}/lib/liblibnoise.a")
    target_link_libraries(slic3r PRIVATE ${deps}/lib/liblibnoise.a)
elseif(EXISTS "${deps}/lib/liblibnoise_static.a")
    target_link_libraries(slic3r PRIVATE ${deps}/lib/liblibnoise_static.a)
endif()

# Android system libraries
target_link_libraries(slic3r PRIVATE log z m dl)

set_target_properties(slic3r PROPERTIES
    OUTPUT_NAME "slic3r"
    SOVERSION "1"
)
LINK_CMAKE

    cd $TMPDIR

    cmake \
      -B build \
      -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      ${lib.concatStringsSep " \\\n      " androidCmakeFlags}

    cmake --build build --parallel

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib $out/include

    # Copy the shared library
    cp $TMPDIR/build/libslic3r.so $out/lib/

    # Also copy all static libraries for task 6.2 (JNI may link directly)
    cp --no-preserve=mode ${orcaslicerLib}/lib/*.a $out/lib/ || true
    cp --no-preserve=mode ${deps}/lib/*.a $out/lib/ || true

    # Copy headers for JNI compilation
    cp -r --no-preserve=mode ${orcaslicerLib}/include/* $out/include/
    cp -r --no-preserve=mode ${deps}/include/* $out/include/ || true

    # Verify
    test -f $out/lib/libslic3r.so || (echo "ERROR: libslic3r.so missing" && exit 1)

    echo ""
    echo "========================================"
    echo "orcaslicer-android (${androidAbi}): Build successful"
    echo "========================================"
    echo "Shared library:"
    ls -lh $out/lib/libslic3r.so

    runHook postInstall
  '';

  meta = with lib; {
    description = "OrcaSlicer's libslic3r compiled for Android ${androidAbi}";
    homepage = "https://github.com/SoftFever/OrcaSlicer";
    license = licenses.agpl3Plus;
    platforms = platforms.linux;
  };
}
