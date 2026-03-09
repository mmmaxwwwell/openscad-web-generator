# Multi-Color 3MF Implementation Notes

## Architecture
- Pipeline: scad → CSG (resolves named colors) → discover colors → render per color → merge 3MF
- Each step needs fresh WASM instance (OpenSCAD calls exit())
- Worker handles orchestration via `render-multicolor` request type

## Key Files
- `src/lib/merge-3mf.ts` — Pure TS 3MF merger using fflate for ZIP
- `src/lib/openscad-worker.ts` — Worker with `runOpenSCAD()`, `discoverColors()`, `renderSingleColor()`
- `src/lib/openscad-api.ts` — `renderMulticolor()` method
- `src/hooks/useOpenSCAD.ts` — `renderMulticolor()` hook method
- `src/components/ExportControls.tsx` — "Export Multi-Color 3MF" button

## 3MF Format Notes
- 3MF = ZIP of XML files
- Must use unprefixed `<colorgroup>` / `<color>` elements (no `m:` namespace prefix)
  - Three.js ThreeMFLoader uses `querySelectorAll('colorgroup')` which doesn't match namespaced elements
- Object-level `pid` and `pindex` attributes assign colors to whole meshes
- Linear-to-sRGB conversion required for color values (OpenSCAD uses linear RGB, 3MF uses sRGB)
- Slicer metadata in `Metadata/model_settings.config` for Bambu Studio/OrcaSlicer part naming

## Color Discovery Technique (from colorscad)
- Redefine `color()` module: `-D "module color(c) {echo(colorid=str(c));}"`
- Parse ECHO output from stderr for unique color values
- Uses unique tag per discovery to avoid collisions

## Per-Color Rendering Technique (from colorscad)
- Redefine `color()` to filter: `$colored = false; module color(c) { if ($colored) {children();} else {$colored = true; if (str(c) == "[r,g,b,a]") children();} }`
- The `$colored` variable ensures nested color() calls pass through
