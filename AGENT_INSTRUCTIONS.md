# Agent Instructions: OpenSCAD Web Parameter Editor

## What This App Does

A single-page application (SPA) that lets users load OpenSCAD `.scad` files, edit parameters via a form UI, preview 3D models from multiple camera viewpoints, and export STL/3MF — entirely in the browser using OpenSCAD compiled to WebAssembly.

## Tech Stack

- **Frontend**: React 19 + TypeScript (strict)
- **Build**: Vite (bundler), Node.js build scripts (no shell scripts)
- **Reproducibility**: Nix flake producing a static site
- **WASM**: Pre-built OpenSCAD WASM from [openscad/openscad-wasm](https://github.com/nicodemus26/openscad-wasm), downloaded at build time
- **Storage**: IndexedDB (browser) + S3-compatible object storage (optional)
- **Testing**: Vitest

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  UI Layer (React Components)                    │
│  FileManager, ParameterEditor, PreviewPanel...  │
├─────────────────────────────────────────────────┤
│  Hooks Layer (React Hooks)                      │
│  useStorage, useOpenSCAD, useScadParser          │
├──────────────────────┬──────────────────────────┤
│  Storage Adapters    │  OpenSCAD API            │
│  storage-browser.ts  │  openscad-api.ts         │
│  storage-s3.ts       │  (postMessage bridge)    │
├──────────────────────┤                          │
│  IndexedDB / S3      │  ┌─ Worker Thread ─────┐ │
│                      │  │ openscad-worker.ts   │ │
│                      │  │ OpenSCAD WASM        │ │
│                      │  └─────────────────────┘ │
└──────────────────────┴──────────────────────────┘
```

### Why This Shape

1. **Web Worker for WASM** — OpenSCAD renders can take seconds. Running WASM on the main thread would freeze the UI. The worker thread isolates heavy computation completely.

2. **Message-passing API** — The worker communicates via `postMessage` with a request/response protocol. `openscad-api.ts` wraps this in a promise-based API so React hooks can `await` results. This is the only way to talk to a Web Worker.

3. **Storage abstraction** — Two backends (IndexedDB, S3) share a `StorageAdapter` interface. The factory in `storage.ts` uses dynamic imports so the S3 adapter and AWS SDK are only loaded when needed, keeping the default bundle small.

4. **Strict section parsing** — The parser (`scad-parser.ts`) only extracts structured sections between markers (`BEGIN_PARAMS`, etc.). It does NOT parse general OpenSCAD syntax. This is intentional — general parsing would be fragile and unnecessary.

5. **Parameter injection via prepend** — When rendering, parameter overrides are prepended to the source file. OpenSCAD uses last-assignment-wins semantics, so the user's values override defaults in the file. This avoids complex CLI flag construction.

---

## Directory Structure

```
openscad-web-generator/
  flake.nix                    # Nix flake (devShell + static site package)
  vite.config.ts               # Vite config (externals for WASM files)
  package.json                 # ESM; deps: react, idb, @aws-sdk/client-s3
  scripts/
    download-wasm.mjs          # Downloads OpenSCAD WASM from GitHub releases
    build.mjs                  # Orchestrates WASM download + vite build
  public/
    wasm/                      # OpenSCAD WASM files (populated by build, gitignored)
  src/
    main.tsx                   # React entry point (renders <App />)
    App.tsx                    # Root component — all top-level state lives here
    app.css                    # All application styles (single file)
    components/
      FileManager.tsx          # File list, upload, delete, storage backend selector
      ParameterEditor.tsx      # Type-aware parameter input form
      ParameterSetSelector.tsx # Apply/save/delete parameter sets
      PreviewPanel.tsx         # Multi-viewpoint PNG preview generation
      ExportControls.tsx       # STL/3MF export + file download
    hooks/
      useOpenSCAD.ts           # WASM worker lifecycle + render/preview methods
      useStorage.ts            # Storage adapter initialization + file operations
      useScadParser.ts         # Memoized .scad file parsing
    lib/
      scad-parser.ts           # Parses .scad structured sections (params, sets, viewpoints)
      openscad-api.ts          # Main-thread promise API wrapping worker postMessage
      openscad-worker.ts       # Web Worker: loads WASM, executes OpenSCAD
      storage.ts               # StorageAdapter factory + config types
      storage-browser.ts       # IndexedDB adapter (files + custom parameter sets)
      storage-s3.ts            # S3-compatible adapter (MinIO, AWS, etc.)
      __tests__/
        scad-parser.test.ts    # 27 tests: value/param/set/viewpoint parsing
        openscad-api.test.ts   # 9 tests: param injection, camera arg transform
    types/
      index.ts                 # All shared TypeScript types and interfaces
  AGENT_INSTRUCTIONS.md        # This file
  SCAD_FORMAT.md               # .scad file convention specification
```

---

## Code Boundaries

### Boundary 1: Main Thread ↔ Worker Thread

**Files**: `openscad-api.ts` (main thread) ↔ `openscad-worker.ts` (worker thread)

**Why this boundary exists**: WASM execution is CPU-heavy and must not block the UI. Web Workers run on a separate OS thread. Communication is limited to `postMessage` — no shared memory, no direct function calls.

**Protocol**:
```
Main → Worker (WorkerRequest):
  { type: 'init',    id }
  { type: 'render',  id, scadSource, outputFormat, args? }
  { type: 'preview', id, scadSource, cameraArgs, imgSize? }

Worker → Main (WorkerResponse):
  { type: 'init',    id, success, error? }
  { type: 'success', id, output: ArrayBuffer }
  { type: 'error',   id, error, logs }
  { type: 'log',     id, logs }
```

Each request has a unique `id` so `openscad-api.ts` can match responses to pending promises. Binary output (STL/3MF/PNG) is transferred via `ArrayBuffer` with zero-copy transfer semantics (`{ transfer: [buf] }`).

**Gotcha — camera argument reordering**: The `.scad` file format stores viewpoints as `rotX,rotY,rotZ,transX,transY,transZ,distance`, but OpenSCAD's CLI `--camera` flag expects `transX,transY,transZ,rotX,rotY,rotZ,distance`. The `viewpointToCameraArg()` function in `openscad-api.ts` handles this reordering. If you touch camera code, be aware of this.

**Gotcha — WASM dynamic import**: The worker loads WASM via `import(/* @vite-ignore */ '${base}/wasm/openscad.js')`. The `@vite-ignore` comment is required because these files live in `public/` and aren't statically resolvable. Both the main Vite config and the worker config must externalize `/wasm/` paths.

### Boundary 2: React Components ↔ Hooks

**Files**: `components/*.tsx` ↔ `hooks/*.ts`

**Why this boundary exists**: Components are presentational. Side effects (WASM communication, storage I/O, parsing) are encapsulated in hooks. Components receive data and callbacks via props; hooks manage async state.

**State ownership**: All top-level application state lives in `App.tsx`:
- `selectedFileId`, `fileSource` — which file is loaded
- `paramValues` — current parameter values (initialized from parsed defaults)
- `customSets` — user-saved parameter sets
- `storageConfig` — browser vs S3 backend selection

Components are controlled — they don't hold their own persistent state beyond local UI concerns (e.g., "is the upload button loading").

### Boundary 3: Storage Interface ↔ Storage Backends

**Files**: `storage.ts` (factory) → `storage-browser.ts` | `storage-s3.ts`

**Why this boundary exists**: The app supports two storage backends. The `StorageAdapter` interface lets the rest of the app be backend-agnostic. The factory uses dynamic `import()` so the S3 adapter + AWS SDK (~50KB) are only loaded when the user selects S3.

```typescript
interface StorageAdapter {
  listFiles(): Promise<FileInfo[]>;
  loadFile(id: string): Promise<string>;
  saveFile(id: string, content: string): Promise<void>;
  deleteFile(id: string): Promise<void>;
}
```

**Browser storage details**:
- Database: `openscad-web-app`, version 1
- Object stores: `scad-files` (file content), `parameter-sets` (custom param sets)
- Custom parameter sets are keyed `{fileId}:{setName}` with an index on `fileId`
- Deleting a file also deletes all its parameter sets (cascade via index query)

**S3 storage details**:
- All files stored under `scad-files/` prefix
- `forcePathStyle: true` for MinIO/S3-compatible endpoint support
- CORS must be configured on the bucket for browser access

### Boundary 4: Parser ↔ Everything Else

**Files**: `scad-parser.ts` (pure logic), `useScadParser.ts` (React memoization wrapper)

**Why this boundary exists**: Parsing is pure computation with no side effects. The parser takes a string and returns a `ScadFile` object. The hook wraps it in `useMemo` to avoid re-parsing on every render.

**Key design decisions**:
- Lenient parsing: malformed lines are skipped with `console.warn`, never throws
- Enum detection: inline comments like `// [circle, square, hexagon]` on a parameter line produce `options` on the `ScadParam`
- Two-blank-line separation between parameters (not one) — this is the convention

**See `SCAD_FORMAT.md`** for the full `.scad` file convention specification.

---

## Type System

All types live in `src/types/index.ts`. Key types:

| Type | Purpose |
|------|---------|
| `ScadParamType` | `'number' \| 'string' \| 'boolean' \| 'vector' \| 'enum'` |
| `ScadValue` | `number \| string \| boolean \| number[]` |
| `ScadParam` | Parsed parameter: name, type, default, help, options? |
| `ScadParamSet` | Named set of parameter overrides (partial, not full) |
| `ScadViewpoint` | Camera position: rot/trans/distance + label |
| `ScadFile` | Complete parse result: params, paramSets, viewpoints, source |
| `FileInfo` | Storage listing entry: id, name, lastModified, size? |
| `StorageAdapter` | Interface for storage backends |

---

## Data Flows

### File Loading
```
User clicks file → App.handleFileSelect
  → storage.loadFile(id) → fileSource state
  → useScadParser(source) → ScadFile { params, paramSets, viewpoints }
  → paramValues initialized from param defaults
  → components render with parsed data
```

### Preview Generation
```
User clicks "Generate Previews" → PreviewPanel.generatePreviews
  → for each viewpoint (sequential, not parallel):
    → openscad.preview(source, params, viewpoint)
    → useOpenSCAD.preview → injectParameters(source, params)
    → openscad-api → postMessage to worker
    → worker: write .scad to FS, callMain with --camera args, read PNG
    → PNG ArrayBuffer transferred back → Blob → object URL → <img>
```

**Why sequential**: There is one WASM worker instance. Parallel requests would queue inside the worker anyway, and sequential execution lets the UI show progress per viewpoint.

### Export
```
User clicks "Export STL/3MF" → ExportControls.handleExport
  → openscad.render(source, params, format)
  → worker: write .scad, callMain with -o output.{stl,3mf}, read output
  → ArrayBuffer → Blob → createObjectURL → programmatic <a> click → download
```

---

## Build System

### Development
```bash
nix develop              # Enter dev shell (Node.js 22)
npm install              # Install dependencies
npm run build:wasm       # Download OpenSCAD WASM files to public/wasm/
npm run dev              # Start Vite dev server
```

### Production Build
```bash
npm run build            # Runs download-wasm.mjs + vite build → dist/
# or via Nix:
nix build                # Reproducible build → result/
```

### Build Scripts

**`scripts/download-wasm.mjs`**: Downloads OpenSCAD WASM release assets from GitHub. Idempotent (skips if files exist unless `--force`). Creates `wasm-version.json` manifest.

**`scripts/build.mjs`**: Orchestrator. Runs WASM download (unless `--skip-wasm`), then `vite build`. The `--skip-wasm` flag is used in Nix sandbox builds where WASM files are deployed separately.

### Vite Config Notes
- WASM files in `public/wasm/` are externalized in both the main build and worker build configs
- This prevents Vite from trying to bundle the WASM JS glue files
- Worker format is set to `'es'` for ESM module workers

### Nix Flake
- `devShell`: Node.js 22
- `packages.default`: `buildNpmPackage` with `--skip-wasm` (WASM deployed separately in production)
- `npmDepsHash` must be updated when `package-lock.json` changes

---

## Testing

```bash
npm test                 # Run all tests once
npm run test:watch       # Watch mode
```

Tests cover the pure logic layers:
- **`scad-parser.test.ts`** (27 tests): Value parsing, parameter extraction, help text, enum detection, parameter sets, viewpoints, edge cases
- **`openscad-api.test.ts`** (9 tests): Parameter injection (all types, string escaping), viewpoint-to-camera-arg transformation

WASM integration is not unit-tested (requires browser environment with WASM loading).

---

## Gotchas and Pitfalls

1. **Camera argument order** — File format: `rot,trans,dist`. CLI: `trans,rot,dist`. See `viewpointToCameraArg()` in `openscad-api.ts`.

2. **ArrayBuffer typing** — `Uint8Array.buffer` is `ArrayBufferLike`, not `ArrayBuffer`. Cast with `as ArrayBuffer` for `postMessage` transfer.

3. **Vite WASM externals** — Must be configured in both the top-level `build.rollupOptions.external` AND `worker.rollupOptions.external`. Missing either causes bundling errors or double-loading.

4. **`@vite-ignore` in worker** — Required on the dynamic `import()` of WASM files from `public/`. Without it, Vite tries to resolve and fails.

5. **Worker instantiation** — Must use `new Worker(new URL('./openscad-worker.ts', import.meta.url), { type: 'module' })` for Vite module worker support. Do not use string paths.

6. **IndexedDB composite keys** — Custom parameter sets use `{fileId}:{setName}` as key. The `byFileId` index enables efficient per-file queries and cascade deletion.

7. **Storage config reactivity** — `useStorage` uses `JSON.stringify(config.s3)` in its dependency array to catch nested object changes that React's shallow comparison would miss.

8. **BrowserParamSetStorage singleton** — Instantiated at module level in `App.tsx`, not inside the component. This prevents re-creating the IDB connection on every render.

9. **Parameter injection string escaping** — Strings are escaped for OpenSCAD: quotes and backslashes are backslash-escaped. See `injectParameters()` in `openscad-api.ts`.

10. **Nix `npmDepsHash`** — Must be recalculated after any `package-lock.json` change. First build in sandbox will fail and print the correct hash.

---

## Conventions for New Code

- **No general OpenSCAD parsing** — Only parse structured sections between markers. The parser is intentionally limited.
- **Keep components presentational** — Side effects go in hooks, business logic in `lib/`.
- **One WASM worker** — The architecture assumes a single worker instance. Don't create multiple.
- **Sequential WASM operations** — Queue operations through the single worker. The API layer handles promise matching.
- **Dynamic imports for optional dependencies** — Follow the pattern in `storage.ts` for any new optional features.
- **TypeScript strict** — All code is typed. Shared types go in `src/types/index.ts`.
- **Node.js scripts, not shell scripts** — Build tooling uses `.mjs` files, not bash.
