# Resume Context: OpenSCAD WASM Nix Build

## Current Status: Build phase — iterating on compile errors

All source hashes are filled in and all sources fetch successfully. The derivation evaluates and Nix begins the build phase. We're now iterating on compile-time issues.

### What's been completed:
1. **All 22 source hashes filled in** — no more `fakeHash` anywhere
2. **Tarball sources fixed** — boost/gmp/mpfr no longer use `prepSrc` (they use manual tar extraction)
3. **`patchShebangs`** added to `prepSrc` helper and tarball extractions (Nix sandbox has no `/usr/bin/env`)
4. **`dontConfigure = true`** added (cmake in nativeBuildInputs was triggering default configure phase)
5. **`which`** added to nativeBuildInputs (boost bootstrap needs it)
6. **`emcmake` wrapper** added to inject `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` (CMake 4.x compat)
7. **GMP mirror URL** added (`ftp.gnu.org` as primary, `gmplib.org` was unreachable)
8. **OpenSCAD pinned to master** (`10cc3aa...`) — there is no `openscad-2024.12.06` tag
9. **openscad-wasm, liberation-fonts, mcad** pinned to specific commit revs (not `main`/`master`)
10. **`importNpmLock.buildNodeModules`** evaluates successfully
11. **glib `fetchSubmodules = true`** added — `gvdb` is a git submodule; without it the subproject dir is empty and meson fails

### Where the build stopped:
GLib's meson build failed because the `gvdb` subproject directory was empty (no `meson.build`). Error: `Subproject exists but has no meson.build file.` Fix applied: added `fetchSubmodules = true` to the glib `fetchFromGitHub` call. The hash was set to a placeholder — **you must get the correct hash from the hash-mismatch error** on next build and update it before glib will build.

### Action needed before next build:
1. Run `nix build .#openscad-wasm` — it will fail with a hash mismatch for glib
2. Copy the "got:" hash from the error output
3. Update the glib hash in `nix/openscad-wasm.nix` (currently a placeholder `sha256-AAAA...`)
4. Run `nix build .#openscad-wasm` again to continue

### Libraries that built successfully (confirmed in build logs):
- boost (with `patchShebangs` + emscripten.jam sed fix)
- zlib
- libexpat
- libffi (confirmed `prepSrc` + `patchShebangs` works)
- gmp, eigen, cgal
- doubleconversion (cmake policy fix with `emcmake` wrapper worked)
- libxml2, libzip, freetype, mpfr, harfbuzz (all built — build reached glib)

### Libraries not yet tested in build:
- glib (meson cross-compile — needs hash fix, then should work with `fetchSubmodules = true`)
- fontconfig (autotools + patch)
- lib3mf (cmake + patch)
- openscad itself
- runtime bundler (rollup + npm)

### Known remaining risks:
1. **glib hash placeholder** — must be replaced with correct hash from mismatch error
2. **glib meson build** — meson cross-compilation for emscripten can be tricky; `--force-fallback-for=pcre2,gvdb` is set
3. **fontconfig autogen.sh** — needs patchShebangs (handled by prepSrc)
4. **OpenSCAD cmake** — may need additional cmake flags or find-module hints
5. **Runtime bundler** — `importNpmLock.buildNodeModules` output structure needs to match what `npm run build` expects
6. **OpenSCAD build output filename** — we assume `openscad.js` and `openscad.wasm` but emscripten output names may differ

### How to continue:
```bash
# Just run the build and fix whatever error comes next:
nix build .#openscad-wasm 2>&1 | tail -40

# For full logs of a failed build:
nix log /nix/store/<drv-hash>-openscad-wasm-unstable-2025-01-01.drv
```

### Key files:
- `nix/openscad-wasm.nix` — the full derivation (all code is here)
- `nix/patches/fontconfig.patch` — from upstream openscad-wasm repo
- `nix/patches/lib3mf.patch` — from upstream openscad-wasm repo
- `nix/patches/glib.patch` — from upstream openscad-wasm repo
- `flake.nix` — wires up `packages.openscad-wasm = pkgs.callPackage ./nix/openscad-wasm.nix {};`

### Architecture overview:
Single `stdenv.mkDerivation` that:
1. Sets up writable emscripten cache in `$TMPDIR`
2. Wraps `emcmake` to add cmake policy compat flag
3. Builds 18 C/C++ libraries sequentially into the emscripten sysroot
4. Builds OpenSCAD against those libraries
5. Runs the upstream Rollup-based runtime bundler to produce 5 output files
6. Installs: `openscad.js`, `openscad.wasm`, `openscad.wasm.js`, `openscad.fonts.js`, `openscad.mcad.js`

### Upstream reference:
- Dockerfile.base: exact configure/cmake flags per dependency
- Dockerfile: OpenSCAD cmake flags
- Makefile: source URLs/versions, build orchestration
- runtime/: Rollup bundler producing JS wrapper modules
- All at https://github.com/openscad/openscad-wasm (pinned to rev ac5cf9b)
