# Agent Instructions: OpenSCAD Web Parameter Editor

## Project Overview

Build a single-page application (SPA) that allows users to:
1. Load `.scad` files from browser storage or an S3-compatible store
2. Parse declared parameters from the top of the scad file
3. Present a UI for editing those parameters (with help text from comments)
4. Select from predefined parameter sets defined in the scad file
5. Save/load custom parameter sets to browser storage per file
6. Preview the model from multiple viewpoints defined in the scad file
7. Export STL or 3MF files

The app uses OpenSCAD compiled to WebAssembly for rendering and export.

---

## Architecture

### Tech Stack
- **Frontend**: React (with TypeScript)
- **Build**: Vite (bundler), Node.js build scripts
- **Nix**: Flake-based reproducible build producing a static site
- **WASM**: Pre-built OpenSCAD WASM (downloaded at build time via Node.js script)
- **Storage**: IndexedDB (browser) + S3-compatible object storage (optional)

### Directory Structure
```
openscad-web-app/
  flake.nix                  # Nix flake for reproducible builds
  flake.lock
  package.json
  vite.config.ts
  tsconfig.json
  scripts/
    download-wasm.mjs        # Node.js script to fetch OpenSCAD WASM
    build.mjs                # Node.js build orchestration script
  public/
    wasm/                    # OpenSCAD WASM files (populated by build)
  src/
    main.tsx                 # React entry point
    App.tsx                  # Root component, routing
    components/
      FileManager.tsx        # File list, load from browser/S3
      ParameterEditor.tsx    # Parameter input form
      ParameterSetSelector.tsx # Default/custom parameter set picker
      PreviewPanel.tsx       # 3D preview from multiple viewpoints
      ExportControls.tsx     # STL/3MF export buttons
    hooks/
      useOpenSCAD.ts         # Hook wrapping WASM calls
      useStorage.ts          # Hook abstracting IndexedDB + S3
      useScadParser.ts       # Hook for parsing scad file headers
    lib/
      openscad-worker.ts     # Web Worker running OpenSCAD WASM
      openscad-api.ts        # Message-passing API to the worker
      scad-parser.ts         # Parser for the scad parameter/viewpoint format
      storage-browser.ts     # IndexedDB storage adapter
      storage-s3.ts          # S3-compatible storage adapter
      storage.ts             # Unified storage interface
    types/
      index.ts               # Shared TypeScript types
  AGENT_INSTRUCTIONS.md      # This file
  PROMPT.md                  # Agent prompt (copy and evolve per run)
  TASKLIST.md                # Task list / memory (copy and evolve per run)
  SCAD_FORMAT.md             # Scad file convention specification
```

### OpenSCAD WASM Integration

OpenSCAD provides pre-built WASM artifacts. The Node.js build script (`scripts/download-wasm.mjs`) downloads the latest release from the OpenSCAD WASM GitHub releases into `public/wasm/`.

At runtime, a **Web Worker** (`openscad-worker.ts`) loads the WASM module. The main thread communicates via `postMessage`:
- `render(scadSource, outputFormat)` -> returns ArrayBuffer (STL/3MF)
- `preview(scadSource, viewpoint)` -> returns PNG image data

The worker uses Emscripten's virtual filesystem to write the .scad source, invoke OpenSCAD, and read the output.

### React <-> WASM Communication Flow
```
React Component
  -> useOpenSCAD hook
    -> openscad-api.ts (postMessage to worker)
      -> openscad-worker.ts (Web Worker)
        -> OpenSCAD WASM (Emscripten module)
        <- output file bytes
      <- postMessage response
    <- Promise resolves
  <- hook state updates, component re-renders
```

---

## .scad File Convention

See `SCAD_FORMAT.md` for the full specification. Summary:

### Parameter Section
```scad
// BEGIN_PARAMS
// This is help text for param1
param1 = 10;

// Help text for param2
// More help text (adjacent comments merge)
param2 = "hello";

// Help for param3
param3 = true;
// END_PARAMS
```

- Parameters live between `// BEGIN_PARAMS` and `// END_PARAMS`
- Each parameter is separated by **two blank lines** from the next
- Adjacent comment lines immediately before a parameter assignment are its help text
- Supported types: number, string, boolean, vector/list

### Default Parameter Sets
```scad
// BEGIN_PARAM_SETS
// set: Small Print
// param1 = 5
// param2 = "small"
// param3 = true

// set: Large Print
// param1 = 20
// param2 = "large"
// param3 = false
// END_PARAM_SETS
```

- Lives between `// BEGIN_PARAM_SETS` and `// END_PARAM_SETS`
- Each set starts with `// set: <Name>`
- Parameters within a set are `// <paramName> = <value>` (one per line)
- Sets are separated by a blank line

### Viewpoints Section
```scad
// BEGIN_VIEWPOINTS
// 25,35,0,50,0,0,200    // Front-ish
// 0,0,0,0,0,0,300       // Top-down
// 90,0,0,0,0,0,150      // Side
// END_VIEWPOINTS
```

- One viewpoint per line between markers
- Format: `// rotX,rotY,rotZ,transX,transY,transZ,distance`
- Optional trailing comment after `//` for viewpoint label
- The app iterates over all lines and generates one preview image per viewpoint

---

## Storage Architecture

### Unified Interface
```typescript
interface StorageAdapter {
  listFiles(): Promise<FileInfo[]>;
  loadFile(id: string): Promise<string>;
  saveFile(id: string, content: string): Promise<void>;
  deleteFile(id: string): Promise<void>;
}
```

### Browser Storage (IndexedDB)
- Uses `idb` library for promise-based IndexedDB access
- Database: `openscad-web-app`
- Object stores: `scad-files`, `parameter-sets`
- Parameter sets are keyed by `{fileId}:{setName}`

### S3-Compatible Storage
- Uses the AWS SDK v3 `@aws-sdk/client-s3` (minimal bundle)
- Configuration via UI settings panel (endpoint, bucket, credentials)
- Files stored as `scad-files/{filename}.scad`
- CORS must be configured on the S3 bucket

### User selects storage backend in the UI; both can coexist.

---

## Build System

### Node.js Build Scripts

**`scripts/download-wasm.mjs`**:
1. Fetches latest OpenSCAD WASM release info from GitHub API
2. Downloads the WASM + JS glue files
3. Places them in `public/wasm/`
4. Writes a `wasm-version.json` manifest for cache busting

**`scripts/build.mjs`**:
1. Runs `download-wasm.mjs` if `public/wasm/` is empty or `--force-wasm` flag
2. Runs `vite build` to produce `dist/` static site
3. Copies any additional assets
4. Prints build summary

### package.json Scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build": "node scripts/build.mjs",
    "build:wasm": "node scripts/download-wasm.mjs",
    "preview": "vite preview"
  }
}
```

### Nix Flake

The `flake.nix`:
- Inputs: `nixpkgs`, `flake-utils`
- Provides a `devShell` with Node.js, npm
- Provides a `packages.default` that:
  1. Copies source into Nix store
  2. Runs `npm ci`
  3. Runs `node scripts/build.mjs`
  4. Outputs `dist/` as the derivation result (static site)

---

## Agent Workflow

### How to Use These Files

1. **Read `AGENT_INSTRUCTIONS.md`** (this file) for overall architecture and conventions.
2. **Read `PROMPT.md`** for the current task focus and constraints.
3. **Read `TASKLIST.md`** for what's been done, what's in progress, and what's next.
4. **Before starting work**, copy `PROMPT.md` -> `PROMPT_RUN_N.md` and `TASKLIST.md` -> `TASKLIST_RUN_N.md` (incrementing N). Work from your copies.
5. **Update your task list copy** as you work: mark tasks done, add discoveries, note blockers.
6. **Keep tasks small**. Each task should be completable within a single agent run with a small context window. If a task is too large, break it into subtasks.
7. **When finishing a run**, update `PROMPT.md` and `TASKLIST.md` with your progress so the next run can pick up where you left off.

### Task Sizing Guidelines
- A single task should touch **at most 2-3 files**
- A single task should take **at most ~100 lines of code changes**
- If parsing + UI + WASM integration are all needed, split into 3 tasks
- Infrastructure tasks (Nix, build scripts) should be separate from app code tasks

### Key Decisions Already Made
- Vite as bundler (fast, good WASM support)
- Web Worker for WASM isolation (prevents UI blocking)
- IndexedDB for browser storage (not localStorage — binary-friendly, larger quota)
- `idb` library for IndexedDB (thin, promise-based wrapper)
- AWS SDK v3 for S3 (tree-shakeable, minimal bundle size)
- TypeScript throughout
- No code editor component — just a parameter form UI

---

## Critical Implementation Notes

1. **WASM Loading**: OpenSCAD WASM must be loaded in a Web Worker. The main thread should never directly instantiate it. Use `new Worker(new URL('./openscad-worker.ts', import.meta.url))` for Vite compatibility.

2. **Scad File Parsing**: The parser must handle the exact format specified in `SCAD_FORMAT.md`. Do not attempt to parse general OpenSCAD syntax — only the parameter/viewpoint/set sections between the markers.

3. **Preview Generation**: OpenSCAD WASM can render to PNG via `--render --o output.png --camera=rotX,rotY,rotZ,transX,transY,transZ,dist`. Iterate over all viewpoints defined in the file.

4. **Parameter Injection**: When running OpenSCAD (for preview or export), prepend parameter overrides to the scad source:
   ```scad
   param1 = <user_value>;
   param2 = <user_value>;
   // ... then the original file content
   ```

5. **3MF Export**: OpenSCAD supports 3MF output via `--export-format 3mf`. Ensure the WASM build supports this.

6. **Error Handling**: OpenSCAD WASM writes errors to stderr. Capture and display these in the UI.
