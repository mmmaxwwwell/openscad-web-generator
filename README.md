# OpenSCAD Web Generator

**Try it live:** https://mmmaxwwwell.github.io/openscad-web-generator/

A browser-based parameter editor and renderer for [OpenSCAD](https://openscad.org/) files. Upload `.scad` files, tweak parameters with a GUI, preview the 3D model, and export to STL or multi-color 3MF — all running client-side via OpenSCAD compiled to WebAssembly.

## Features

- **Parameter editing** — automatically parses customizer parameters from `.scad` files and renders sliders, dropdowns, checkboxes, and text inputs
- **Parameter sets** — save and restore named parameter presets per file
- **3D preview** — live Three.js preview of rendered models
- **Export to STL** — single-color STL export
- **Multi-color 3MF export** — renders each color as a separate OpenSCAD pass and merges into a single 3MF with color groups
- **Storage backends** — files stored in browser (IndexedDB) or on S3-compatible storage
- **Fully client-side** — OpenSCAD runs as WASM in a web worker, no server required

## Writing `.scad` Files for This Tool

The app reads special comment blocks in your `.scad` file to extract parameters and parameter sets. These blocks can appear anywhere in the file but are typically placed at the top.

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
// END_PARAMS
```

**Supported types** (detected automatically from the default value):

| Type | Example | UI Control |
|------|---------|------------|
| Number | `width = 50;` | Text input |
| String | `label = "My Box";` | Text input |
| Boolean | `vents = true;` | Checkbox |
| Vector | `outer_dims = [50, 40, 30];` | Multiple number inputs |
| Enum | `shape = "circle"; // [circle, square, hexagon]` | Dropdown |

For **enum** parameters, add an inline comment with a bracketed comma-separated list of options after the assignment.

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

## Libraries

Bundles [BOSL2](https://github.com/BelfrySCAD/BOSL2) and [scadqr](https://github.com/xypwn/scadqr) so they're available via `include` in uploaded `.scad` files.

## Credits

The multi-color 3MF export technique is inspired by [colorscad](https://github.com/jschobben/colorscad) by Jesse Schobben (MIT license).

## Disclaimer

This project is entirely vibe coded. The UI looks like ass.

## Development

```bash
npm install
npm run build:wasm   # download OpenSCAD WASM artifacts
npm run dev          # start dev server
```
