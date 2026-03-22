# Build Plate Integration Tests — Notes

## Architecture decisions

### Bug analysis: Three interconnected issues preventing SCAD on build plate

1. **Missing `openscad` prop (App.tsx:731-737)**: The editor-screen `BuildPlateView` doesn't receive the `openscad` prop, silently disabling all SCAD functionality. The file-screen instance (App.tsx:557-564) correctly has `openscad={openscad}`.

2. **No "+ SCAD" button (BuildPlateView.tsx:752-760)**: Toolbar only has "+ STL" and "+ 3MF". The `handleAddScadFile()` function exists and works (line 232-280) but has no UI trigger. Need a button + file/example picker dialog.

3. **"Send to Build Plate" loses SCAD metadata**: `ExportControls.tsx` `handleSendToBuildPlate()` (line 212-230) sends only `meshData`, `format`, `name`, `colorGroups`. The SCAD source, params, and paramDefs are NOT passed through. So objects arriving on the build plate via this flow are treated as plain STL/3MF — no parameter editor, no re-render button. Fix requires extending the callback signature and `PendingBuildPlateObject` type.

### SCAD re-render already works — just needs to be reachable
The re-render flow is fully implemented in BuildPlateView.tsx:
- `handleReRender()` (line 415-449) — calls `openscad.render()` or `renderMulticolor()`
- `replaceObjectMesh()` (useBuildPlate.ts) — replaces mesh data while preserving position/rotation/scale
- Parameter editor shows in right panel when SCAD object is selected (line 1038-1077)
- Both single-color and multicolor re-render are supported

The user specifically wants: change parameters → re-render → object stays in same position. This already works at the code level — the issue is you can't get a SCAD object onto the plate in the first place.

### E2E test strategy
- Follow existing `tests/*.mjs` pattern exactly (not vitest, not Playwright test runner — raw Node.js scripts with Playwright API)
- Each test file is self-contained with structured output
- Shared infrastructure in `tests/helpers/` to avoid duplication
- GCode validation is the primary assertion mechanism for slicing tests
- Multi-color validation tracks per-extruder bounds + tool changes (pattern from fi-mini-multicolor-e2e.mjs)

### Test environment constraints
- OpenSCAD WASM must be present in `public/wasm/` for SCAD rendering tests
- Slicer WASM must be present for slicing tests
- BOSL2 data file needed for some examples (fi_mini_case.scad)
- Tests should detect missing WASM files and skip gracefully rather than fail with infra errors
- COOP/COEP headers required for slicer WASM (SharedArrayBuffer/pthreads)

### "+build plate from examples" loading issue
The "Loading build plate..." message appears when `plate.loaded === false` (BuildPlateView.tsx:687-692). `plate.loaded` comes from `useBuildPlate` hook's IndexedDB initialization. If IndexedDB init completes, `loaded` becomes true. The "stuck on loading" issue might be:
- IndexedDB failing silently (check for errors)
- The hook not initializing properly when `openscad` prop is missing (unlikely — openscad isn't used in init)
- A race condition between `buildPlateOpen` state and hook initialization
Need to investigate more during implementation.

## Technical reference

### Existing E2E test infrastructure
- `tests/slice-cube-e2e.mjs` — 260 lines, single-object slice flow
- `tests/fi-mini-multicolor-e2e.mjs` — ~300 lines, multicolor with per-extruder analysis
- `tests/slice-pipeline-e2e.mjs` — pipeline-focused test
- `tests/fi-mini-slice-e2e.mjs` — fi_mini_case single-color
- All use: `import { chromium } from 'playwright'`, `import { createServer } from 'vite'`

### GCode validation checks (from existing tests)
Single-color: content length, G0/G1 moves, extrusion (E param), layer changes, Z range, temperature (M104/M109), fan (M106/M107), PrusaSlicer/OrcaSlicer signature
Multi-color: tool changes (T0/T1), per-extruder XY bounds, wipe tower type comments (`;TYPE:Wipe tower`)

### Key selectors for Playwright
- `.build-plate-open-btn` — "Build Plate" button on file/editor screen
- `.build-plate-overlay` — build plate modal container
- `.build-plate-toolbar` — toolbar with add/delete buttons
- `.build-plate-btn` — toolbar action buttons
- `.build-plate-sidebar` — object list
- `.build-plate-canvas-container` — 3D canvas area
- `.export-build-plate-btn` — "+ Build Plate" in ExportControls
- `[data-testid="build-plate-canvas"]` — canvas (mocked in unit tests)

### BuildPlateObject fields for SCAD
```typescript
{
  type: 'scad',
  scadFileId: string,      // e.g., 'cube_1cm.scad'
  scadSource: string,      // .scad source code
  scadParams: Record<string, ScadValue>,  // current param values
  scadParamDefs: ScadParam[],             // param definitions for UI
  meshData: ArrayBuffer,   // rendered STL/3MF
  meshFormat: 'stl' | '3mf',
  position: { x, y },     // PRESERVED on re-render
  rotation: number,        // PRESERVED on re-render
  scale: { x, y, z },     // PRESERVED on re-render
}
```

## Key references
- Build plate prompt: `agent-work/build-plate-prompt.md`
- Build plate tasks: `memory/build-plate-tasks.md`
- Build plate notes: `memory/build-plate-notes.md`
- Existing e2e tests: `tests/slice-cube-e2e.mjs`, `tests/fi-mini-multicolor-e2e.mjs`
- BuildPlateView component: `src/components/BuildPlateView.tsx` (~1160 lines)
- useBuildPlate hook: `src/hooks/useBuildPlate.ts`
- plate-slicer utilities: `src/lib/plate-slicer.ts`
- ExportControls: `src/components/ExportControls.tsx`

## Implementation notes

### "+ SCAD" button (task 1.2)
- Added `SCAD_EXAMPLES` array at module level (mirrors `BUNDLED_EXAMPLES` from FileManager.tsx)
- Picker is a simple overlay+dialog, not a full modal — positioned absolute within `.build-plate-center`
- Only shows built-in examples for now (no user storage files) — keeping it simple. User files could be added later if needed.
- Button disabled states: `!openscad` (WASM not loaded), `scadRendering` (already rendering), `scadPickerLoading` (fetching source)
- Uses `import.meta.env.BASE_URL` for fetching example files (same pattern as App.tsx:268)

### SCAD metadata preservation (task 1.3)
- Extended `PendingBuildPlateObject` in BuildPlateView.tsx with optional `scadSource`, `scadParams`, `scadParamDefs`, `scadFileId` fields
- Added `paramDefs` prop to `ExportControls` so it can forward `ScadParam[]` to the build plate callback
- `handleSendToBuildPlate` in ExportControls now constructs `scadMeta` when the file is `.scad` and paramDefs are available
- App.tsx passes `parsedFile?.params` as `paramDefs` to ExportControls and threads the SCAD metadata through `PendingBuildPlateObject`
- BuildPlateView's pending object consumption effect detects SCAD metadata presence and sets `type: 'scad'` + populates SCAD fields
- The `onSendToBuildPlate` callback signature now has an optional 5th parameter: `scadMeta?: { source, params, paramDefs, fileId }`

### Unit tests for bug fixes (task 1.4)
- 10 new tests added, total now 62 in BuildPlateView.test.tsx
- SCAD picker tests: verified button disabled/enabled states, dialog open/close via Cancel and backdrop click, example list rendering
- Pending object SCAD metadata tests: verified `addObject` called with `type: 'scad'` and SCAD fields when metadata present, plain `type: 'stl'` when absent, `type: '3mf'` with colorGroups for 3MF format
- The SCAD picker "select example" flow (fetching source, parsing, calling handleAddScadFile) is hard to unit-test because it requires mocking `fetch` + `parseScadFile` + the async chain. The e2e tests (Phase 4) will cover this end-to-end instead.

### Shared test harness (task 2.1)
- Created `tests/helpers/build-plate-harness.mjs` with all common infrastructure
- Exports: `startServer()`, `getBaseUrl()`, `launchBrowser()`, `collectConsoleLogs()`, `injectTestPrinter()`, `acceptDisclaimer()`, `setupPage()`, `screenshotOnFailure()`, `writeConsoleLogs()`, `cleanup()`, `runTestSuite()`
- `runTestSuite()` is a high-level runner that handles server+browser lifecycle, runs each test in a fresh browser context, collects console logs, takes screenshots on failure, and outputs structured `[RESULT]` JSON
- `setupPage()` is a convenience that navigates, accepts disclaimer, injects printer, and optionally loads an example — all in one call
- Constants exported: `PROJECT_ROOT`, `OUTPUT_DIR`, `TIMEOUT_WASM_LOAD`, `TIMEOUT_RENDER`, `TIMEOUT_SLICE`
- Verified: module imports correctly, server starts and stops cleanly

### GCode validators (task 2.2)
- Created `tests/helpers/gcode-validators.mjs` with 4 exported functions:
  - `validateGCode(gcode, options?)` — 8 checks: content, moves, extrusion, layers, Z range, temperature, fan, slicer signature. Accepts optional `expectedMaxZ`/`zTolerance` for model-specific Z validation. Fan and signature are informational (don't fail).
  - `analyzeMulticolorGCode(gcode)` — tracks per-extruder XY/Z bounds, move counts, layer sets, tool change count, wipe tower detection via `;TYPE:Wipe tower`. Supports up to 16 extruders (not just T0/T1). Returns legacy `t0`/`t1` fields for compat.
  - `validateMulticolorGCode(gcode, options?)` — extends basic validation with tool change, extruder count, per-extruder move, and wipe tower checks. Configurable `expectedExtruders` (default 2) and `requireWipeTower` (default true).
  - `validatePlateGCode(gcode, expectedObjects)` — extends basic validation with print area analysis: checks XY spread is wide enough for multiple objects (>15mm for 2+ objects) and extrusion move count scales with object count.
- All functions return `{ passed, checks[], stats{} }` structure for structured reporting
- Verified: module imports and runs correctly with minimal test GCode

### Entry point e2e tests (task 3.1)
- Uses `runTestSuite()` from shared harness — each test gets fresh browser context
- File screen entry: checks `.build-plate-overlay`, `.build-plate-toolbar`, `.build-plate-sidebar`, `.build-plate-canvas-container` all appear
- Editor screen entry: loads `?example=cube_1cm.scad`, waits for `.export-controls`, then opens build plate
- No-printer test: sets `moonraker-printers` to `[]` in localStorage, reloads, clicks Build Plate — verifies overlay does NOT open
- Close test: opens overlay, clicks `.build-plate-close`, verifies overlay detaches from DOM
- Discovery: `Toast` component is only rendered in the editor-screen return path of `App.tsx` (line 753), NOT in the file-screen early return (line 525-576). So toast messages set on the file screen are invisible. This is a pre-existing UX bug, not related to the build plate feature.

### Send to Build Plate entry test (task 3.2)
- Added to existing `tests/build-plate-entry-e2e.mjs` (not a separate file — it fits naturally with entry point tests)
- Flow: load example → render STL → wait for "Re-render" text → click `.export-build-plate-btn` → verify overlay + sidebar object
- Object text in sidebar shows "SCADcube_1cm" — the "SCAD" prefix is a type badge confirming SCAD metadata preservation (bug fix 1.3 working)
- WASM render completes in ~1.5s for cube_1cm.scad — well within the 60s timeout
- The `ERR_UNSAFE_PORT` console errors are from the fake printer address (localhost:0) — harmless, expected

### Object loading e2e tests (task 4.1 + 4.2)
- 5 tests in `tests/build-plate-objects-e2e.mjs`, all passing
- **STL fixture**: Programmatically generated binary STL (80-byte header + 2 triangles = flat square). Written to `test-output/` dir.
- **3MF fixture**: Generated valid 3MF ZIP using `fflate` (same lib the app uses). Contains `[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model` with a simple 8-vertex cube mesh.
- **File chooser intercept**: The `+ STL` and `+ 3MF` buttons create dynamic `<input>` elements via `document.createElement('input')`. Playwright's `page.waitForEvent('filechooser')` cleanly intercepts these.
- **SCAD picker**: Button was already enabled (OpenSCAD WASM loads fast on file screen). Picker shows 10 examples, "1cm Cube" renders in ~1.5s via WASM.
- **Drag-drop**: Used `page.evaluate()` to construct `DataTransfer` + `File` from raw bytes, then dispatched `dragover` + `drop` events on `.build-plate-canvas-container`. Works perfectly — React's `onDrop` handler processes it.
- **No auto-arrange position verification**: The multiple objects test verifies all 3 objects appear but doesn't check positions diverge. Position data lives in React state (not easily accessible from DOM). Could be improved later by exposing positions or reading canvas object transforms.

### SCAD re-render e2e tests (task 5.1)
- **Parametric test fixture**: Created `public/examples/param_cube.scad` with `BEGIN_PARAMS`/`END_PARAMS` markers and two numeric params: `size` (default 10) and `height_factor` (default 1). Added to `SCAD_EXAMPLES` in BuildPlateView.tsx. This was necessary because:
  - `cube_1cm.scad` has NO parameters
  - `sign.scad` uses OpenSCAD Customizer syntax (`/* [group] */`) which `parseScadFile()` does NOT support — it only recognizes `BEGIN_PARAMS`/`END_PARAMS` markers
  - `fi_mini_case.scad` has `BEGIN_PARAMS` but requires BOSL2+QR and takes ~90s to render
- **Parser caveat**: Parameters in `BEGIN_PARAMS` blocks must be separated by **two or more blank lines** for the parser to treat them as distinct params. Without the blank line separator, comment lines get merged as help text for the next param.
- **Position reading**: Positions are read from `.build-plate-transform-section .build-plate-transform-grid input[type="number"]` — first input is X, second is Y
- **Re-render wait strategy**: Wait for button text to change from "Rendering..." back to "Re-render" and button to be enabled, via `page.waitForFunction`
- **Speed**: Parametric cube renders in ~24ms via WASM (trivial geometry), so re-render tests are fast (~12s total for all 3 tests)
- **SCAD params section visibility**: Requires `rightPanel === 'object-settings'` AND `type === 'scad'` AND `scadParamDefs.length > 0` AND `reRenderParams !== null`. The `reRenderParams` is initialized from `selectedObject.scadParams` via a `useEffect` on `selectedObjectId` change.

### Multicolor SCAD re-render e2e test (task 5.2)
- **No BOSL2 needed**: Created `public/examples/param_multicolor.scad` using basic `color("red")`/`color("blue")` calls — the multicolor pipeline (CSG → color discovery → per-color render → merge 3MF) works with any SCAD colors, not just colorscad/BOSL2.
- **Flow goes through editor**: The SCAD picker always adds single-color (no colorGroups), and "Re-render Multicolor" button only shows when `colorGroups` is set. So the test uses the editor → render multicolor 3MF → Send to Build Plate flow to get a multicolor SCAD object onto the plate.
- **Scoping selectors**: When the build plate overlay opens from the editor screen, the editor's parameter controls remain in the DOM behind the overlay. Must scope `.param-field` selectors to `.build-plate-overlay` to avoid strict mode violations from matching both editor and build plate param inputs.
- **Color dots**: The sidebar object items don't show color dots for multicolor objects (got 0 dots). This is a minor UI gap — the SCAD badge and "Re-render Multicolor" button correctly detect colorGroups though.
- **Multicolor re-render speed**: ~3.3s for the simple two-color cube (CSG render + 2 per-color renders + merge). Much faster than fi_mini_case.scad (~90s).

### Build plate slice e2e test (task 6.1)
- **WASM rebuilt**: `nix build .#orcaslicer-wasm` completed in ~5 min (incremental, only slicer_bindings.cpp changed). Output: `/nix/store/0ax5cbdi6za0hyr7dqlhkfjysyvdy42p-orcaslicer-wasm-2.3.1`. Copied to `public/wasm/` via `chmod u+w` + `cp` (files are read-only from Nix store copy).
- **PrintSequence value mismatch fixed**: TypeScript types use `'by_layer'`/`'by_object'` but the C++ WASM `setPrintSequence()` expects `'by layer'`/`'by object'` (with spaces). Fixed in `slicer-worker.ts:168` by adding `printSequence.replace('_', ' ')` before calling `engine.setPrintSequence()`.
- **Compile fix applied**: `slicer_bindings.cpp:390` — `set_deserialize` in OrcaSlicer requires a `ConfigSubstitutionContext` as 3rd arg. Fixed by adding `Slic3r::ConfigSubstitutionContext subst_ctx(Slic3r::ForwardCompatibilitySubstitutionRule::EnableSilent)` before the call.
- **Test results**: All 4 tests pass. Single STL slice: 10mm cube sliced in 0.8s → 6355 lines, 4238 moves, 3336 extrusion, 50 layers, Z 0.30-10.10mm, ~6m 13s print time, 256mm filament. GCode validation (content, moves, extrusion, layers, Z range, temperature, fan, slicer signature) all pass. Print stats UI shows time and filament.
- **GCode capture strategy**: Intercept `Worker.prototype.postMessage` to capture GCode sent to gcode-preview-worker (build plate has no download button).
- **WASM rebuild complete** — Phases 6 and 7 tasks are now unblocked.
- **Non-fatal warnings**: `printer_structure=cartesian` config key skipped (not in OrcaSlicer v2.3.1), acceleration validation warning (harmless), nozzle_info.json parse error (no HRC nozzle data — cosmetic).

### Validation error tests (task 8.1)
- **Empty plate**: The "Slice Plate" button has `disabled={plate.objects.length === 0}` in the JSX, so it's impossible to click when empty. Test verifies the disabled state rather than triggering `validatePlateForSlicing()`. The validation function also checks `objects.length === 0` as a belt-and-suspenders guard.
- **Out of bounds**: Position is set via the transform grid inputs (X input is `nth(0)`, Y is `nth(1)` in `.build-plate-transform-grid`). After filling "999" + Tab, `handlePositionX` fires `onUpdateTransform({ position: { x: 999, y: currentY } })`. Validation then catches X > bedWidth (235mm for ender3-s1).
- **Validation errors UI**: Displayed in `.build-plate-validation-errors` container with individual `.build-plate-validation-error` divs + a "Dismiss" button. The dismiss button calls `setValidationErrors([])`.
- **Speed**: All 3 validation tests run in ~3 seconds total (no WASM rendering needed, just STL file chooser + DOM interaction).

### Multi-object slice e2e test (task 6.2)
- **addSCADToPlate fix**: Original helper waited for `.build-plate-object-item.first()` which was already satisfied after the first add. Added `expectedCount` parameter — when >1, waits for `.build-plate-object-item:nth-child(N)` instead.
- **Auto-arrange**: Called `plate.autoArrange` via the "Arrange" button before slicing. Without this, all 3 cubes would overlap at the default center position.
- **GCode scaling**: 3 cubes produce ~3x the single-cube GCode (17,120 vs 6,355 lines, 774mm vs 256mm filament). The `validatePlateGCode` checks `multiple_object_spread` (print area >15mm) and `sufficient_extrusion` (>100 moves per object).
- **Print area**: 95.7 x 15.7mm — auto-arrange places objects in a line along the X axis with spacing.
- **Speed**: 3 objects sliced in 1.2s (vs 0.7s for single), so WASM slicer scales well.

### Per-object override slice test (task 6.3)
- **Range input manipulation**: Playwright can't use `.fill()` on `<input type="range">`. Used `evaluate()` with `nativeInputValueSetter` to set value programmatically and dispatch `input` + `change` events to trigger React's `onChange`.
- **Override CSS class timing**: When BuildPlateObjectSettings first renders for an object with no overrides, the infill density field has class `print-dialog-field` (no suffix) rather than `print-dialog-field override-inherited`. This is because `overrides` is `undefined` (not an empty object), so `createOverrideHelpers` returns empty string for `oc()`. Only after the first field change does `overrides` become `{ sparseInfillDensity: 80 }`, and then other fields show `override-inherited`.
- **Filament validation**: Single 10mm cube at 15% infill = ~256mm filament. Two cubes at 15% = ~512mm. With one at 80%, got 634.4mm — a 24% increase, confirming per-object infill override is applied by the slicer.
- **GCode comment**: Only the global `sparse_infill_density = 15%` appears in GCode end comments. Per-object overrides aren't embedded as comments — they're applied internally by libslic3r. The filament usage difference is the primary evidence that overrides work.
- **Speed**: 2 objects with per-object override sliced in 1.4s — no measurable overhead from per-object config diffing.

### Multicolor slice e2e tests (task 7.1)
- **Flow via editor**: Multicolor objects can't be created directly from the SCAD picker (it always renders single-color). Must use editor → render Multi-Color 3MF → Send to Build Plate. This is the same flow proven in task 5.2.
- **`enablePrimeTower` default is false**: `PrintProfile.enablePrimeTower` defaults to `false` in `src/types/print-profile.ts:556`. So OrcaSlicer doesn't generate `;TYPE:Wipe tower` lines in GCode. The `validateMulticolorGCode` validator must use `requireWipeTower: false`. The GCode comments section still contains `enable_prime_tower = 0` and wipe tower config keys (width, bridging, etc.) — these are always emitted regardless of the enable flag.
- **Tool changes scale with objects**: Single multicolor cube = 2 tool changes (T0→T1 at Z midpoint). Mixed plate (multicolor + single-color) = 26 tool changes — significantly more because the single-color cube is on T0 and requires frequent switching between T0 and T1 across layers.
- **Filament usage**: Single multicolor = 123.9mm, mixed plate (multicolor + single-color) = 388.8mm. The mixed plate uses ~3x more filament due to the extra single-color cube plus tool change retraction/priming overhead.
- **Speed**: All 3 tests run in ~20s total. Slicing times: single multicolor 0.9s, mixed plate 1.3s, prime tower config 0.9s.

### Prime tower enabled/disabled tests (task 7.3)
- **Bug found and fixed**: `plate.primeTower.enabled` (UI/visual state) was NOT synced to `plate.plateProfile.enablePrimeTower` (slicer config). The checkbox in `BuildPlatePrimeTower` called `plate.setPrimeTower({ enabled: true/false })` which only updated visual state — `buildOrcaConfig()` always saw `enablePrimeTower: false` (the default). Fixed by adding sync in `useBuildPlate.ts:setPrimeTower()`: when `updates.enabled !== undefined`, also calls `setPlateProfileState(prev => ({ ...prev, enablePrimeTower: updates.enabled }))`.
- **Auto-enable path**: `BuildPlateView.tsx:224-228` calls `plate.setPrimeTower({ enabled: true })` for multicolor plates — now correctly syncs to the slicer config too.
- **Test strategy**: Two strict tests replace the old weak `testPrimeTowerConfig`:
  1. `testPrimeTowerEnabled`: Sends multicolor to plate (auto-enables prime tower), opens Settings panel, verifies checkbox checked + config inputs visible, slices, asserts `;TYPE:Wipe tower` lines MUST be present in GCode.
  2. `testPrimeTowerDisabled`: Same setup, then unchecks prime tower checkbox, verifies config inputs hidden, slices, asserts NO `;TYPE:Wipe tower` lines in GCode, tool changes still present.
- **Selector for Settings panel**: `.build-plate-btn` with text "Settings" (not a tab — it's a toolbar button that toggles the right panel to `plate-settings` mode). Prime tower config is `.build-plate-prime-tower-config` inside the panel.
- **Tests 1+2 updated**: `requireWipeTower: true` since prime tower auto-enables for multicolor plates.

## Open questions
- What causes the "stuck on loading build plate" issue? Need to test IndexedDB init path
- Toast not visible on file screen — should it be added to the file-screen JSX return?
- Color dots not showing for multicolor objects in sidebar — minor UI gap
