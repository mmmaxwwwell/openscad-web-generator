# Build Plate — Notes

## Architecture decisions

### Data model: Partial<PrintProfile> for per-object overrides
Per-object settings use `Partial<PrintProfile>` — only fields the user explicitly overrides are set. At slice time, merge: `{ ...plateProfile, ...objectOverrides }`. This means:
- No duplication of the PrintProfile type
- Clear semantics: `undefined` = inherit from plate, any value = override
- Settings tabs can show inherited vs overridden state by checking if the field exists in the overrides object
- The reset button simply deletes the field from overrides

### WASM slicer: additive multi-object API
The current `loadSTLFile` / `load3MFFile` replace the entire model. For multi-object plates, we add:
- `clearModel()` — resets to empty
- `addSTLObject(path, posX, posY, rotZ, scaleX, scaleY, scaleZ)` — adds without replacing
- `add3MFObject(...)` — same, preserving multicolor volumes
- `setObjectConfig(index, key, value)` — per-object config via `ModelObject::config`
- `setPrintSequence(mode)` — "by layer" vs "by object"

libslic3r natively supports all of this. Each `ModelObject` has:
- `ModelInstance` with offset (Vec3d), rotation (Vec3d), scaling_factor (Vec3d)
- `DynamicPrintConfig config` for per-object overrides
- Multiple `ModelVolume`s for multicolor

The `slice()` method already calls `m_print->apply(m_model, m_config)` which handles multi-object models.

### Coordinate system
- libslic3r uses: X right, Y back, Z up. Origin at bed front-left (unless originCenter).
- Three.js uses: X right, Y up, Z toward camera.
- Conversion: swap Y↔Z, negate new Z. Applied as a group rotation (-π/2 around X) in the canvas, same as PreviewPanel.
- Object positions in BuildPlateObject are in **model space** (X right, Y back, mm from origin). The canvas converts for display.

### Touch interaction strategy
All interactions use PointerEvent (not MouseEvent/TouchEvent):
- Single pointer on object → drag to move (with setPointerCapture)
- Single pointer on empty space → orbit (handled by OrbitControls)
- Pinch (two pointers) → zoom (OrbitControls handles this)
- Drag on rotation handle → rotate around Z
- Drag on scale handle → scale

Distinguish move from orbit by checking if pointerdown hits an object (via raycaster). If yes, enter drag mode and prevent OrbitControls from capturing. If no, let OrbitControls handle it.

### Print sequence: by-layer vs by-object
- **By layer** (default): all objects printed simultaneously, layer by layer. Standard mode.
- **By object**: each object is fully printed before moving to the next. Requires height clearance checks — the printhead + gantry must clear completed objects. This means objects need sufficient XY spacing relative to their heights.
- OrcaSlicer config key: `print_sequence` = "by layer" or "by object"
- For by-object mode, validation should warn about potential collisions (but we don't need to do full collision simulation — just check bounding box clearance).

### Build plate persistence
- Plate state (objects, settings, transforms) saved to IndexedDB
- Mesh data (ArrayBuffer) stored as IndexedDB blobs (can be large)
- Settings and transforms stored as JSON
- One active plate per printer (keyed by printer address/id)
- Future: multiple saved plates per printer

### Entry point: alongside existing flow
- Build plate is a separate mode, not a replacement
- "Build Plate" button in main UI (requires printer selection first)
- "Send to Build Plate" in ExportControls adds current model to plate
- Closing build plate returns to normal mode
- Both modes share the same printer/filament settings

## Technical reference

### libslic3r Model API (from OrcaSlicer source)
```cpp
// Model contains objects
class Model {
    ModelObjectPtrs objects;
    void center_instances_around_point(Vec2d point);
    ModelObject* add_object();
    void delete_object(size_t idx);
};

// Each object has geometry (volumes) + placement (instances) + config
class ModelObject {
    ModelVolumePtrs volumes;
    ModelInstancePtrs instances;
    ModelConfigObject config;  // per-object print config overrides

    ModelVolume* add_volume(TriangleMesh mesh);
    ModelInstance* add_instance();
    void ensure_on_bed();
    BoundingBoxf3 bounding_box_exact();
};

// Instance = one placement of an object (position + rotation + scale)
class ModelInstance {
    Vec3d get_offset();
    void set_offset(Vec3d);
    Vec3d get_rotation();
    void set_rotation(Vec3d);
    Vec3d get_scaling_factor();
    void set_scaling_factor(Vec3d);
};

// Volume = one piece of geometry within an object
class ModelVolume {
    TriangleMesh mesh();
    ModelConfigObject config;  // can set "extruder" here for multicolor
};
```

### Per-object config in libslic3r
`ModelObject::config` is a `ModelConfigObject` (wraps `DynamicPrintConfig`). When Print::apply() processes the model, it reads each object's config and uses it as override over the global print config. The config uses the same string keys as the global config.

Key per-object overridable keys (from PrintObjectConfig):
- `layer_height`, `line_width`, `wall_loops`, `sparse_infill_density`, `sparse_infill_pattern`
- `enable_support`, `support_type`, `support_style`, `support_threshold_angle`
- `brim_type`, `brim_width`, `seam_position`
- `ironing_type`, `fuzzy_skin`, `wall_generator`
- All speed/acceleration fields
- All support detail fields
- Bridge settings, gap fill, overhang settings

### Three.js interaction patterns
- Raycaster: `raycaster.setFromCamera(pointer, camera)` → `raycaster.intersectObjects(scene.children, true)`
- Pointer to 3D: `raycaster.ray.intersectPlane(bedPlane, intersectPoint)` gives XY position on bed
- PointerEvent: `onPointerDown`, `onPointerMove`, `onPointerUp` — unified mouse+touch
- `setPointerCapture(pointerId)` — ensures pointermove/up fire even if pointer leaves element
- OrbitControls: `controls.enabled = false` to temporarily disable during drag

### Mesh bounding box computation
For auto-arrange and collision detection, need bounding box from raw mesh data:
- STL: parse 80-byte header, then iterate triangles (50 bytes each), track min/max XYZ
- 3MF: parse XML model, extract vertex positions, track min/max
- Or: use Three.js geometry.boundingBox after loading — simpler, already parsed
- Cache bounding boxes per object (recompute on mesh change, not on transform change)
- Apply rotation/scale to bounding box for arranged bounds

### New PrintProfile fields (from OrcaSlicer research)
Fields to add (not already in PrintProfile):
- `printSequence`: 'by_layer' | 'by_object' — plate-level setting
- `elephantFootCompensation`: number (mm, default 0)
- `elephantFootCompensationLayers`: number (int, default 1)
- `xyHoleCompensation`: number (mm, default 0)
- `xyContourCompensation`: number (mm, default 0)
- `slicingMode`: 'regular' | 'even_odd' | 'close_holes' (default 'regular')
- `flushIntoObjects`: boolean (default false)
- `flushIntoInfill`: boolean (default false)
- `flushIntoSupport`: boolean (default false)
- `raftContactDistance`: number (mm, default 0.1)
- `raftExpansion`: number (mm, default 1.5)
- `raftFirstLayerDensity`: number (%, default 90)
- `raftFirstLayerExpansion`: number (mm, default 2)
- Tree support: `treeSupportBranchDistance` (mm, default 5), `treeSupportTipDiameter` (mm, default 0.8), `treeSupportBranchDiameter` (mm, default 2), `treeSupportBranchAngle` (degrees, default 40), `treeSupportWallCount` (int, default 0), `treeSupportAutoBrim` (bool, default true)
- `interlockingBeam`: boolean (default false)
- `interlockingBeamWidth`: number (mm, default 0.8)
- `interlockingOrientation`: number (degrees, default 22.5)
- `interlockingBeamLayerCount`: number (int, default 2)
- `interlockingDepth`: number (mm, default 2)
- `bridgeNoSupport`: boolean (default false)
- `maxBridgeLength`: number (mm, default 10)
- `supportExpansion`: number (mm, default 0)
- `supportCriticalRegionsOnly`: boolean (default false)
- `supportRemoveSmallOverhang`: boolean (default true)
- `brimObjectGap`: number (mm, default 0)

## Implementation notes

### plate-slicer.ts design decisions
- `mergeObjectSettings()` explicitly skips `undefined` values in overrides (iterates Object.keys, checks `!== undefined`). This means `{ wallLoops: undefined }` does NOT override the plate default — only explicitly set values count.
- `buildPlateSliceConfig()` generates a full OrcaSlicer config for each overridden object, then diffs against the global config. This ensures the per-object config only contains keys that actually differ, which is what libslic3r's `ModelObject::config` expects.
- `objectConfigDiff()` is intentionally a one-way diff (object vs global), not symmetric. It only includes keys present in the object config that differ from global.
- `autoArrangeObjects()` uses a fixed `estimatedObjectSize` (default 30mm) because we don't have mesh bounding boxes yet. Phase 11 will enhance this with actual geometry bounds.
- `validatePlateForSlicing()` does position-only validation for now. Full bounding-box collision detection will come with Phase 11's auto-arrange enhancement.

## Key references
- Current slicer bindings: `src/wasm/slicer_bindings.cpp`
- Current slicer engine: `src/lib/slicer-engine.ts`
- Current 3D preview: `src/components/PreviewPanel.tsx`
- Current print dialog: `src/components/PrintDialog.tsx`
- Print profile type: `src/types/print-profile.ts`
- OrcaSlicer config mapping: `src/lib/orca-slicer-settings.ts`
- Printer profiles: `src/data/printer-profiles.ts`
- Three.js OrbitControls: imported from `three/addons/controls/OrbitControls.js`
- STL/3MF loaders: `three/addons/loaders/STLLoader.js`, `three/addons/loaders/3MFLoader.js`
- Merge 3MF utility: `src/lib/merge-3mf.ts`

### slicer_bindings.cpp multi-object implementation details
- `m_plate_mode` flag distinguishes single-object (legacy `loadSTLFile`/`load3MFFile`) from multi-object (`addSTLObject`/`add3MFObject`) flows. In plate mode, `slice()` skips centering and `ensure_on_bed` since those are handled per-object at add time.
- `addSTLObject`: loads STL into temporary `Slic3r::Model`, copies first object via `m_model.add_object(*src_obj)`, clears instances, creates fresh instance with caller-provided transform. Calls `ensure_on_bed()` on the individual object.
- `add3MFObject`: loads 3MF into temp model, applies same multi-color merge logic as `load3MFFile` (merge all objects into one with multiple volumes, extruder assignment, CSG overlap correction). Then copies merged object to main model with requested transform. Uses min-Z volume translation (not `ensure_on_bed`) to preserve stacked volume positions.
- `setObjectConfig`: uses `ModelObject::config.set_deserialize(key, value)` — same key format as global config. Silently ignores unknown options.
- `clearModel()` resets all state flags including `m_plate_mode`, `m_sliced`, `m_print`.
- Both `addSTLObject` and `add3MFObject` return the 0-based object index for use with `setObjectConfig`.
- Pre-existing test failures (19 tests in config-key-registry and print-profile-completeness) are from Phase 1's new PrintProfile fields not yet fully integrated into those test suites. Not related to Phase 3 changes.

### useBuildPlate.ts design decisions
- Hook takes `bedWidth, bedDepth, maxHeight, originCenter` as params (from printer profile) rather than a full printer object — keeps it decoupled.
- Persistence uses two IndexedDB stores: `plate-meta` (JSON-serializable state) and `plate-meshes` (ArrayBuffer blobs keyed by `mesh-{objectId}`). This avoids IDB structured clone issues with large ArrayBuffers in JSON.
- Plate key is `plate-${bedWidth}x${bedDepth}` — one plate per bed configuration. Different printers with the same bed share a plate.
- Save is debounced (500ms) to avoid excessive IDB writes during rapid transforms (dragging).
- `addObject` auto-positions new objects via `autoArrangeObjects()` when there are existing objects. First object goes to bed center.
- `duplicateObject` offsets the copy by 10mm in both X and Y, deep-clones meshData/overrides/params.
- `updateObjectOverrides` merges (spreads existing + new overrides). `clearObjectOverrides` sets to `undefined`.
- SCAD re-render is NOT done inside the hook — instead `replaceObjectMesh()` lets the calling component coordinate with `useOpenSCAD`. This avoids the hook depending on `useOpenSCAD` and keeps concerns separated. Phase 7 will wire this up in BuildPlateView.
- `loaded` flag indicates when IDB load is complete, so the UI can show a loading state.

### BuildPlateCanvas.tsx design decisions
- Three.js import paths use `three/examples/jsm/` (same as PreviewPanel.tsx).
- Coordinate mapping: model space (X right, Y back, Z up) → Three.js (X right, Y up, Z toward camera). Object positions: `threeX = modelX`, `threeZ = -modelY`. Z-up→Y-up via `group.rotation.x = -Math.PI / 2` on each mesh group.
- Scale mapping swaps Y/Z: `group.scale.set(scaleX, scaleZ, scaleY)` to match coord system swap.
- Rotation: model Z-axis rotation (degrees) → Three.js Y-axis rotation (radians, negated).
- Geometry cache uses a fast fingerprint (`byteLength:head8:tail8`) — not cryptographic, just enough to detect mesh data changes without hashing the full buffer. Cache entries are cleaned up when no object references them.
- Objects are auto-placed on bed via bounding box: after Z-up→Y-up rotation, shift Y so `box.min.y = 0`.
- Selection detection: Raycaster on pointerDown finds intersected meshes, walks up parent hierarchy to find the container Group with `userData.objectId`.
- Selection highlight uses `EdgesGeometry` with bright cyan lines (opacity 0.8), tagged with `userData.isSelectionHighlight` for easy removal.
- Dark background (0x1a1a2e) provides good contrast for both light and dark colored models.
- `maxHeight` prop accepted but unused currently — will be used for height limit visualization or camera far plane in later phases.
- `originCenter` parameter in `applyTransform` is passed but unused — the model-to-Three.js conversion is the same regardless (bed grid handles the visual offset). Prefixed with `_` to suppress TS error.
- Bed grid uses separate line geometries for X and Z parallel lines (10mm spacing), plus a border line loop and a semi-transparent plane at Y=-0.1.

### Drag-to-move interaction (5.2)
- Drag state uses refs (`isDraggingRef`, `dragObjectIdRef`, `dragOffsetRef`) — not React state — to avoid re-renders during fast pointermove events. Only the final position is committed via `onUpdateTransform` on pointerup.
- Drag offset is the vector from the object's Three.js position to the bed-plane hit point at drag start. During move, the object position = bed hit point - offset. This prevents the object from "snapping" to the pointer.
- Orbit vs drag distinction: pointerdown checks raycaster hit. Object hit → disable OrbitControls + start drag. Empty space → OrbitControls handles everything naturally.
- `setPointerCapture` ensures pointermove/up events keep firing even if the pointer leaves the canvas element (critical for touch).
- `handlePointerCancel` mapped to `handlePointerUp` to gracefully end drags interrupted by the system.
- Hover cursor feedback via `handlePointerMove` when not dragging — runs `hitTestObjects` to show 'grab' cursor over objects.
- Three.js → model-space conversion on pointerup: `modelX = threeX`, `modelY = -threeZ`.
- Helper functions extracted: `clientToNDC` (client coords → NDC), `hitTestObjects` (NDC → objectId or null), `projectToBed` (NDC → Three.js Vector3 on Y=0 plane).

### Rotation & scale handles (5.3)
- Handles are a separate `THREE.Group` in the scene (not children of the object group) — avoids inheriting object rotation/scale.
- Handle positions come from the selected object's world-space bounding box. The handles effect re-runs whenever `objectFingerprints` or `selectedObjectId` change, so handles automatically reposition when the object moves.
- Rotation interaction: angle tracked via `atan2(pointerZ - centerZ, pointerX - centerX)` on the bed plane. Delta angle from drag start is subtracted from start rotation (negated because Three.js Y-up rotation is opposite to model-space Z rotation direction).
- Scale interaction: uniform scale by ratio of current pointer distance from center vs start distance. Clamped to [0.1, 10] to prevent degenerate geometry.
- Non-uniform scale (shift key / two-finger) not implemented yet — uniform only for now.
- Grid snap converts to model space before snapping (avoids issues with the Three.js ↔ model coordinate flip).
- Numeric overlay is a plain HTML div with `pointerEvents: none` — doesn't interfere with Three.js interactions.
- The `interactionModeRef` tracks current mode ('none' | 'drag' | 'rotate' | 'scale') and is reset on pointerUp. This replaces the old simpler `isDraggingRef` check in the move handler (though `isDraggingRef` is kept for the early exit check).

### BuildPlateCanvas test mocking strategy (5.4)
- jsdom has no WebGL, so all Three.js classes must be mocked via `vi.mock('three', ...)`.
- **Critical**: all mock constructors MUST be regular `function` declarations, NOT arrow functions. Arrow functions can't be used with `new` and vitest's `vi.fn()` doesn't fix this.
- Mock hierarchy: `mockGeo()` and `mockMat()` return plain objects with `dispose()` and `clone()` methods. `mockGroup()` returns objects with `children`, `userData`, `position`, `rotation`, `scale`, `add`, `remove`, `traverse`, `clone`.
- `Mesh` mock needs `rotation`, `scale`, `add` (for selection highlight children), and `userData`.
- `createPrimeTower` returns early when disabled WITHOUT setting `userData.isPrimeTower` — test checks for absence, not empty children.
- Overlay tests verify DOM output (numeric position/rotation/scale display) since that's pure React rendering.
- Pointer event tests verify callbacks fire and no crashes — actual raycaster behavior is mocked (always returns no hits).

### BuildPlateView.tsx design decisions (6.1)
- Toolbar and object list are inlined into BuildPlateView rather than extracted to separate components (BuildPlateToolbar, BuildPlateObjectList). This keeps it simple for now — they can be extracted in tasks 6.2/6.3 if complexity grows, or those tasks can be marked `[~]` skipped.
- Right panel has two modes: `object-settings` (auto-opens on object selection) and `plate-settings` (toggled via Settings button). Selecting null closes the object settings panel.
- File import uses `document.createElement('input')` + `FileReader.readAsArrayBuffer()` — standard browser pattern, no drag-and-drop yet (Phase 7).
- Object list shows type badge (STL/3MF), name (truncated with ellipsis), and override indicator (*) for objects with per-object settings.
- Transform inputs in the right panel use `Math.round(x * 10) / 10` for display precision, matching the numeric overlay in BuildPlateCanvas.
- Scale input is uniform only (changes X/Y/Z equally) — matches canvas behavior. Non-uniform scale UI deferred.
- Bed dimensions extracted via `getPrinterProfile(printer.profileId)` with sensible defaults (235x235x300, front-left origin).
- "Slice Plate" button is present but non-functional — wiring to useSlicer.slicePlate() is Phase 10.
- Placeholder text in per-object overrides and plate settings sections references Phase 8 where the full tabbed settings UI will be added.
- CSS uses ~260 lines with responsive breakpoint at 768px: sidebar becomes horizontal strip, right panel becomes bottom-sheet overlay.

### App.tsx build plate integration (6.4)
- Build plate is an overlay (`build-plate-overlay` class with `position: fixed; inset: 0`), not a route — both file-selection and editor screens can open it.
- "Build Plate" button is in both screens (file list and editor header). Requires at least one printer configured (for bed dimensions).
- "Send to Build Plate" in ExportControls uses a pending-object pattern: `setPendingBuildPlateObject` in App → passed as `pendingObject` prop to BuildPlateView → consumed in useEffect when `plate.loaded` is true → calls `plate.addObject()` → `onPendingObjectConsumed` clears the pending state.
- ColorGroup mapping needed: ExportControls/merge-3mf uses `{ index, colorHex }` but useBuildPlate.addObject expects `{ color, name? }`. The conversion (`g.colorHex → color`) happens in BuildPlateView's pending-object consumer.
- `file-screen-actions` div wraps both Build Plate and Printers buttons on the file selection screen for flex layout.

### File import design (7.1)
- `addSTLFile` and `add3MFFile` are async convenience methods on `useBuildPlate` hook — use `file.arrayBuffer()` (not FileReader) for cleaner async flow.
- `add3MFFile` automatically calls `extractColorGroups()` and maps `ColorGroup` (with `colorHex`) to the hook's `{color}` format. Empty results → `undefined` (not empty array).
- SCAD rendering stays in `BuildPlateView`, not in the hook — the hook provides `addObject()` with `type: 'scad'` and stores `scadSource/scadParams/scadParamDefs/scadFileId`. The component coordinates with `useOpenSCAD`.
- `handleAddScadFile` in BuildPlateView handles both single-color (render to STL) and multicolor (renderMulticolor to 3MF with color extraction) via a `multicolor` flag.
- Drag-and-drop uses standard React DragEvent handlers on the canvas container div. Only STL and 3MF accepted (SCAD drag-drop not supported since it requires source parsing).
- `isDragOver` state for visual feedback — `dragLeave` checks `e.relatedTarget` containment to avoid false leaves when entering child elements.
- `openscad` prop on BuildPlateView is optional — SCAD import simply won't work without it, but STL/3MF import works fine.
- SCAD rendering shows progress overlay ("Rendering SCAD...") and error banner (red with dismiss button).

### SCAD re-render workflow (7.2)
- Local `reRenderParams` state is initialized from `selectedObject.scadParams` when selection changes (via `useEffect` on `selectedObjectId`). This means switching between objects resets any uncommitted param edits.
- Param edits are local-only until the user clicks "Re-render" — the object's `scadParams` are only updated on successful render via `replaceObjectMesh()`. This is the implicit undo: if render fails, old mesh and old params remain.
- "Re-render Multicolor" button only shown when `selectedObject.colorGroups` exists — this is a heuristic for "this object was originally rendered as multicolor". A SCAD object initially rendered as single-color can only re-render as single-color (no way to switch to multicolor without re-importing).
- The `ParameterEditor` `<h3>Parameters</h3>` header is hidden via CSS (`display: none`) since the section already has its own `<h4>SCAD Parameters</h4>` heading.
- Param editor is scrollable (max-height 300px) to prevent the right panel from becoming too tall with many parameters.

### BuildPlateView test patterns (7.3)
- Component tests require `cleanup()` in `afterEach` to prevent test isolation issues — previous renders' DOM interfere with later tests' `getByText` queries.
- The right panel only opens via `handleSelectObject` (triggered by clicking sidebar items). Tests must `await act(() => clickObjectInSidebar(...))` to open it before testing Re-render buttons.
- `clickObjectInSidebar` uses DOM query (`.build-plate-object-item`) rather than `getByText` to avoid matching the panel header which also contains the object name.
- Dynamic `await import('../lib/merge-3mf')` inside `handleReRender` requires extra microtask time in tests. Adding `await new Promise(r => setTimeout(r, 50))` inside `act()` after clicking "Re-render Multicolor" ensures `extractColorGroups` and `replaceObjectMesh` complete.
- Mock `useBuildPlate` returns a mutable `mockPlate` variable that's reassigned per test in setup functions. The `vi.mock` factory closure reads the current value via `() => mockPlate`.
- `ParameterEditor` is mocked to render buttons that call `onChange(name, value+1)` on click — allows testing param-change-then-re-render flow without the full param editor.

### BuildPlateObjectSettings design decisions (8.1)
- Component receives the object, plate profile, and callbacks — it manages its own active tab and uniform-scale toggle state.
- Merged profile computed via `mergeObjectSettings(plateProfile, object.printOverrides)` — same function used at slice time. Tab components receive this merged profile.
- Tab `onChange` callbacks forward directly to `onUpdateOverrides` — the tab components emit `Partial<PrintProfile>` which maps exactly to per-object overrides.
- `handleResetField` in BuildPlateView clears a single field by: cloning overrides, deleting the key, clearing all overrides, then re-setting the remaining ones. This is because `updateObjectOverrides` merges, so there's no "remove single key" method.
- Cooling and Retraction tabs excluded from build plate settings — they require `ResolvedFilamentSettings`, `filamentName`, `isOverridden(filamentField)`, `updateFilamentField`, `resetFilamentField` which come from the filament/printer override system in PrintDialog. Build plate mode doesn't have this filament context. These settings are filament-level (fan speeds, retraction distance/speed) rather than per-object overridable print settings.
- `PrintSettingsTabProps` has optional `overrides?: Partial<PrintProfile>` and `onResetField?` — consumed by all 7 build-plate tabs via `createOverrideHelpers()`.

### Override indicator implementation (8.2)
- `override-helpers.tsx` exports `createOverrideHelpers(overrides, onResetField)` which returns two helpers: `oc(field)` returns CSS class string (` override-active` | ` override-inherited` | `''`), `resetBtn(field)` returns inline `<button>` or null.
- Each tab calls `const { oc, resetBtn } = createOverrideHelpers(overrides, onResetField)` at top. Per-field: `className={\`print-dialog-field${oc('fieldName')}\`}` and `{resetBtn('fieldName')}` inside the `<span>` label.
- When `overrides` is undefined (PrintDialog usage), both helpers return empty string / null — zero visual change, fully backward-compatible.
- `.override-active`: 3px solid #4fc3f7 left border, subtle blue background. `.override-inherited`: opacity 0.55.
- Reset button: 18px circular ↺ with cyan border, `e.preventDefault() + e.stopPropagation()` to prevent label click from toggling associated input.
- `LineWidthField` sub-component in QualityTab takes additional `overrideClass` and `resetBtnEl` props.
- CoolingTab and RetractionTab not modified — excluded from build plate mode (filament-level settings).
- Plate-level settings panel also uses the same tabbed structure (7 tabs) with `plate.plateProfile` and `handlePlateProfileChange`.
- Uniform scale toggle: when enabled (default), changing X scale sets X=Y=Z. When disabled, each axis is independent.
- Extruder assignment dropdown only shown when `object.colorGroups` exists AND `onSetExtruder` is provided. Shows one option per color group.

### BuildPlateObjectSettings test patterns (8.3)
- Transform inputs must be scoped to `.build-plate-transform-section` via `within()` — the settings tab content also contains `spinbutton` inputs that would pollute `getAllByRole('spinbutton')`.
- Tab buttons must be queried via `.build-plate-settings-tab-bar` scope — tab content (e.g., InfillTab) may contain labels with the same text as tab names.
- Checkbox toggling (e.g., Uniform scale) requires `fireEvent.click(checkbox)`, NOT `fireEvent.change(checkbox, { target: { checked: false } })` — the latter doesn't trigger React state updates in jsdom.
- Merged profile tests should use fields with unique values (e.g., `wallLoops: 7` on Walls tab) — `layerHeight` has both a range slider and number input with the same value, plus `initialLayerPrintHeight` may coincidentally match.
- `cleanup()` in `afterEach` is essential — without it, previous tests' DOM bleeds into subsequent tests' `screen` queries, causing false positives/negatives.
- Override indicator tests use CSS class queries (`.override-active`, `.override-inherited`, `.override-reset-btn`) rather than text queries for reliability.

### Prime tower drag interaction (9.1)
- Prime tower drag uses a special `drag-prime-tower` interaction mode (not the generic `drag` mode) because the prime tower is not an object group in `objectGroupsRef` — it's a separate scene element in `primeTowerGroupRef`.
- `hitTestPrimeTower` raycasts against the tower's meshes. It's checked after handles but before objects in pointerDown priority.
- During drag, tower mesh + edge line positions are updated directly (traverse children). On pointerUp, model-space position is committed via `onUpdatePrimeTowerPosition` callback.
- The prime tower's Three.js children (mesh + edge lines) each have their own `position` set to the tower center (not using a parent group transform), so drag updates must traverse and set each child's position.
- `checkPrimeTowerCollisions` in `BuildPlatePrimeTower.tsx` uses estimated 30mm object bounding box (same as `autoArrangeObjects`) since actual mesh bounding boxes aren't computed until Phase 11.
- Auto-enable logic: a `useEffect` in BuildPlateView watches `plate.objects` and calls `setPrimeTower({ enabled: true })` when any object has `colorGroups.length > 1`. It does NOT auto-disable when multicolor objects are removed (user might want to keep it enabled).

### Flush volume matrix design (9.2)
- `FlushVolumeConfig` stores a flat row-major `number[]` matrix matching OrcaSlicer's `flush_volumes_matrix` format directly (comma-separated).
- `getPlateExtruderCount()` derives extruder count from objects: max of all `colorGroups.length` and `extruderAssignment` values. Returns at least 1; flush UI only renders when ≥2.
- Matrix auto-resizes via `resizeMatrix()` when extruder count changes — existing values preserved, new cells filled with `defaultFlushVolume` from plate profile.
- Multiplier is applied at slicer config time (in `plate-slicer.ts`), not stored in the matrix itself — this means the raw matrix values are always what the user entered, and multiplier scales them at output.
- When `flushVolumeConfig` is `undefined`, the existing `buildOrcaConfig()` logic generates the matrix from `PrintProfile.flushVolume` as before — the override in `plate-slicer.ts` only kicks in when a custom config exists.
- `createDefaultMatrix()` and `getPlateExtruderCount()` are exported from the component file for potential reuse in tests/slicer logic.
- Extruder labels show color dots when objects have `colorGroups` with hex colors, falling back to "E1", "E2", etc.

### Plate slicing pipeline (10.1)
- BuildPlateView now owns its own `useSlicer` hook instance — independent from the one in App.tsx (used by PrintDialog). This is correct: each can slice independently.
- Filament resolution: `useFilaments(printer.profileId, printer.nozzleDiameter)` → `useExtruderFilaments(printer.address, extruderCount)` → `usePrinterFilamentOverrides().getResolvedFilament()`. Same pattern as PrintDialog.
- `PrinterSettings` built from printer profile via `printerSettingsFromProfile()` (duplicated from PrintDialog — could be extracted to a shared utility, but keeping it simple for now).
- Moonraker config applied via `usePrinterConfig(printer.address)` effect, same as PrintDialog.
- `extruderCount` derived from plate objects via `getPlateExtruderCount()` (reused from BuildPlateFlushVolumes).
- Slice result panel replaces the right settings panel (via conditional rendering) when a result exists. "Back" button clears the result.
- GCode parsing uses the same worker pattern as PrintDialog: `gcode-preview-worker.ts` in a web worker, with progress tracking.
- Upload uses `uploadToMoonraker()` directly (from SendToPrinter.tsx) rather than opening the full SendToPrinter component — simpler since we already know which printer to target.
- GCode filename is auto-generated as `plate_${timestamp}.gcode` — no original filename context in plate mode.
- Duplicate BuildPlateView render in App.tsx (lines ~557 and ~731) is pre-existing — first has `openscad` prop, second doesn't. Both render when build plate is open but only one is needed. Should be cleaned up separately.

### Integration test patterns (10.2)
- `buildOrcaConfig` only emits multi-material keys (`enable_prime_tower`, `flush_volumes_matrix`, etc.) when `extruderCount > 1`. Tests for single-extruder must expect these keys to be `undefined`.
- OrcaSlicer bed temp key is `hot_plate_temp` (not `bed_temperature`). `bed_temperature` is a Klipper GCode placeholder, not a config key.
- `plate.printSequence` and `plateProfile.printSequence` are separate — the former goes to `job.printSequence`, the latter drives the `print_sequence` config key via `buildOrcaConfig`. Tests must set both for consistent behavior.
- The `print_sequence` config value uses spaces: `"by layer"` / `"by object"` (not underscores).

### Auto-arrange algorithm (11.1)
- Bounding box parsing: `computeSTLBoundingBox` parses binary STL (80-byte header + triangle vertices) — O(triangleCount). `compute3MFBoundingBox` uses fflate to unzip, then regex `/<vertex\s+x="..." y="..." z="..."/g` to extract vertices from `3dmodel.model` XML.
- `computeMeshBoundingBox` dispatches by format and applies `Math.abs(scale)` to each axis — negative scale (mirror) produces correct positive extents.
- Object rotation is applied to bounding box as rotated AABB: `w = origW*|cos(rot)| + origD*|sin(rot)|`, `d = origW*|sin(rot)| + origD*|cos(rot)|`. This gives the tight axis-aligned bounds of the rotated footprint.
- Spacing model: `PlacedRect` stores pure object half-extents (no spacing baked in). `rectsOverlap(a, b, spacing)` checks `|dx| < hw_a + hw_b + spacing`. Start positions use `bedMin + spacing + hw` (full spacing from edge). This ensures uniform spacing everywhere: edge-to-object and object-to-object.
- Sort by area then bottom-left scan: sorted largest-first for better packing (big items first reduces fragmentation). Scan at 1mm step, Y-then-X priority. Score = `cy * 100000 + cx`. For two orientations (0° and +90°), both are scanned and the lower-scoring position wins.
- `tryRotation` only tried when `|w - d| > 1` (no benefit rotating a square).
- Overflow fallback: when no valid position found within bed, place at `bedMinX + spacing + hw, maxPlacedBottom + spacing + hd` — extends in Y direction beyond the bed. `validatePlateForSlicing` catches these for user warning.
- Prime tower reservation: when enabled, a `PlacedRect` is pre-placed at the tower position with `halfW = (width + brimWidth*2) / 2`. Objects then avoid it via normal collision detection.
- Backward-compatible signature: `autoArrangeObjects(objects, bedW, bedD, originCenter, spacing?, estimatedSize?)` still works. New `AutoArrangeOptions` object as 5th arg adds `primeTower`, `tryRotation`, `fallbackSize`.

### Lay Flat algorithm (11.2)
- Face analysis: extracts normals from vertices (not stored normals) for both STL and 3MF. Uses cross product of edge vectors, normalized.
- Normal clustering: spherical coordinates quantized to ~10° bins (`binSize = π/18`). Area-weighted average normal within each bin. Largest-area bin wins.
- Rotation: Rodrigues' formula (`v*cos + (axis×v)*sin + axis*(axis·v)*(1-cos)`) applied to every vertex and stored normal.
- Special cases: already flat (dot > 0.996, ~5°) → return null. Pointing straight up (dot < -0.996) → 180° around X.
- Z-shift: after rotation, scan all vertices for minZ, subtract from all Z coords so mesh sits on bed.
- STL: operates directly on binary DataView (84-byte header + 50 bytes/triangle). Immutable — returns new ArrayBuffer.
- 3MF: unzips via fflate, regex-replaces `<vertex x="..." y="..." z="..."/>` coordinates, re-zips. Two-pass: first rotate (tracking minZ), then shift Z.
- `layFlatMesh(data, format)` is the public API — dispatches to format-specific extract + analyze + rotate pipeline. Returns null if already flat or unparseable.
- The rotation modifies the mesh data itself (not the object's Z rotation field) — this is correct because "lay flat" is a 3D rotation (around arbitrary axis), not just Z rotation.

### Mirror and array copy (11.3)
- Mirror uses negative scale — `mirrorObject(id, 'x')` sets `scale.x = -scale.x`. Double mirror restores original. The slicer handles negative scale correctly (it inverts face normals). Three.js also renders negative scale correctly.
- Array copy skips the (0,0) grid cell since that's the original object's position. Copies use `cloneObject(source, 0)` (offset=0) then explicitly set grid positions.
- No Mirror Z in toolbar — Z mirroring is less common and could be confusing visually on the build plate. Can be done via the numeric scale input in object settings (set Z scale to negative).
- Array copy popover uses controlled state (`arrayCopyRows`, `arrayCopyCols`, `arrayCopySpacing`). The popover is positioned inline between toolbar and canvas.

### Keyboard shortcuts (12.2)
- Handler attached to `window` (not canvas container) because the canvas is a Three.js DOM element that doesn't naturally receive focus. Using `window` ensures shortcuts work regardless of where the user clicked.
- Input/textarea/select elements are excluded via `tagName` check to avoid interfering with numeric inputs in the settings panels.
- Arrow key nudge uses model-space coordinates: Left/Right = X, Up/Down = Y. Up increases Y (moves object toward back of bed in model space).
- `Ctrl+A` is captured with `preventDefault` to avoid selecting all text, but no multi-select is implemented yet — this is a no-op placeholder.
- R rotation adds 90° to the current model rotation (not snapped to nearest 90°, just increments).
- Escape has dual behavior: closes array copy popover first if open, otherwise deselects.

### Undo/redo design (12.3)
- Snapshots are lightweight (`PlateSnapshot` = `ObjectSnapshot[]` + `selectedObjectId`). `ObjectSnapshot` is `Omit<BuildPlateObject, 'meshData'>` with deep-cloned mutable fields (position, scale, printOverrides, scadParams, colorGroups).
- Mesh data is stored separately in `meshStoreRef` (Map<objectId, ArrayBuffer>), updated on every objects state change via a `useEffect`. This means undo/redo can restore full objects by looking up meshData by id.
- `pushUndo()` is called synchronously before each mutation's `setObjects`/etc calls. It captures the current `objects` and `selectedObjectId` from the hook closure.
- `undoVersion` is a dummy counter state that forces React re-render so `canUndo`/`canRedo` (derived from ref lengths) update in the UI.
- Selection state is included in snapshots, so undo restores which object was selected at the time.
- Plate-level settings (plateProfile, primeTower, printSequence, flushVolumeConfig) are NOT tracked in undo — only object state. This is intentional: settings changes are less disruptive and easier to manually redo.

### Settings override exhaustive tests (13.2)
- Parametric `it.each` tests cover every PrintProfile field by type: number fields get `val * 2 + 1` (or 42 if default is 0), boolean fields get `!default`, string fields get `'test_override_value'`.
- Fall-through tests override a DIFFERENT field and verify the target keeps its default — proves fields are independent.
- "All undefined" test creates an overrides object with every field explicitly set to `undefined` and verifies the merge returns all defaults — confirms the `val !== undefined` guard in `mergeObjectSettings`.
- Config diff tests use `buildPlateSliceConfig` end-to-end: override → `buildOrcaConfig` → `objectConfigDiff` → verify only changed keys appear. Tests cover: independent diffs per object, same field different values, same-as-plate produces no diff, non-default plate profile interactions.
- Field category tests verify specific OrcaSlicer config key names (e.g., `elefant_foot_compensation` not `elephant_foot_compensation`, `support_type` value `tree(auto)` not `tree_auto`, `print_sequence` value `by object` not `by_object`).

### BuildPlateView integration test patterns (13.3)
- `vi.stubGlobal('Worker', ...)` needed to mock the GCode preview worker — without it, the `useEffect` that creates a Worker after slicePlate resolves crashes in jsdom.
- Persistent mock pattern for useSlicer: `vi.mocked(await import(...)).useSlicer = vi.fn(() => ({...}))` replaces the mock factory so the component gets the same mock function reference each render. Must restore the default mock after each test that overrides it.
- "Slicing..." text appears in both the button and the progress label overlay — use `document.querySelector('.build-plate-btn--primary')` to target the button specifically.
- Override summary text format from `BuildPlateObjectSettings` is `"N field(s) overridden"`, not `"N overridden"`.
- `createMockPlate` must include all `UseBuildPlateResult` fields including `flushVolumeConfig`, `setFlushVolumeConfig`, `mirrorObject`, `arrayCopyObject`, `undo`, `redo`, `canUndo`, `canRedo` — TypeScript won't catch missing fields since `overrides` spread allows partial.

### Phase 13 test patterns (13.1)
- `generateId`, `generateName`, `cloneObject` exported from `useBuildPlate.ts` for direct unit testing in `src/lib/__tests__/build-plate.test.ts`. These are pure functions with no React dependencies, so they can be tested without `renderHook`.
- `generateName` uses max-number + 1 strategy (not gap-filling). Objects not matching `/^Object \d+$/` are ignored. `baseName` short-circuits when truthy (empty string is falsy, falls through to auto-naming).
- `cloneObject` does shallow spread of the top-level object + `slice(0)` for meshData + spread for overrides/params/colorGroups. This means nested objects within overrides (e.g., if a PrintProfile field were an object) would share references — but PrintProfile fields are all primitives/enums, so this is fine.

### Canvas interaction test patterns (13.4)
- Raycaster and OrbitControls instances tracked via module-level arrays (`raycasterInstances`, `orbitControlsInstances`), populated in mock constructors, cleared in `beforeEach`. This allows tests to configure mock return values and verify state changes on the actual instances.
- `setupObjectHit(id)` / `setupRotationHandleHit()` / `setupScaleHandleHit()` / `setupPrimeTowerHit()` helpers configure `intersectObjects.mockReturnValueOnce` with appropriate `userData` shape and `ray.intersectPlane.mockReturnValue(true)` for `projectToBed`.
- The mock `ray.intersectPlane` returns truthy but doesn't modify the `intersection` target parameter. `projectToBed` always returns `new THREE.Vector3()` at (0,0,0). This means bed point coordinates are always zero in tests — drag/rotate/scale operations produce the same values as original. Tests verify callback shape (correct key in transform), not exact numerical positions.
- `mockGroup().traverse` only visits self (not children), so `hitTestObjects`/`hitTestHandles`/`hitTestPrimeTower` always collect empty mesh arrays. This is fine because `intersectObjects` is fully mocked and returns configured values regardless of input.
- `HTMLElement.prototype.setPointerCapture` and `releasePointerCapture` must be mocked (jsdom may throw `NotFoundError` without active pointer events). Set as no-op `vi.fn()` at module level.
- Hover cursor tests fire `pointerMove` without prior `pointerDown` drag. Since `isDraggingRef` is false, the hover cursor logic runs: checks handles → prime tower → objects, setting `containerRef.current.style.cursor` accordingly.

### Per-object config diff test patterns (13.5)
- `configDiff()` helper in `orca-slicer-settings.test.ts` builds two full configs (base + overridden) and returns only differing key-value pairs. This tests the entire pipeline: PrintProfile field → `buildOrcaConfig()` → OrcaSlicer config key → diff.
- For conditional fields (raft, brim), use `baseOverrides` parameter to set `adhesionType` before comparing — otherwise those keys never appear in either config, making diff testing meaningless.
- Raft field config values include `%` suffix for density (`raft_first_layer_density`) but not for other raft fields — matches `buildOrcaConfig()` formatting.
- "Same as default produces no diff" tests are critical — they verify that the diff is truly empty when override matches the base, ensuring per-object configs don't unnecessarily bloat.

## Open questions
- **WASM rebuilt (2026-03-22)**: Phase 3 C++ bindings changes are now compiled into the production WASM. Output: `/nix/store/0ax5cbdi6za0hyr7dqlhkfjysyvdy42p-orcaslicer-wasm-2.3.1`, copied to `public/wasm/`. Multi-object API (clearModel, addSTLObject, add3MFObject, setObjectConfig, setPrintSequence, getObjectCount) is live.
- **Multiple useOpenSCAD instances**: For re-rendering SCAD objects on the plate, we need the OpenSCAD WASM worker. Currently there's one hook instance in App.tsx. The build plate may need its own instance, or share the existing one (serialize renders). Decision: share the existing instance, queue renders.
- **Object height for by-object mode**: Need to know object heights for collision checking. Can compute from mesh bounding box (Three.js geometry.boundingBox.max.y after Z-up→Y-up rotation). Cache per object.
- **Prime tower position persistence**: Store in plate config, pass to slicer as `wipe_tower_x` / `wipe_tower_y` printer config keys.
