# Task: Write an integration test that slices a cube and checks gcode fan commands

## Goal

Create `src/lib/__tests__/slicer-gcode-fan.integration.test.ts` — a vitest integration test that runs the full Kiri:Moto slice→prepare→export pipeline on a small cube STL and asserts that fan control gcode (`M106 S{speed}`) appears at the correct layer.

## The bug we're testing for

Fan command `M106 S255` was appearing at layer 45 of a 50-layer cube instead of layer 1 (the second physical layer). The settings-building code is correct (tested in `slicer-fan-control.test.ts`). The bug is somewhere inside the Kiri:Moto engine's export phase. This integration test should catch the regression by inspecting actual gcode output.

## Architecture constraints

The Kiri:Moto engine (`src/lib/kiri-engine.ts`) depends on web workers:

- `createSlicerEngine()` calls `client.setWorkerFactory(createWorker)` which creates a `Worker` instance
- `engine.slice()`, `engine.prepare()`, `engine.export()` all communicate via `client` (worker bridge)
- Vitest runs in Node by default — no `Worker` available
- The engine is ~1.2MB bundled JS

### Approach: vitest browser mode

Configure vitest to run this specific test file in browser mode (Chromium via playwright). This gives us real `Worker` support.

Steps:
1. Add `@vitest/browser` and `playwright` as dev dependencies if not present
2. Create a vitest workspace or use `test.browser` config to run `*.integration.test.ts` files in browser mode while keeping other tests in Node
3. The test imports `createSlicerEngine` from `../kiri-engine` which handles worker setup

Alternative: if browser mode proves too complex, create a **Node-compatible test harness** that mocks the worker by importing the worker code directly in-process. The worker entry is `vendor/kiri-engine/src/kiri/run/worker.js`. However, this is complex because the worker uses `self.onmessage` and `self.postMessage` patterns.

## Test file structure

```typescript
// src/lib/__tests__/slicer-gcode-fan.integration.test.ts
import { describe, it, expect } from 'vitest';
import { createSlicerEngine } from '../kiri-engine';
import { buildProcessSettings, buildDeviceSettings } from '../slicer-settings';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';
import type { PrinterSettings } from '../slicer-settings';

// Generate a minimal binary STL cube (8 vertices, 12 triangles)
function makeCubeSTL(size: number): ArrayBuffer { ... }

const PLA: ResolvedFilamentSettings = {
  nozzleTemp: 210, bedTemp: 60, fanSpeed: 100, firstLayerFan: 0,
  printSpeed: 50, retractDist: 4, retractSpeed: 45,
  firstLayerNozzleTemp: 210, firstLayerBedTemp: 60,
  minSpeed: 20, minLayerTime: 6,
};

const PRINTER: PrinterSettings = {
  bedWidth: 235, bedDepth: 235, maxHeight: 300, originCenter: false,
  startGcode: 'START_PRINT', endGcode: 'END_PRINT', toolChangeGcode: 'T{tool}',
};

describe('slicer gcode fan integration', () => {
  it('M106 S255 appears at layer 1 for PLA 100% fan', async () => {
    const engine = createSlicerEngine();
    const stl = makeCubeSTL(10); // 10mm cube → ~50 layers at 0.2mm
    await engine.parse(stl);

    const process = buildProcessSettings(DEFAULT_PRINT_PROFILE, PLA);
    const device = buildDeviceSettings(null, PRINTER, 1);

    engine.setProcess(process);
    engine.setDevice(device);

    await engine.slice();
    await engine.prepare();
    const gcode = await engine.export();

    // Split gcode into lines for analysis
    const lines = gcode.split(/\r?\n/);

    // Find all ;LAYER:{n} comments and M106 commands
    const layerLines: { line: number; layer: number }[] = [];
    const fanLines: { line: number; speed: number }[] = [];

    lines.forEach((l, i) => {
      const layerMatch = l.match(/^;LAYER:(\d+)/);
      if (layerMatch) layerLines.push({ line: i, layer: parseInt(layerMatch[1]) });
      const fanMatch = l.match(/^M106 S(\d+)/);
      if (fanMatch) fanLines.push({ line: i, speed: parseInt(fanMatch[1]) });
    });

    // Basic sanity: we should have layer comments
    expect(layerLines.length).toBeGreaterThan(2);

    // Find where ;LAYER:0, ;LAYER:1, ;LAYER:2 appear
    const layer0 = layerLines.find(l => l.layer === 0);
    const layer1 = layerLines.find(l => l.layer === 1);
    const layer2 = layerLines.find(l => l.layer === 2);
    expect(layer0).toBeDefined();
    expect(layer1).toBeDefined();
    expect(layer2).toBeDefined();

    // THE KEY ASSERTIONS:
    // 1. M106 S255 must exist somewhere in the gcode
    const fullFan = fanLines.find(f => f.speed === 255);
    expect(fullFan).toBeDefined();

    // 2. M106 S255 must appear AFTER ;LAYER:0 (not before any layer comment)
    expect(fullFan!.line).toBeGreaterThan(layer0!.line);

    // 3. M106 S255 must appear BEFORE ;LAYER:2 (fan turns on at layer 1)
    expect(fullFan!.line).toBeLessThan(layer2!.line);

    // 4. No M106 with speed > 0 should appear before ;LAYER:1
    //    (first layer should have fan off or at firstLayerFanSpeed=0)
    const earlyFan = fanLines.find(f => f.speed > 0 && f.line < layer1!.line);
    expect(earlyFan).toBeUndefined();

    // REGRESSION: The bug had M106 S255 appearing at layer 45.
    // If fan appears after layer 5, something is very wrong.
    expect(fullFan!.line).toBeLessThan(layer1!.line + 200); // generous bound
  }, 30_000); // 30s timeout for full slice

  it('no M106 commands for TPU 0% fan', async () => {
    const engine = createSlicerEngine();
    const stl = makeCubeSTL(5); // small cube for speed
    await engine.parse(stl);

    const tpu: ResolvedFilamentSettings = {
      ...PLA, fanSpeed: 0, firstLayerFan: 0,
    };
    engine.setProcess(buildProcessSettings(DEFAULT_PRINT_PROFILE, tpu));
    engine.setDevice(buildDeviceSettings(null, PRINTER, 1));

    await engine.slice();
    await engine.prepare();
    const gcode = await engine.export();

    // With 0% fan, M106 should either not appear or only appear as M106 S0
    const lines = gcode.split(/\r?\n/);
    const fanOn = lines.filter(l => {
      const m = l.match(/^M106 S(\d+)/);
      return m && parseInt(m[1]) > 0;
    });
    expect(fanOn).toHaveLength(0);
  }, 30_000);
});
```

## How to generate a binary STL cube

A binary STL is: 80-byte header + 4-byte uint32 triangle count + 50 bytes per triangle.
A cube has 12 triangles (2 per face). Each triangle has: 12-byte normal + 3×12-byte vertices + 2-byte attribute.

```typescript
function makeCubeSTL(size: number): ArrayBuffer {
  const s = size / 2;
  // 6 faces, 2 triangles each = 12 triangles
  const faces: [number,number,number, number,number,number, number,number,number, number,number,number][] = [
    // normal, v1, v2, v3 — right-hand winding
    // +Z top
    [0,0,1, -s,-s,s, s,-s,s, s,s,s],
    [0,0,1, -s,-s,s, s,s,s, -s,s,s],
    // -Z bottom
    [0,0,-1, -s,-s,-s, -s,s,-s, s,s,-s],
    [0,0,-1, -s,-s,-s, s,s,-s, s,-s,-s],
    // +X right
    [1,0,0, s,-s,-s, s,s,-s, s,s,s],
    [1,0,0, s,-s,-s, s,s,s, s,-s,s],
    // -X left
    [-1,0,0, -s,-s,-s, -s,-s,s, -s,s,s],
    [-1,0,0, -s,-s,-s, -s,s,s, -s,s,-s],
    // +Y front
    [0,1,0, -s,s,-s, -s,s,s, s,s,s],
    [0,1,0, -s,s,-s, s,s,s, s,s,-s],
    // -Y back
    [0,-1,0, -s,-s,-s, s,-s,-s, s,-s,s],
    [0,-1,0, -s,-s,-s, s,-s,s, -s,-s,s],
  ];

  const buf = new ArrayBuffer(80 + 4 + 12 * 50);
  const view = new DataView(buf);
  view.setUint32(80, 12, true); // triangle count
  let off = 84;
  for (const f of faces) {
    for (let i = 0; i < 12; i++) {
      view.setFloat32(off, f[i], true);
      off += 4;
    }
    view.setUint16(off, 0, true); // attribute byte count
    off += 2;
  }
  return buf;
}
```

## Vitest browser mode setup (if needed)

Add to `package.json` devDependencies:
```json
"@vitest/browser": "^4.0.18",
"playwright": "latest"
```

Option A — vitest workspace (`vitest.workspace.ts`):
```typescript
import { defineWorkspace } from 'vitest/config';
export default defineWorkspace([
  { test: { include: ['src/**/*.test.ts'], exclude: ['**/*.integration.test.ts'] } },
  {
    test: {
      include: ['src/**/*.integration.test.ts'],
      browser: { enabled: true, name: 'chromium', provider: 'playwright' },
    },
  },
]);
```

Option B — simpler: add a test script `"test:integration": "vitest run --browser.enabled --browser.name=chromium --browser.provider=playwright src/lib/__tests__/*.integration.test.ts"` and run separately.

## Key files to read

- `src/lib/kiri-engine.ts` — engine wrapper, `createSlicerEngine()`
- `src/lib/slicer-settings.ts` — `buildProcessSettings()`, `buildDeviceSettings()`
- `vendor/kiri-engine/src/kiri/run/engine.js` — Engine class (slice/prepare/export)
- `vendor/kiri-engine/src/kiri/mode/fdm/work/export.js` — gcode generation, fan logic at lines 170-184, 580-584
- `vendor/kiri-engine/src/kiri/mode/fdm/work/prepare.js` — layer output building, `.layer` numbering at line 812
- `src/lib/__tests__/slicer-fan-control.test.ts` — existing unit tests for settings builders (reference for style)

## What to investigate in the gcode output

Once you have gcode output, search for these patterns:

1. **`; DBG updateParams`** — debug lines already added in export.js showing `layer`, `fanLayer`, `fanSpeed`, `result`, `base` for layers 0-2
2. **`;LAYER:{n}`** — layer change comments, emitted by `gcodeLayer: [';LAYER:{layer}']`
3. **`M106 S{n}`** — fan speed commands, emitted when `fanSpeed !== lastFanSpeed`
4. **`; outputFanLayer =`** — in the process settings dump near the top of gcode

The debug comments will reveal whether `updateParams` sees the correct `path.layer` values. If layer 0 shows `result=0` and layer 1 shows `result=255`, the fan logic is correct. If `path.layer` jumps from 0 to 45, the prepare phase's `layerno` counting is the root cause.

## Success criteria

- Test passes: `M106 S255` appears between `;LAYER:1` and `;LAYER:2` in the gcode
- If test fails: the debug output reveals the actual `path.layer` values, pinpointing whether the bug is in prepare (layer numbering) or export (fan state machine)
