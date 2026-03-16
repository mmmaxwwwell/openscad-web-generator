# Stage 2: Build WASM bindings.
# Links slicer_bindings.cpp against the pre-built libslic3r static libs
# to produce libslic3r.js + libslic3r.wasm.
#
# This is the fast part — only rebuilds when src/wasm/ changes.
# The expensive libslic3r compilation is cached in libslic3r-lib.nix.
{ lib
, stdenv
, emscripten
, cmake
, ninja
, python3
, callPackage
}:

let
  deps = callPackage ./libslic3r-deps.nix {};
  libslic3rLib = callPackage ./libslic3r-lib.nix {};

  # Path to our WASM bindings source (slicer_bindings.cpp + CMakeLists.txt)
  bindingsSrc = ../src/wasm;

in
stdenv.mkDerivation {
  pname = "libslic3r-wasm";
  version = "2.9.4";

  src = bindingsSrc;

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

    # Ensure exception handling and atomics flags reach every compile command
    # -matomics -mbulk-memory: needed for C++ atomics without full pthreads
    export EMCC_CFLAGS="-fexceptions -matomics -mbulk-memory"

    # ============================================================
    # BUILD WASM BINDINGS
    # Links slicer_bindings.cpp against all static libs to produce
    # libslic3r.js + libslic3r.wasm (+ libslic3r.worker.js for pthreads)
    # ============================================================
    emcmake cmake \
      . \
      -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
      -DCMAKE_CXX_COMPILER=em++ \
      -DCMAKE_C_COMPILER=emcc \
      -DLIBSLIC3R_PREFIX=${libslic3rLib} \
      -DDEPS_PREFIX=${deps}

    cmake --build . --parallel

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out

    # Copy the WASM artifacts
    cp libslic3r.js $out/
    cp libslic3r.wasm $out/

    # Copy pthreads worker if generated (emscripten creates this for -pthread builds)
    cp libslic3r.worker.js $out/ 2>/dev/null || true

    # Verify key outputs
    test -f $out/libslic3r.js || (echo "ERROR: libslic3r.js missing" && exit 1)
    test -f $out/libslic3r.wasm || (echo "ERROR: libslic3r.wasm missing" && exit 1)

    echo ""
    echo "========================================"
    echo "libslic3r-wasm: Build successful"
    echo "========================================"
    echo "WASM artifacts:"
    ls -lh $out/libslic3r.*

    runHook postInstall
  '';

  meta = with lib; {
    description = "PrusaSlicer's libslic3r compiled to WASM via emscripten";
    homepage = "https://github.com/prusa3d/PrusaSlicer";
    license = licenses.agpl3Plus;
    platforms = platforms.all;
  };
}
