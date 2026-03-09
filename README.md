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

## Libraries

Bundles [BOSL2](https://github.com/BelfrySCAD/BOSL2) and [scadqr](https://github.com/xypwn/scadqr) so they're available via `include` in uploaded `.scad` files.

## Disclaimer

This project is entirely vibe coded. The UI looks like ass.

## Development

```bash
npm install
npm run build:wasm   # download OpenSCAD WASM artifacts
npm run dev          # start dev server
```
