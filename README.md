# OpenSCAD Web Generator

**Try it live:** https://mmmaxwwwell.github.io/openscad-web-generator/

A browser-based parameter editor and renderer for [OpenSCAD](https://openscad.org/) files. Upload `.scad` files, tweak parameters with a GUI, preview the 3D model, and export to STL or multi-color 3MF — all running client-side via OpenSCAD compiled to WebAssembly.

## Features

- **Parameter editing** — automatically parses customizer parameters from `.scad` files and renders sliders, dropdowns, checkboxes, and text inputs
- **Parameter sets** — save and restore named parameter presets per file
- **3D preview** — live Three.js preview of rendered models
- **Export to STL / 3MF / Multi-Color 3MF** — each format is independently cached with its own render and download buttons
- **Render cache** — rendered models are cached in IndexedDB so you can download any previously rendered format without re-rendering
- **Shareable URLs** — the current file and parameter values are synced to the URL, so you can share direct links like `?example=sign.scad&height=30`
- **File descriptions** — `.scad` files can include a `BEGIN_DESCRIPTION` block that is displayed on the editor page
- **Storage backends** — files stored in browser (IndexedDB) or on S3-compatible storage
- **Fully client-side** — OpenSCAD runs as WASM in a web worker, no server required

## Writing `.scad` Files for This Tool

The app reads special comment blocks in your `.scad` file to extract parameters and parameter sets. These blocks can appear anywhere in the file but are typically placed at the top.

### Description

Add a description block to your file to display a summary on the editor page:

```scad
// BEGIN_DESCRIPTION
// A protective case for the Fi Mini GPS tracker.
// Held together by 6 M3x6 SHCS (socket head cap screws).
// END_DESCRIPTION
```

Lines are stripped of leading `//` and displayed as a styled callout below the file title.

### Parameters

Wrap parameter definitions between `// BEGIN_PARAMS` and `// END_PARAMS`. Each parameter is a standard OpenSCAD variable assignment. Separate parameters with **two or more blank lines**. Comment lines immediately above a parameter become its help text in the UI.

```scad
// BEGIN_PARAMS
// The overall width of the box in mm.
// Must be at least 10mm for structural integrity.
width = 50;


// Wall thickness in mm.
wall = 2;


// Text to emboss on the front face.
label = "My Box";


// Whether to add ventilation holes.
vents = true;


// Shape of ventilation holes.
vent_shape = "circle"; // [circle, square, hexagon]


// Outer dimensions as [x, y, z].
outer_dims = [50, 40, 30];


// Multiline text for a QR code or label. // multiline
// Supports multiple lines of input.
info_text = "";
// END_PARAMS
```

**Supported types** (detected automatically from the default value):

| Type | Example | UI Control |
|------|---------|------------|
| Number | `width = 50;` | Text input |
| String | `label = "My Box";` | Text input |
| Multiline text | `info = ""; // multiline` | Textarea |
| Boolean | `vents = true;` | Checkbox |
| Vector | `outer_dims = [50, 40, 30];` | Multiple number inputs |
| Enum | `shape = "circle"; // [circle, square, hexagon]` | Dropdown |

For **enum** parameters, add an inline comment with a bracketed comma-separated list of options after the assignment.

For **multiline text** parameters, add `// multiline` at the end of the first help comment line. This renders a textarea in the UI instead of a single-line text input. Newlines are encoded as `\n` in the OpenSCAD string.

### Parameter Sets

Define named presets between `// BEGIN_PARAM_SETS` and `// END_PARAM_SETS`. Each set starts with `// set: Name` followed by `// key = value` lines. Separate sets with a blank line. A set only needs to include the parameters it overrides.

```scad
// BEGIN_PARAM_SETS
// set: Thin Walls
// wall = 1.2
// label = "Thin"

// set: Thick & Solid
// wall = 4
// vents = false
// label = "Solid"

// set: Large Hex Vents
// width = 100
// depth = 80
// vent_shape = "hexagon"
// END_PARAM_SETS
```

These appear as buttons in the sidebar. Users can also save their own custom presets from the UI.

### Shareable URLs

The app syncs state to URL search parameters so you can share direct links:

- `?example=sign.scad` — load a bundled example
- `?example=sign.scad&text=Hello&height=30` — load with parameter overrides
- `?file=myfile.scad` — load a file from the user's browser storage
- [`?example=fi_mini_case.scad&qr_code_text=https://www.youtube.com/watch?v=dQw4w9WgXcQ`](https://mmmaxwwwell.github.io/openscad-web-generator/?example=fi_mini_case.scad&qr_code_text=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ) — Fi Mini case with a QR code

Only parameters that differ from their defaults are included in the URL. Parameter values are type-checked against the file's parameter definitions (numbers, booleans, vectors, enums).

### Colors and Multi-Color 3MF Export

Use standard OpenSCAD `color()` calls in your model. When you export as **Multi-Color 3MF**, the app automatically discovers all colors in your file, renders each color as a separate pass, and merges them into a single 3MF with color groups — ready for multi-material slicers like Bambu Studio, OrcaSlicer, or PrusaSlicer.

```scad
color("red")
    cube([20, 10, 5]);

color("blue")
    translate([0, 0, 5])
        cube([20, 10, 5]);

color([0.2, 0.8, 0.2])  // RGB array (0-1)
    translate([0, 0, 10])
        cube([20, 10, 5]);
```

Supported color formats:
- **Named CSS colors** — `"red"`, `"cyan"`, `"tomato"`, `"darkgreen"`, etc.
- **RGB/RGBA arrays** — `[r, g, b]` or `[r, g, b, a]` with values from 0 to 1
- **Hex strings** — `"#FF0000"`

Three export options are available:
- **STL** — single color mesh
- **3MF** — single color wrapped in 3MF container
- **Multi-Color 3MF** — one mesh per color, with color group metadata for slicers

## Send to Printer (Klipper / Moonraker)

If you're running [Klipper](https://www.klipper3d.org/) with [Moonraker](https://moonraker.readthedocs.io/), you can send exported files directly to your printer from the app. Add your printer's address in the Printer Settings panel and use the "Send to Printer" button after exporting.

Because the web app is served over HTTPS, browsers block requests to HTTP printer addresses on the local network (mixed content). To work around this, install the **Android APK** from the [Releases](https://github.com/mmmaxwwwell/openscad-web-generator/releases) page — it wraps the web app in a WebView that allows cleartext HTTP traffic to your printers.

## Libraries

Bundles [BOSL2](https://github.com/BelfrySCAD/BOSL2) and [scadqr](https://github.com/xypwn/scadqr) so they're available via `include` in uploaded `.scad` files.

## Credits

The multi-color 3MF export technique is inspired by [colorscad](https://github.com/jschobben/colorscad) by Jesse Schobben (MIT license).

## Disclaimer

This project is entirely vibe coded. The UI looks like ass.

## Android APK

An Android wrapper app is included that loads the web app in a WebView with cleartext HTTP enabled, allowing direct communication with Moonraker printers on your local network.

### Building locally

```bash
npm run apk            # build debug APK
npm run apk:install    # build and install to connected device via ADB
```

Requires `gradle`, `jdk17`, and `android-tools` — all included in the Nix dev shell.

### Releases

The GitHub Actions workflow at `.github/workflows/android-release.yml` automatically builds a signed APK and creates a GitHub Release when you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Tags must match the format `vX.X.X` (e.g., `v1.0.0`, `v2.3.1`).

To enable APK signing in CI, add these repository secrets:

- `ANDROID_SIGNING_KEY` — base64-encoded keystore (`base64 -w 0 release.keystore`)
- `ANDROID_KEY_ALIAS` — key alias
- `ANDROID_KEYSTORE_PASSWORD` — keystore password
- `ANDROID_KEY_PASSWORD` — key password

## Development

```bash
npm install
npm run build:wasm   # download OpenSCAD WASM artifacts
npm run dev          # start dev server
```
