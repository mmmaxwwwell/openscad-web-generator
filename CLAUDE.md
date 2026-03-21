# CLAUDE.md

## What This Is

OpenSCAD Web Generator is a **browser-based parametric 3D printing workflow** — upload `.scad` files, tweak parameters via auto-generated UI, preview in 3D, slice, and send to a printer. Everything runs 100% client-side via WebAssembly. No server needed.

The app replaces a multi-tool desktop workflow (OpenSCAD → slicer → OctoPrint) with a single browser tab. The Android APK exists to allow cleartext HTTP to local Klipper printers (browsers block mixed content on HTTPS pages).

## Nix Flake Environment

This project uses **Nix flakes** for reproducible builds. All commands assume you are inside the dev shell. Either run `nix develop` first, or prepend commands with `nix develop -c`:

```bash
nix develop -c npm install
nix develop -c npm run dev
nix develop -c npm test
```

The dev shell provides: Node 22, JDK 17, Gradle, android-tools, ANDROID_HOME.

## Quick Start

```bash
nix develop -c npm install
nix develop -c npm run build:wasm    # download OpenSCAD WASM from GitHub releases
nix develop -c npm run dev           # start dev server at localhost:5173
nix develop -c npm test              # run vitest (16 test files)
```

## Key Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Full production build (downloads WASM, bundles libs, vite build) |
| `npm run build:wasm` | Download pre-built OpenSCAD WASM from GitHub releases |
| `npm run build:wasm:source` | Build OpenSCAD WASM from source via Nix (~90 min) |
| `npm run build:bosl2` | Bundle BOSL2 library into Emscripten data file |
| `npm test` | Run vitest unit tests |
| `npm run test:coverage` | Coverage report (v8) |
| `npm run test:integration` | Browser integration tests (Playwright + Chromium) |
| `npm run apk` | Build Android debug APK |

All of these must be run inside `nix develop` or prefixed with `nix develop -c`.

## Slicer WASM (optional)

```bash
nix develop -c node scripts/download-slicer-wasm.mjs   # download from GitHub releases
nix build .#orcaslicer-wasm                              # build from source (~50-85 min)
nix develop -c node scripts/build-slicer-wasm.mjs       # copy Nix output to public/wasm/
```

New files must be `git add`-ed for Nix flakes to see them.

## Architecture & Code Boundaries

### Source Layout

```
src/
├── App.tsx                 # Root component: file selection → editor → printing
├── main.tsx                # React entry point
├── app.css                 # Global styles (vanilla CSS, no CSS-in-JS)
├── components/             # 12 React components (UI layer)
│   ├── __tests__/          # 10 component test files
│   └── print-settings/    # 9 print settings tab components
├── hooks/                  # 9 custom hooks (state & side effects)
├── lib/                    # 17 utility modules (WASM APIs, parsers, storage)
│   └── __tests__/          # 20 vitest test files
├── workers/                # Web Workers (slicer, gcode-preview)
├── types/                  # TypeScript type definitions
│   ├── index.ts            # ScadParam, ScadFile, StorageAdapter, etc.
│   └── print-profile.ts    # PrintProfile, DEFAULT_PRINT_PROFILE
├── data/                   # Static data
│   └── printer-profiles.ts # Predefined printer models + filament defaults
├── wasm/                   # C++ WASM bindings (compiled by Nix)
│   ├── slicer_bindings.cpp # embind wrapper for libslic3r
│   └── CMakeLists.txt      # CMake for WASM linking
└── vite-env.d.ts           # Vite type stubs
```

### Key Components

| Component | Role |
|-----------|------|
| `App.tsx` | State machine: file list → parameter editor → print. URL sync, Android back button. |
| `FileManager.tsx` | Upload, list, delete files. Dual storage (IndexedDB / S3). |
| `ParameterEditor.tsx` | Auto-generated form from `BEGIN_PARAMS` blocks (sliders, dropdowns, checkboxes). |
| `PreviewPanel.tsx` | Three.js 3D canvas (STL/3MF preview). |
| `ExportControls.tsx` | Render to STL/3MF/multi-color 3MF with caching. |
| `PrintDialog.tsx` | Main slicing UI — profile editor, filament selector, GCode preview, upload to printer. |
| `GCodePreview.tsx` | Layer-by-layer 3D GCode visualization (Three.js). |
| `PrinterSettings.tsx` | Add/edit/delete Moonraker printer connections. |
| `FilamentManager.tsx` | Filament profile management (temp, speed, retraction, fan). |
| `SendToPrinter.tsx` | Moonraker upload + Android cleartext bridge. |

### Hooks (State Management)

No state library — all state lives in custom hooks backed by localStorage or IndexedDB.

| Hook | Manages |
|------|---------|
| `useOpenSCAD` | OpenSCAD WASM worker lifecycle, `render()` / `renderMulticolor()` |
| `useSlicer` | SlicerBackend (WASM or native), `slice()`, progress, cancellation, `engineName` |
| `useScadParser` | Parses `.scad` source → `ScadFile` (params, presets, description) |
| `useStorage` | `StorageAdapter` factory (IndexedDB or S3) |
| `usePrinters` | Printer list CRUD (localStorage) |
| `usePrinterConfig` | Fetches printer config from Moonraker, 5-min cache |
| `useFilaments` | Built-in + custom filament profiles |
| `useExtruderFilaments` | Per-extruder filament → resolved settings for slicer |
| `usePrinterFilamentOverrides` | Per-printer filament tweaks (temp, speed overrides) |

### Libraries (`src/lib/`)

| Module | Purpose |
|--------|---------|
| `openscad-api.ts` | Main-thread wrapper for OpenSCAD worker |
| `openscad-worker.ts` | Worker: loads WASM + font/MCAD/BOSL2/QR modules, fresh instance per render |
| `slicer-engine.ts` | Typed wrapper for libslic3r Emscripten module |
| `orca-slicer-settings.ts` | `buildOrcaConfig()` — maps PrintProfile + filament + printer → OrcaSlicer config |
| `slicer-settings.ts` | Shared utilities: `convertKlipperGcode()`, `PrinterSettings`, `getModelHeightFromSTL()` |
| `slicer-backend.ts` | Abstract `SlicerBackend` interface + WASM/native implementations + factory |
| `native-slicer-backend.ts` | Android native slicer backend via WebView JS bridge |
| `scad-parser.ts` | Extracts parameters, presets, description from `.scad` source |
| `gcode-parser.ts` | Parses GCode → layers with typed segments (OrcaSlicer `;TYPE:` comments) |
| `merge-3mf.ts` | Merges per-color STLs into multi-color 3MF with ColorGroup metadata |
| `moonraker-api.ts` | HTTP client for Klipper/Moonraker REST API |
| `render-cache.ts` | IndexedDB cache keyed by SHA256(source + params + format) |
| `storage.ts` / `storage-browser.ts` / `storage-s3.ts` | Pluggable storage adapters |
| `color-utils.ts` | CSS/hex/RGBA color parsing and normalization |
| `notification-sound.ts` | Audio feedback on render complete |

### Workers

| Worker | What it does |
|--------|-------------|
| `openscad-worker.ts` (in lib/) | Runs OpenSCAD WASM — creates fresh instance per render (exit() kills runtime) |
| `slicer-worker.ts` | Runs OrcaSlicer libslic3r WASM — loads model, applies config, slices, exports GCode |
| `gcode-preview-worker.ts` | Parses GCode off main thread (CPU-intensive) |

### WASM Modules

Two WASM modules, both loaded in Web Workers:

1. **OpenSCAD WASM** — renders `.scad` → STL/3MF. Downloaded from `openscad/openscad-wasm` GitHub releases. Companion data files: fonts, MCAD, BOSL2, QR. Lives in `public/wasm/`.

2. **libslic3r WASM** — slices STL/3MF → GCode. Built from OrcaSlicer v2.3.1 via Nix (3-stage: deps → lib → WASM bindings with embind). C++ bindings in `src/wasm/slicer_bindings.cpp`. Requires COOP/COEP headers for SharedArrayBuffer (pthreads). **Note:** Multi-color 3MF objects are merged into a single object with multiple volumes (one per color/extruder) during loading — OrcaSlicer requires all volumes in one object for correct multi-material slicing and first-layer validation. `ensure_on_bed()` is only called per-object for STL; for 3MF, a uniform Z translation preserves stacked assembly positions. On Android, a native ARM64/ARM32 backend (`libslic3r.so`) can be used instead of WASM via the `SlicerBackend` abstraction.

### Nix Build Derivations (`nix/`)

| File | Builds |
|------|--------|
| `openscad-wasm.nix` | OpenSCAD WASM from source (~90 min) |
| `orcaslicer-deps.nix` | 16+ C++ dependencies (Boost, TBB, GMP, CGAL, Clipper2, draco, mcut, libnoise, etc.) via Emscripten |
| `orcaslicer-lib.nix` | OrcaSlicer v2.3.1 libslic3r source → static libraries |
| `orcaslicer-wasm.nix` | Links bindings + libs → `libslic3r.{js,wasm,worker.js}` |
| `orcaslicer-android.nix` | Cross-compiles libslic3r for Android ARM64/ARM32 via NDK → `libslic3r.so` |

`flake.nix` exposes: `devShell`, `openscad-wasm`, `orcaslicer-deps`, `orcaslicer-lib`, `orcaslicer-wasm`, `orcaslicer-android-arm64`, `orcaslicer-android-arm32`, `default` (npm production build via `buildNpmPackage`).

### Build Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `build.mjs` | Orchestrates full production build (download WASM, bundle libs, vite build) |
| `build-wasm.mjs` | Builds OpenSCAD WASM via `nix build .#openscad-wasm` |
| `download-wasm.mjs` | Downloads pre-built OpenSCAD WASM from GitHub releases |
| `build-slicer-wasm.mjs` | Copies Nix-built slicer WASM to `public/wasm/` |
| `download-slicer-wasm.mjs` | Downloads pre-built slicer WASM from GitHub releases |
| `bundle-bosl2.mjs` | Bundles BOSL2 library into Emscripten data file |
| `bundle-qr.mjs` | Bundles scadqr library into Emscripten data file |
| `copy-android-slicer.sh` | Copies Nix-built Android .so + headers into APK project |
| `profile-slicer.mjs` | Profiling tool for slicer performance |

### Deployment

- **Web:** GitHub Pages via `.github/workflows/deploy.yml` (push to main)
- **Android:** Signed APK via `.github/workflows/android-release.yml` (version tags `v*.*.*`)
- **Slicer WASM:** Built via `.github/workflows/build-slicer-wasm.yml`

### External Integrations

- **Moonraker API** (`lib/moonraker-api.ts`): Klipper printer config fetch, GCode upload, print start
- **S3 storage** (`lib/storage-s3.ts`): Optional file storage via `@aws-sdk/client-s3`

## Testing

- Tests in `src/lib/__tests__/` and `src/components/__tests__/`, run with `nix develop -c npm test`
- ~1240 tests across 30 test files
- Vitest with 10s timeout
- Mock workers via `vi.stubGlobal`, suppress console via `vi.spyOn`
- Coverage includes `src/lib`, `src/data`, `src/types`
- Integration tests use Playwright + Chromium (`npm run test:integration`)
- OrcaSlicer config key mapping has exhaustive tests: every PrintProfile field → config key verified

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript 5.7 (strict mode) |
| UI | React 19, vanilla CSS |
| Build | Vite 6, Nix flakes |
| 3D | Three.js 0.183 |
| Testing | Vitest 4, Playwright |
| WASM | Emscripten (OpenSCAD + libslic3r/OrcaSlicer v2.3.1) |
| Storage | IndexedDB (idb), S3 (@aws-sdk/client-s3) |
| Compression | fflate (3MF ZIP handling) |
| Android | Gradle, JDK 17, WebView |
| CI/CD | GitHub Actions → GitHub Pages |

## Conventions

- SPDX license header on every source file: `// SPDX-License-Identifier: AGPL-3.0-or-later`
- TypeScript strict mode. Use `import type { ... }` for type-only imports.
- Components: PascalCase (`PrintDialog.tsx`). Utilities: kebab-case (`gcode-parser.ts`).
- Named exports preferred. Types in `src/types/`.
- Workers loaded via `new Worker(new URL('../workers/foo.ts', import.meta.url))`.
- No state management library — hooks + localStorage + IndexedDB.
- License: AGPL-3.0-or-later (required by libslic3r/OrcaSlicer).
