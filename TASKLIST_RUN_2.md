# Task List & Memory — OpenSCAD Web Parameter Editor

## Status Key
- [ ] Not started
- [~] In progress
- [x] Completed
- [!] Blocked (see notes)

---

## Phase 1: Project Scaffolding & Build Infrastructure

- [x] **1.1** Create `package.json` with dependencies: react, react-dom, typescript, vite, @vitejs/plugin-react, idb, @aws-sdk/client-s3
- [x] **1.2** Create `tsconfig.json`, `vite.config.ts`
- [x] **1.3** Create `scripts/download-wasm.mjs` — Node.js script to download latest OpenSCAD WASM release from GitHub to `public/wasm/`
- [x] **1.4** Create `scripts/build.mjs` — Node.js build orchestrator (runs download-wasm if needed, then vite build)
- [x] **1.5** Create `flake.nix` — Nix flake with devShell (node, npm) and default package (static site build)
- [x] **1.6** Create minimal React app: `index.html`, `src/main.tsx`, `src/App.tsx` — just renders a placeholder page

## Phase 2: .scad File Parser

- [x] **2.1** Create `src/types/index.ts` — define ScadParam, ScadParamSet, ScadViewpoint, ScadFile types
- [x] **2.2** Create `src/lib/scad-parser.ts` — parse BEGIN_PARAMS/END_PARAMS section (parameters + help text)
- [x] **2.3** Extend parser for BEGIN_PARAM_SETS/END_PARAM_SETS (default parameter sets)
- [x] **2.4** Extend parser for BEGIN_VIEWPOINTS/END_VIEWPOINTS (viewpoints with labels)
- [x] **2.5** Write unit tests for the parser (vitest, 27 tests all passing)

## Phase 3: Storage Layer

- [ ] **3.1** Create `src/lib/storage.ts` — unified StorageAdapter interface
- [ ] **3.2** Create `src/lib/storage-browser.ts` — IndexedDB adapter using `idb`
- [ ] **3.3** Create `src/lib/storage-s3.ts` — S3-compatible adapter using AWS SDK v3
- [ ] **3.4** Create `src/hooks/useStorage.ts` — React hook wrapping the storage adapters
- [ ] **3.5** Add IndexedDB storage for custom parameter sets per file (separate object store)

## Phase 4: OpenSCAD WASM Integration

- [ ] **4.1** Create `src/lib/openscad-worker.ts` — Web Worker that loads OpenSCAD WASM
- [ ] **4.2** Create `src/lib/openscad-api.ts` — main-thread API: postMessage calls, promise wrappers
- [ ] **4.3** Create `src/hooks/useOpenSCAD.ts` — React hook wrapping the API (render, preview, status)
- [ ] **4.4** Implement parameter injection — prepend user param values to scad source before sending to WASM
- [ ] **4.5** Test WASM integration with a simple scad file, verify STL output

## Phase 5: UI Components

- [ ] **5.1** Create `src/components/FileManager.tsx` — list files, switch storage backend, load/upload files
- [ ] **5.2** Create `src/components/ParameterEditor.tsx` — render form inputs from parsed params with help text
- [ ] **5.3** Create `src/components/ParameterSetSelector.tsx` — dropdown/list of default sets from file + custom saved sets, apply/save/delete
- [ ] **5.4** Create `src/components/PreviewPanel.tsx` — display preview images from each viewpoint, loading states
- [ ] **5.5** Create `src/components/ExportControls.tsx` — STL and 3MF export buttons with download
- [ ] **5.6** Create `src/hooks/useScadParser.ts` — hook that parses a loaded scad file and returns structured data

## Phase 6: App Integration & Routing

- [ ] **6.1** Wire up `App.tsx` — file selection screen vs. parameter editor/preview screen
- [ ] **6.2** Connect FileManager -> ParameterEditor flow (load file, parse, display params)
- [ ] **6.3** Connect ParameterEditor -> PreviewPanel (on param change, trigger preview)
- [ ] **6.4** Connect ExportControls (pass current params + scad source to WASM export)
- [ ] **6.5** Integrate ParameterSetSelector with ParameterEditor (apply sets, save custom sets)

## Phase 7: Polish & Final Build

- [ ] **7.1** Add error display for OpenSCAD stderr output
- [ ] **7.2** Add loading indicators for WASM init, preview generation, export
- [ ] **7.3** Add S3 configuration UI (endpoint, bucket, access key, secret key)
- [ ] **7.4** Verify `nix build` produces working static site
- [ ] **7.5** Create a sample `.scad` file demonstrating all conventions (params, sets, viewpoints)
- [ ] **7.6** Basic CSS / layout styling for usability

---

## Memory / Discoveries

_This section is for recording things learned during implementation that future runs should know about._

### OpenSCAD WASM
- Source: https://github.com/openscad/openscad-wasm (official org repo, originally by DSchroer)
- GitHub releases: latest tag is `2022.03.20` with separate .wasm/.js files
- npm package: `openscad-wasm` v0.0.4 (July 2025, newer, has Manifold backend)
- download-wasm.mjs uses GitHub releases API to fetch assets into public/wasm/
- OpenSCAD CLI args relevant to this project:
  - `openscad -o output.stl input.scad` (STL export)
  - `openscad -o output.3mf input.scad` (3MF export)
  - `openscad -o output.png --camera=rotX,rotY,rotZ,transX,transY,transZ,dist input.scad` (preview)
  - `-D 'param=value'` to override parameters

### Key Decisions
- Vite for bundling (fast HMR, native ESM, good WASM/Worker support)
- Web Worker isolation for WASM (non-blocking UI)
- IndexedDB via `idb` (not localStorage — handles binary, larger quota)
- AWS SDK v3 `@aws-sdk/client-s3` (tree-shakeable)
- No code editor — parameter-only UI
- Scad file conventions defined in SCAD_FORMAT.md

### Gotchas
- Nix flake `npmDepsHash` needs to be filled after first successful npm install in Nix sandbox
- `vite build` and `tsc --noEmit` both pass cleanly after Phase 1
- Vitest added as test framework (v4.0.18), configured in package.json with `npm test`
- `tsc --noEmit` still passes after Phase 2
