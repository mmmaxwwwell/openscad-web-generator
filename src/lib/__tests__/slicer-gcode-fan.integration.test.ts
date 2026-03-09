import { describe, it, expect } from 'vitest';
import { createSlicerEngine } from '../kiri-engine';
import { buildProcessSettings, buildDeviceSettings } from '../slicer-settings';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';
import type { PrinterSettings } from '../slicer-settings';

/**
 * Generate a minimal binary STL cube (8 vertices, 12 triangles).
 */
function makeCubeSTL(size: number): ArrayBuffer {
  const s = size / 2;
  // 6 faces, 2 triangles each = 12 triangles
  // Each entry: normal(3), v1(3), v2(3), v3(3)
  const faces: [number,number,number, number,number,number, number,number,number, number,number,number][] = [
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

const PLA: ResolvedFilamentSettings = {
  nozzleTemp: 210,
  bedTemp: 60,
  fanSpeed: 100,
  firstLayerFan: 0,
  printSpeed: 50,
  retractDist: 4,
  retractSpeed: 45,
  firstLayerNozzleTemp: 210,
  firstLayerBedTemp: 60,
  minSpeed: 20,
  minLayerTime: 6,
};

const PRINTER: PrinterSettings = {
  bedWidth: 235,
  bedDepth: 235,
  maxHeight: 300,
  originCenter: false,
  startGcode: 'START_PRINT',
  endGcode: 'END_PRINT',
  toolChangeGcode: 'T{tool}',
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

    // REGRESSION: The bug had M106 S255 appearing at layer 45 due to bridge detection.
    // If fan appears after layer 5, something is very wrong.
    expect(fullFan!.line).toBeLessThan(layer1!.line + 200); // generous bound
  }, 30_000);

  it('no M106 commands for TPU 0% fan', async () => {
    const engine = createSlicerEngine();
    const stl = makeCubeSTL(5); // small cube for speed
    await engine.parse(stl);

    const tpu: ResolvedFilamentSettings = {
      ...PLA,
      fanSpeed: 0,
      firstLayerFan: 0,
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
