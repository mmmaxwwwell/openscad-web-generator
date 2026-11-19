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
, memory64 ? false
}:

let
  deps = callPackage ./orcaslicer-deps.nix { inherit memory64; };
  orcaslicerLib = callPackage ./orcaslicer-lib.nix { inherit memory64; };

  m64flag = lib.optionalString memory64 "-sMEMORY64=1";

  # Output filenames differ for wasm64 variant
  outputBasename = if memory64 then "libslic3r-wasm64" else "libslic3r";

  # Path to our WASM bindings source (slicer_bindings.cpp + CMakeLists.txt)
  bindingsSrc = ../src/wasm;

in
stdenv.mkDerivation {
  pname = "orcaslicer-wasm${lib.optionalString memory64 "64"}";
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
    export EMCC_CFLAGS="-fexceptions -matomics -mbulk-memory -D_REENTRANT ${m64flag}"

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
      -DCMAKE_SIZEOF_VOID_P=${if memory64 then "8" else "4"} \
      -DCMAKE_CXX_COMPILER=em++ \
      -DCMAKE_C_COMPILER=emcc \
      -DLIBSLIC3R_PREFIX=${orcaslicerLib} \
      -DDEPS_PREFIX=${deps} \
      ${lib.optionalString memory64 "-DMEMORY64=ON"}

    cmake --build . --parallel

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out

    # Copy the WASM artifacts
    cp ${outputBasename}.js $out/
    cp ${outputBasename}.wasm $out/

    # Copy pthreads worker if generated (emscripten creates this for -pthread builds)
    cp ${outputBasename}.worker.js $out/ 2>/dev/null || true

    # Verify key outputs
    test -f $out/${outputBasename}.js || (echo "ERROR: ${outputBasename}.js missing" && exit 1)
    test -f $out/${outputBasename}.wasm || (echo "ERROR: ${outputBasename}.wasm missing" && exit 1)

    echo ""
    echo "========================================"
    echo "orcaslicer-wasm: Build successful"
    echo "========================================"
    echo "WASM artifacts:"
    ls -lh $out/${outputBasename}.*

    runHook postInstall
  '';

  meta = with lib; {
    description = "OrcaSlicer's libslic3r compiled to WASM via Emscripten";
    homepage = "https://github.com/SoftFever/OrcaSlicer";
    license = licenses.agpl3Plus;
    platforms = platforms.all;
  };
}
