# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Stage 3: Build WASM bindings for OrcaSlicer.
# Links slicer_bindings.cpp against the pre-built OrcaSlicer libslic3r
# static libs to produce libslic3r.js + libslic3r.wasm.
#
# This is the fast part — only rebuilds when src/wasm/ changes.
# The expensive OrcaSlicer compilation is cached in orcaslicer-lib.nix.
#
# Based on libslic3r-wasm.nix (PrusaSlicer). Changes:
# - Uses orcaslicer-deps.nix and orcaslicer-lib.nix
# - No LibBGCode or heatshrink
# - Adds draco, libnoise from deps; clipper2, mcut from bundled
{ lib
, stdenv
, emscripten
, cmake
, ninja
, python3
, callPackage
}:

let
  deps = callPackage ./orcaslicer-deps.nix {};
  orcaslicerLib = callPackage ./orcaslicer-lib.nix {};

  # Path to our WASM bindings source (slicer_bindings.cpp + CMakeLists.txt)
  bindingsSrc = ../src/wasm;

in
stdenv.mkDerivation {
  pname = "orcaslicer-wasm";
  version = "2.3.1";

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
    export EMCC_CFLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT"

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
      -DLIBSLIC3R_PREFIX=${orcaslicerLib} \
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
    echo "orcaslicer-wasm: Build successful"
    echo "========================================"
    echo "WASM artifacts:"
    ls -lh $out/libslic3r.*

    runHook postInstall
  '';

  meta = with lib; {
    description = "OrcaSlicer's libslic3r compiled to WASM via Emscripten";
    homepage = "https://github.com/SoftFever/OrcaSlicer";
    license = licenses.agpl3Plus;
    platforms = platforms.all;
  };
}
