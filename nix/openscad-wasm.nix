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
, gettext
, gperf
, bison
, flex
, texinfo
, nodejs_22
, which
, importNpmLock
}:

let
  # All library sources pinned to exact versions/commits.
  # Where upstream uses --branch master --depth 1, we pin to a recent commit.
  # Use lib.fakeHash for initial builds; Nix will report the correct hash.
  fakeHash = lib.fakeHash;

  sources = {
    boost = fetchurl {
      url = "https://github.com/boostorg/boost/releases/download/boost-1.87.0/boost-1.87.0-b2-nodocs.tar.xz";
      hash = "sha256-Or16URGKXddGc7JeCj8KSrF1LY1hj0uM6oSmA67sxoA=";
    };

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

    libffi = fetchFromGitHub {
      owner = "libffi";
      repo = "libffi";
      rev = "v3.4.6";
      hash = "sha256-muFq0t2fqNbiXqz0p7LDm3lqcMcsonCLudZas63hgNI=";
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

    eigen = fetchFromGitLab {
      domain = "gitlab.com";
      owner = "libeigen";
      repo = "eigen";
      rev = "3.4.0";
      hash = "sha256-1/4xMetKMDOgZgzz3WMxfHUEpmdAm52RqZvz6i0mLEw=";
    };

    cgal = fetchFromGitHub {
      owner = "CGAL";
      repo = "cgal";
      rev = "v6.0.1";
      hash = "sha256-DEghjS+illECCzKIT4LbLrTxGxpIJo8CWz8q5n2zpGY=";
    };

    doubleconversion = fetchFromGitHub {
      owner = "google";
      repo = "double-conversion";
      rev = "v3.3.0";
      hash = "sha256-DkMoHHoHwV4p40IINEqEPzKsCa0LHrJAFw2Yftw7zHo=";
    };

    libxml2 = fetchFromGitLab {
      domain = "gitlab.gnome.org";
      owner = "GNOME";
      repo = "libxml2";
      rev = "v2.13.5";
      hash = "sha256-lDcayV4Z2AvMrHi1webliQuTazBKkVc7X8G/7H9pt4A=";
    };

    freetype = fetchFromGitHub {
      owner = "freetype";
      repo = "freetype";
      rev = "VER-2-13-3";
      hash = "sha256-4l90lDtpgm5xlh2m7ifrqNy373DTRTULRkAzicrM93c=";
    };

    libzip = fetchFromGitHub {
      owner = "nih-at";
      repo = "libzip";
      rev = "v1.11.2";
      hash = "sha256-CEoBvNxdLmHxr9w0+u4H0ic+9RmZtoz1hCnWdqWcXCI=";
    };

    harfbuzz = fetchFromGitHub {
      owner = "harfbuzz";
      repo = "harfbuzz";
      rev = "10.1.0";
      hash = "sha256-MBHNbS2aPYqzakiKplh6rZUEebk4kzON4u9hBJgq91Q=";
    };

    glib = fetchFromGitHub {
      owner = "kleisauke";
      repo = "glib";
      rev = "wasm-vips-2.83.2";
      hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      fetchSubmodules = true;
    };

    fontconfig = fetchFromGitLab {
      domain = "gitlab.freedesktop.org";
      owner = "fontconfig";
      repo = "fontconfig";
      rev = "2.15.0";
      hash = "sha256-XWQf5+c6qW8IURQBSCKkOaGiLxbnhwrWthHWBNvfTV8=";
    };

    lib3mf = fetchFromGitHub {
      owner = "3MFConsortium";
      repo = "lib3mf";
      rev = "v2.3.2";
      hash = "sha256-pKjnN9H6/A2zPvzpFed65J+mnNwG/dkSE2/pW7IlN58=";
      fetchSubmodules = true;
    };

    openscad = fetchFromGitHub {
      owner = "openscad";
      repo = "openscad";
      rev = "10cc3aa86098068f663e496ebf9742e670f5bab6";
      hash = "sha256-gGLwHlu674DEIWQiPzt2Mm45th+RooF3DPmvM1Zll1A=";
      fetchSubmodules = true;
    };

    # The upstream openscad-wasm repo (for runtime/ bundler and res/fonts/fonts.conf)
    openscad-wasm = fetchFromGitHub {
      owner = "openscad";
      repo = "openscad-wasm";
      rev = "ac5cf9b129bdb243fef3862883bd5d64e54fffcb";
      hash = "sha256-7huDiRl4d+GstQm0fMRMxr6GCTFImy1PdN31CXsLeLs=";
    };

    # Font resources
    liberation-fonts = fetchFromGitHub {
      owner = "shantigilbert";
      repo = "liberation-fonts-ttf";
      rev = "ef7161f03e305982b0b247e9a0b7cc472376dd83";
      hash = "sha256-C/LYQxModpaHhnggTX18jr8RegtnUgGSmTue6wdaulE=";
    };

    noto-sans-regular = fetchurl {
      url = "https://github.com/openmaptiles/fonts/raw/master/noto-sans/NotoSans-Regular.ttf";
      hash = "sha256-Nxkk50gNPQGAf9wb0wRC0KZlHmtepUZIL1iD1hPPBBk=";
    };

    noto-nasakh-arabic = fetchurl {
      url = "https://github.com/openmaptiles/fonts/raw/master/noto-sans/NotoNaskhArabic-Regular.ttf";
      hash = "sha256-1Cq4ohWFygAsydx/BRRbOkMqz4Cz3PDTWgIun4pFp3o=";
    };

    mcad = fetchFromGitHub {
      owner = "openscad";
      repo = "MCAD";
      rev = "bd0a7ba3f042bfbced5ca1894b236cea08904e26";
      hash = "sha256-rnrapCe5BkdibbCYVyGZi0l1/8DZxoDnulK37fwZbqo=";
    };
  };

  # Pre-fetch npm dependencies for the runtime bundler
  runtimeNpmDeps = importNpmLock.buildNodeModules {
    npmRoot = sources.openscad-wasm + "/runtime";
    nodejs = nodejs_22;
  };

  sysrootPath = "/emsdk/upstream/emscripten/cache/sysroot";

in
stdenv.mkDerivation {
  pname = "openscad-wasm";
  version = "unstable-2025-01-01";

  # We don't have a single source; we use multiple fetched sources
  dontUnpack = true;
  dontConfigure = true;

  nativeBuildInputs = [
    emscripten
    cmake
    ninja
    pkg-config
    python3
    python3.pkgs.meson
    python3.pkgs.packaging
    autoconf
    automake
    libtool
    gettext
    gperf
    bison
    flex
    texinfo
    nodejs_22
    which
  ];

  # No check phase — we verify artifacts exist in installPhase
  doCheck = false;

  buildPhase = ''
    runHook preBuild

    # ============================================================
    # EMSCRIPTEN SETUP
    # ============================================================
    export HOME=$TMPDIR
    export EM_CACHE=$TMPDIR/emscripten-cache
    cp -r ${emscripten}/share/emscripten/cache $EM_CACHE
    chmod -R u+w $EM_CACHE

    export SYSROOT=$EM_CACHE/sysroot
    export CFLAGS="-fexceptions"
    export CXXFLAGS="-fexceptions"
    export LDFLAGS="-fexceptions"

    # Ensure pkg-config finds our sysroot libraries
    export PKG_CONFIG_PATH="$SYSROOT/lib/pkgconfig:$SYSROOT/share/pkgconfig"

    # CMake 4.x removed compat with cmake_minimum_required < 3.5;
    # many of these libraries haven't updated yet. Use a wrapper.
    cmakeFlagsExtra="-DCMAKE_POLICY_VERSION_MINIMUM=3.5"
    real_emcmake=$(which emcmake)
    emcmake() {
      "$real_emcmake" "$@" $cmakeFlagsExtra
    }

    # Write the meson cross-file for glib/cairo builds
    cat > $TMPDIR/emscripten-crossfile.meson << 'CROSSEOF'
    [binaries]
    c = 'emcc'
    cpp = 'em++'
    ld = 'wasm-ld'
    ar = 'emar'
    ranlib = 'emranlib'
    pkg-config = ['emconfigure', 'pkg-config']

    [properties]
    growing_stack = true
    have_c99_vsnprintf = true
    have_c99_snprintf = true
    have_unix98_printf = true

    [built-in options]
    c_thread_count = 0
    cpp_thread_count = 0

    [host_machine]
    system = 'emscripten'
    cpu_family = 'wasm32'
    cpu = 'wasm32'
    endian = 'little'
    CROSSEOF

    # Helper to prepare a source directory in TMPDIR
    prepSrc() {
      local name=$1 src=$2
      echo ""
      echo "========================================"
      echo "Building $name"
      echo "========================================"
      local dir=$TMPDIR/$name
      cp -r "$src" "$dir"
      chmod -R u+w "$dir"
      patchShebangs "$dir"
      cd "$dir"
    }

    # ============================================================
    # PHASE 1: Libraries with no inter-dependencies
    # ============================================================

    # ---- BOOST 1.87.0 ----
    echo ""
    echo "========================================"
    echo "Building boost"
    echo "========================================"
    mkdir -p $TMPDIR/boost
    cd $TMPDIR/boost
    tar xf ${sources.boost} --strip-components=1
    chmod -R u+rwx .
    # Fix shebangs for Nix sandbox (no /usr/bin/env)
    patchShebangs .
    # Fix emscripten.jam to use -fexceptions instead of -fwasm-exceptions
    sed -i -E 's/-fwasm-exceptions/-fexceptions/g' tools/build/src/tools/emscripten.jam
    ./bootstrap.sh
    ./b2 \
      --disable-icu \
      --prefix=$SYSROOT \
      --with-filesystem \
      --with-program_options \
      --with-regex \
      --with-system \
      address-model=32 \
      cxxflags="-std=c++17 -stdlib=libc++ -fexceptions" \
      install \
      link=static \
      linkflags="-stdlib=libc++ -fexceptions" \
      release \
      runtime-link=static \
      toolset=emscripten

    # ---- ZLIB ----
    prepSrc zlib ${sources.zlib}
    emcmake cmake \
      -DINSTALL_PKGCONFIG_DIR="$SYSROOT/lib/pkgconfig/" \
      -DCMAKE_INSTALL_PREFIX=$SYSROOT \
      -B build
    cmake --build build
    cmake --install build

    # ---- LIBEXPAT ----
    prepSrc libexpat ${sources.libexpat}
    cd $TMPDIR/libexpat/expat
    ./buildconf.sh
    emconfigure ./configure \
      --without-docbook \
      --host wasm32-unknown-linux \
      --prefix=$SYSROOT \
      --enable-shared=no \
      --disable-dependency-tracking
    emmake make
    emmake make install

    # ---- LIBFFI ----
    prepSrc libffi ${sources.libffi}
    ./autogen.sh
    emconfigure ./configure \
      --host wasm32-unknown-linux \
      --prefix=$SYSROOT \
      --enable-static \
      --disable-shared \
      --disable-dependency-tracking \
      --disable-builddir \
      --disable-multi-os-directory \
      --disable-raw-api \
      --disable-docs
    emmake make
    emmake make install SUBDIRS='include'

    # ---- GMP 6.3.0 ----
    echo ""
    echo "========================================"
    echo "Building gmp"
    echo "========================================"
    mkdir -p $TMPDIR/gmp
    cd $TMPDIR/gmp
    tar xf ${sources.gmp} --strip-components=1
    patchShebangs .
    emconfigure ./configure \
      --disable-assembly \
      --host none \
      --enable-cxx \
      --prefix=$SYSROOT \
      HOST_CC=gcc
    make
    make install

    # ---- EIGEN ----
    prepSrc eigen ${sources.eigen}
    emcmake cmake \
      -B build \
      -G Ninja \
      -DCMAKE_INSTALL_PREFIX=$SYSROOT
    cmake --build build --parallel
    cmake --install build
    ln -sf $SYSROOT/include/eigen3/Eigen $SYSROOT/include/Eigen

    # ---- CGAL 6.0.1 ----
    prepSrc cgal ${sources.cgal}
    emcmake cmake \
      -B build \
      -G Ninja \
      -DCMAKE_INSTALL_PREFIX=$SYSROOT
    cmake --build build --parallel
    cmake --install build

    # ---- DOUBLECONVERSION ----
    prepSrc doubleconversion ${sources.doubleconversion}
    emcmake cmake \
      -B build \
      -G Ninja \
      -DCMAKE_INSTALL_PREFIX=$SYSROOT
    cmake --build build --parallel
    cmake --install build

    # ---- LIBXML2 ----
    prepSrc libxml2 ${sources.libxml2}
    emcmake cmake \
      -B build \
      -G Ninja \
      -DCMAKE_INSTALL_PREFIX=$SYSROOT \
      -DLIBXML2_WITH_PYTHON=OFF \
      -DLIBXML2_WITH_LZMA=OFF \
      -DLIBXML2_WITH_ZLIB=OFF
    cmake --build build --parallel
    cmake --install build

    # ============================================================
    # PHASE 2: Libraries with Phase 1 dependencies
    # ============================================================

    # ---- LIBZIP (depends on zlib) ----
    prepSrc libzip ${sources.libzip}
    emcmake cmake \
      -B build \
      -G Ninja \
      -DCMAKE_INSTALL_PREFIX=$SYSROOT
    cmake --build build --parallel
    cmake --install build

    # ---- FREETYPE (depends on zlib) ----
    prepSrc freetype ${sources.freetype}
    emcmake cmake \
      -B build \
      -DCMAKE_INSTALL_PREFIX=$SYSROOT \
      -DFT_REQUIRE_ZLIB=TRUE
    cmake --build build
    cmake --install build

    # ---- MPFR 4.2.1 (depends on gmp) ----
    echo ""
    echo "========================================"
    echo "Building mpfr"
    echo "========================================"
    mkdir -p $TMPDIR/mpfr
    cd $TMPDIR/mpfr
    tar xf ${sources.mpfr} --strip-components=1
    patchShebangs .
    emconfigure ./configure \
      --host none \
      --with-gmp=$SYSROOT \
      --prefix=$SYSROOT
    make
    make install

    # ---- HARFBUZZ (depends on freetype) ----
    prepSrc harfbuzz ${sources.harfbuzz}
    emcmake cmake \
      -B build \
      -G Ninja \
      -DCMAKE_INSTALL_PREFIX=$SYSROOT \
      -DHB_HAVE_FREETYPE=ON
    cmake --build build --parallel
    cmake --install build

    # ============================================================
    # PHASE 3: Libraries with deeper dependencies
    # ============================================================

    # ---- GLIB (depends on zlib, libffi; uses meson) ----
    prepSrc glib ${sources.glib}
    meson setup build \
      --prefix=$SYSROOT \
      --cross-file=$TMPDIR/emscripten-crossfile.meson \
      --default-library=static \
      --buildtype=release \
      --force-fallback-for=pcre2,gvdb \
      -Dselinux=disabled \
      -Dxattr=false \
      -Dlibmount=disabled \
      -Dnls=disabled \
      -Dtests=false \
      -Dglib_assert=false \
      -Dglib_checks=false
    meson install -C build

    # ---- FONTCONFIG (depends on zlib, freetype, libxml2; uses autotools) ----
    prepSrc fontconfig ${sources.fontconfig}
    patch -p1 < ${./patches/fontconfig.patch}
    export FREETYPE_CFLAGS="-I$SYSROOT/include/freetype2"
    export FREETYPE_LIBS="-lfreetype -lz"
    emconfigure ./autogen.sh \
      --host none \
      --disable-docs \
      --disable-shared \
      --enable-static \
      --sysconfdir=/ \
      --localstatedir=/ \
      --with-default-fonts=/fonts \
      --enable-libxml2 \
      --prefix=$SYSROOT
    emmake make
    emmake make install

    # ---- LIB3MF 2.3.2 (depends on zlib, libzip) ----
    prepSrc lib3mf ${sources.lib3mf}
    patch -p1 < ${./patches/lib3mf.patch}
    emcmake cmake \
      -B build \
      -DCMAKE_INSTALL_PREFIX=$SYSROOT \
      -DLIB3MF_TESTS=OFF \
      -DUSE_INCLUDED_ZLIB=OFF \
      -DUSE_INCLUDED_LIBZIP=OFF \
      -G Ninja
    cmake --build build --parallel
    cmake --install build

    # ============================================================
    # PHASE 4: OpenSCAD itself
    # ============================================================
    echo ""
    echo "========================================"
    echo "Building OpenSCAD"
    echo "========================================"
    oscadSrc=$TMPDIR/openscad
    cp -r ${sources.openscad} $oscadSrc
    chmod -R u+w $oscadSrc
    cd $oscadSrc

    emcmake cmake -B build . \
      -DBoost_USE_STATIC_RUNTIME=ON \
      -DBoost_USE_STATIC_LIBS=ON \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_BUILD_PARALLEL_LEVEL=$NIX_BUILD_CORES \
      -DEXPERIMENTAL=ON \
      -DSNAPSHOT=ON \
      -G Ninja
    cmake --build build --parallel

    # ============================================================
    # PHASE 5: Runtime bundler (produces openscad.js, fonts.js, mcad.js)
    # ============================================================
    echo ""
    echo "========================================"
    echo "Building runtime bundle"
    echo "========================================"

    # Set up the working directory structure the runtime bundler expects:
    #   build/openscad.wasm.js  (emscripten JS glue)
    #   build/openscad.wasm     (WASM binary)
    #   res/fonts/fonts.conf
    #   res/liberation/         (liberation font files)
    #   res/noto/               (noto font files)
    #   res/MCAD/               (MCAD library files)
    #   runtime/                (rollup bundler)

    workDir=$TMPDIR/bundle-work
    mkdir -p $workDir/build $workDir/res/fonts $workDir/res/noto

    # Copy OpenSCAD build output
    cp $oscadSrc/build/openscad.js $workDir/build/openscad.wasm.js
    cp $oscadSrc/build/openscad.wasm $workDir/build/

    # Copy fonts.conf from upstream repo
    cp ${sources.openscad-wasm}/res/fonts/fonts.conf $workDir/res/fonts/

    # Copy Liberation fonts
    cp -r ${sources.liberation-fonts} $workDir/res/liberation
    chmod -R u+w $workDir/res/liberation

    # Copy Noto fonts
    cp ${sources.noto-sans-regular} $workDir/res/noto/NotoSans-Regular.ttf
    cp ${sources.noto-nasakh-arabic} $workDir/res/noto/NotoNaskhArabic-Regular.ttf

    # Copy MCAD
    cp -r ${sources.mcad} $workDir/res/MCAD
    chmod -R u+w $workDir/res/MCAD

    # Copy runtime bundler source
    cp -r ${sources.openscad-wasm}/runtime $workDir/runtime
    chmod -R u+w $workDir/runtime

    # Link pre-fetched node_modules
    ln -s ${runtimeNpmDeps}/node_modules $workDir/runtime/node_modules

    # Run the rollup build
    cd $workDir/runtime
    npm run build

    # Copy final artifacts to a known location
    mkdir -p $TMPDIR/final-output
    cp $workDir/build/openscad.wasm $TMPDIR/final-output/
    cp $workDir/build/openscad.wasm.js $TMPDIR/final-output/
    cp $workDir/runtime/dist/openscad.js $TMPDIR/final-output/
    cp $workDir/runtime/dist/openscad.fonts.js $TMPDIR/final-output/
    cp $workDir/runtime/dist/openscad.mcad.js $TMPDIR/final-output/

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out
    cp $TMPDIR/final-output/openscad.js $out/
    cp $TMPDIR/final-output/openscad.wasm $out/
    cp $TMPDIR/final-output/openscad.wasm.js $out/
    cp $TMPDIR/final-output/openscad.fonts.js $out/
    cp $TMPDIR/final-output/openscad.mcad.js $out/

    runHook postInstall
  '';

  meta = with lib; {
    description = "OpenSCAD compiled to WebAssembly with runtime extensions";
    homepage = "https://github.com/openscad/openscad-wasm";
    license = licenses.gpl3Plus;
    platforms = platforms.all;
  };
}
