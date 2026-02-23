# Agent Prompt — OpenSCAD Web Parameter Editor

## Your Role
You are building a single-page web application that lets users load OpenSCAD `.scad` files, edit parameters via a form UI, preview models from multiple viewpoints, and export STL/3MF — all in the browser using OpenSCAD compiled to WebAssembly.

## Before You Begin
1. Read `AGENT_INSTRUCTIONS.md` for the full architecture and conventions.
2. Read `TASKLIST.md` for current progress and what to work on next.
3. Copy this file to `PROMPT_RUN_N.md` and `TASKLIST.md` to `TASKLIST_RUN_N.md` (increment N from the highest existing run number). Work from your copies. Update the originals when you finish.
4. Pick the **next uncompleted task** from the task list. If all tasks in the current phase are done, move to the next phase.

## Constraints
- Use TypeScript + React + Vite.
- Use Node.js scripts for build orchestration (no shell scripts).
- Use Nix flakes for reproducible builds producing a static site.
- Download pre-built OpenSCAD WASM at build time — do not compile from source.
- Run OpenSCAD WASM in a Web Worker, never on the main thread.
- Parse `.scad` files only for the structured sections (BEGIN_PARAMS/END_PARAMS, BEGIN_PARAM_SETS/END_PARAM_SETS, BEGIN_VIEWPOINTS/END_VIEWPOINTS). Do not write a general OpenSCAD parser.
- Support both IndexedDB (browser) and S3-compatible storage for loading/saving scad files.
- Support saving/loading custom parameter sets per file to browser storage (IndexedDB).
- Keep each task small — touch at most 2-3 files, ~100 lines per task.

## Current Phase
**Phase 4: OpenSCAD WASM Integration**

Phases 1 (scaffolding), 2 (scad file parser), and 3 (storage layer) are complete. Focus on creating the Web Worker for OpenSCAD WASM, the main-thread API, the React hook, and parameter injection.

## What Success Looks Like
When all phases are complete:
- `nix build` produces a `dist/` directory containing a fully functional static SPA
- The app loads scad files from IndexedDB or S3
- Parameters are parsed and displayed in a form with help text
- Default parameter sets from the file can be selected
- Custom parameter sets can be saved/loaded per file
- Multi-viewpoint preview works via OpenSCAD WASM
- STL and 3MF export works
- The entire app runs client-side (except optional S3 access)

## Tips for Effective Runs
- Start by reading the task list to understand what's already been done.
- Don't repeat work. If a file exists and looks correct, move on.
- If you discover something important (a gotcha, a decision, a URL), write it into your `TASKLIST_RUN_N.md` so the next run benefits.
- If a task is too large, split it and update the task list.
- Verify your work compiles/runs before marking a task done.
- When you finish, update `PROMPT.md` to reflect the new current phase and `TASKLIST.md` to reflect completed tasks and any new tasks discovered.
