# AGENTS.md — OpenSCAD Web Generator

## What This Project Is

A browser-based parametric 3D modeling tool. Users load OpenSCAD `.scad` files, tweak parameters through a form UI, export STL/3MF models, and preview them in 3D — all without installing OpenSCAD. The entire pipeline runs client-side using OpenSCAD compiled to WebAssembly.

**Why it exists**: OpenSCAD is powerful but desktop-only. This makes parametric models accessible to anyone with a browser — useful for sharing configurable designs (e.g., "adjust the width and download your custom bracket").

## Architecture

```
React UI (main thread)
    │
    ├── Components (presentational)
    │     FileManager, ParameterEditor, PreviewPanel, ExportControls
    │
    ├── Hooks (side effects + state)
    │     useStorage, useOpenSCAD, useScadParser
    │
    ├── openscad-api.ts (promise wrapper over postMessage)
    │         │
    │    ─────┼───── thread boundary ─────
    │         │
    │    openscad-worker.ts (Web Worker)
    │         └── OpenSCAD WASM + libraries (MCAD, BOSL2, fonts)
    │
    └── Storage layer
          storage.ts (factory) → storage-browser.ts (IndexedDB)
                               → storage-s3.ts (S3/MinIO)
```

### Why a Web Worker

OpenSCAD renders can take seconds. Running WASM on the main thread freezes the UI. The worker isolates all heavy computation on a separate OS thread. Communication is `postMessage` only — no shared memory.

### Why the Storage Abstraction

Two backends (IndexedDB for local use, S3 for shared/deployed use) behind a `StorageAdapter` interface. The S3 adapter + AWS SDK (~50KB) are dynamically imported only when selected, keeping the default bundle small.

### Why Parameter Injection via Prepend

When rendering with user-modified parameters, overrides are prepended to the `.scad` source. OpenSCAD uses last-assignment-wins, so the prepended values override the file's defaults. This avoids fragile CLI flag construction or source rewriting.

## File Map

### Source (`src/`)

| Path | Role | Why |
|------|------|-----|
| `App.tsx` | Root component, owns all top-level state | Single source of truth for selected file, param values, preview data, storage config |
| `main.tsx` | React entry point | Renders `<App />` |
| `app.css` | All styles (single file) | No CSS modules or framework — keeps it simple |
| `components/FileManager.tsx` | File list, upload, delete, example loader | Also defines `BUNDLED_EXAMPLES` array |
| `components/ParameterEditor.tsx` | Type-aware param input form | Renders number/string/bool/vector/enum controls based on `ScadParam.type` |
| `components/ParameterSetSelector.tsx` | Apply/save/delete param presets | Works with both file-embedded and user-saved sets |
| `components/PreviewPanel.tsx` | Three.js 3D viewer | Renders STL via `STLLoader`, 3MF via `ThreeMFLoader`, with `OrbitControls` |
| `components/ExportControls.tsx` | Export buttons + download trigger | Calls worker, creates blob URL, triggers `<a>` click |
| `hooks/useOpenSCAD.ts` | Worker lifecycle + render/preview methods | Manages single worker instance |
| `hooks/useStorage.ts` | Storage adapter init + file ops | Switches backends based on config |
| `hooks/useScadParser.ts` | Memoized `.scad` parsing | Wraps parser in `useMemo` |
| `lib/openscad-api.ts` | Promise API over worker `postMessage` | Matches requests to responses by unique `id` |
| `lib/openscad-worker.ts` | Web Worker: loads WASM, runs OpenSCAD | Mounts libraries into Emscripten virtual FS |
| `lib/scad-parser.ts` | Parses `.scad` structured sections | Pure function, no side effects, lenient (never throws) |
| `lib/storage.ts` | Storage factory + config types | Dynamic import for S3 adapter |
| `lib/storage-browser.ts` | IndexedDB adapter | DB: `openscad-web-app`, stores: `scad-files`, `parameter-sets` |
| `lib/storage-s3.ts` | S3-compatible adapter | `forcePathStyle: true` for MinIO support |
| `types/index.ts` | All shared TypeScript types | `ScadParam`, `ScadFile`, `StorageAdapter`, etc. |

### Build (`scripts/`)

| Script | What | Why |
|--------|------|-----|
| `build.mjs` | Orchestrator: WASM download + BOSL2 bundle + vite build | Single entry point for production builds |
| `download-wasm.mjs` | Downloads OpenSCAD WASM from GitHub releases | Idempotent; creates `wasm-version.json` manifest |
| `build-wasm.mjs` | Builds WASM from source via `nix build .#openscad-wasm` | Alternative to downloading pre-built artifacts |
| `bundle-bosl2.mjs` | Hex-encodes BOSL2 library into JS module | Follows openscad-wasm's pattern for library bundles |

### Nix

| File | What | Why |
|------|------|-----|
| `flake.nix` | Dev shell (Node 22) + `buildNpmPackage` + openscad-wasm package | Reproducible builds; `--skip-wasm` in Nix sandbox |
| `nix/openscad-wasm.nix` | Monolithic derivation compiling OpenSCAD to WASM | Emscripten cross-compilation of OpenSCAD + all deps |
| `nix/RESUME.md` | Build progress notes for the WASM derivation | Tracks which deps compile, what's broken |
| `nix/patches/*.patch` | Source patches for WASM compilation | Fix build issues in fontconfig, glib, lib3mf |

### Static Assets (`public/`)

| Path | What |
|------|------|
| `public/wasm/` | OpenSCAD WASM + library bundles (gitignored, populated by build) |
| `public/examples/*.scad` | Bundled example `.scad` files |

## Code Boundaries

### 1. Main Thread / Worker Thread

- **Boundary**: `openscad-api.ts` <-> `openscad-worker.ts`
- **Mechanism**: `postMessage` with request/response protocol, unique `id` per request
- **Transfers**: Binary output (STL/3MF/PNG) via `ArrayBuffer` with zero-copy transfer
- **Critical detail**: Camera args are reordered across this boundary. File format stores `rot,trans,dist`; OpenSCAD CLI expects `trans,rot,dist`. See `viewpointToCameraArg()`.

### 2. Components / Hooks

- Components are presentational — no direct WASM calls, no storage I/O
- All side effects live in hooks
- All top-level state lives in `App.tsx`

### 3. Storage Interface / Backends

- `StorageAdapter` interface in `storage.ts`
- Two implementations: `storage-browser.ts` (IndexedDB), `storage-s3.ts` (S3)
- Factory uses dynamic `import()` for the S3 path

### 4. Parser / Everything Else

- `scad-parser.ts` is a pure function: string in, `ScadFile` out
- Never throws — malformed lines are skipped with `console.warn`
- Only parses structured sections between markers, **not** general OpenSCAD syntax

## `.scad` File Format

The app uses a structured comment convention to extract parameters, presets, and camera viewpoints from `.scad` files. Three optional sections, each delimited by marker comments:

### Parameters (`BEGIN_PARAMS` / `END_PARAMS`)

```scad
// BEGIN_PARAMS
// Help text for width (preceding comment lines).
// Can span multiple lines.
width = 50;
                          // ← two blank lines separate params
                          //
// Height of the box.
height = 30;


// Shape of holes.
shape = "circle"; // [circle, square, hexagon]   ← inline options → enum/dropdown
// END_PARAMS
```

- Standard OpenSCAD assignments: `name = value;`
- Separated by **exactly two blank lines**
- Comment lines immediately before an assignment become help text
- Inline `// [option1, option2]` on the assignment line makes it an enum
- Supported types: number, string, boolean, vector (`[x, y, z]`)

### Parameter Sets (`BEGIN_PARAM_SETS` / `END_PARAM_SETS`)

```scad
// BEGIN_PARAM_SETS
// set: Small Box
// width = 30
// height = 20

// set: Large Box
// width = 100
// height = 60
// END_PARAM_SETS
```

- Each set starts with `// set: Name`
- Following lines are `// param = value` (no semicolons, inside comments)
- Only override params that differ from defaults
- Sets separated by one blank line

### Viewpoints (`BEGIN_VIEWPOINTS` / `END_VIEWPOINTS`)

```scad
// BEGIN_VIEWPOINTS
// 25,35,0,0,0,0,200       // Front perspective
// 0,0,0,0,0,0,300         // Top down
// END_VIEWPOINTS
```

- Format: `// rotX,rotY,rotZ,transX,transY,transZ,distance`
- Optional label after second `//`
- **Order differs from OpenSCAD CLI** — file uses `rot,trans,dist`; CLI uses `trans,rot,dist`

## Development

```bash
nix develop              # Enter dev shell
npm install
npm run build:wasm       # Download WASM artifacts to public/wasm/
npm run build:bosl2      # Bundle BOSL2 library
npm run dev              # Vite dev server

npm test                 # Vitest (parser + API tests)
npm run build            # Full production build → dist/
nix build                # Reproducible Nix build → result/
```

## Conventions

- **No general OpenSCAD parsing** — only structured sections between markers
- **Components are presentational** — side effects in hooks, logic in `lib/`
- **Single WASM worker** — never create multiple instances
- **Node.js scripts, not shell** — build tooling uses `.mjs`
- **TypeScript strict** — shared types in `src/types/index.ts`
- **Dynamic imports for optional deps** — follow the `storage.ts` pattern
- **Adding libraries** — hex-encode into JS module with `add*()` export, mount in worker, externalize in vite config
- **Adding examples** — put `.scad` in `public/examples/`, add to `BUNDLED_EXAMPLES` in `FileManager.tsx`
