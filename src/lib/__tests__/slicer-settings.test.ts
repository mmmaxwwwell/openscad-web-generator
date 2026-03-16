// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { buildPrusaConfig, convertKlipperGcode, getModelHeightFromSTL, type PrinterSettings } from '../slicer-settings';
import { DEFAULT_PRINT_PROFILE, type PrintProfile } from '../../types/print-profile';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';

// ─── Helpers ───

const PLA_RESOLVED: ResolvedFilamentSettings = {
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

function makeFilament(overrides: Partial<ResolvedFilamentSettings> = {}): ResolvedFilamentSettings {
  return { ...PLA_RESOLVED, ...overrides };
}

const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  bedWidth: 235,
  bedDepth: 235,
  maxHeight: 300,
  originCenter: false,
  startGcode: 'START_PRINT BED_TEMP={first_layer_bed_temperature[0]} EXTRUDER_TEMP={first_layer_temperature[0]}',
  endGcode: 'END_PRINT',
  toolChangeGcode: 'T{next_extruder}',
};

// ─── buildPrusaConfig ─────────────────────────────────────

describe('buildPrusaConfig', () => {
  function build(
    profileOverrides: Partial<PrintProfile> = {},
    filamentOverrides: Partial<ResolvedFilamentSettings> = {},
    printerOverrides: Partial<PrinterSettings> = {},
    extruderCount = 1,
  ) {
    return buildPrusaConfig(
      { ...DEFAULT_PRINT_PROFILE, ...profileOverrides },
      makeFilament(filamentOverrides),
      { ...DEFAULT_PRINTER_SETTINGS, ...printerOverrides },
      null,
      extruderCount,
    );
  }

  describe('print profile settings', () => {
    it('maps layer heights', () => {
      const config = build({ layerHeight: 0.15, firstLayerHeight: 0.25 });
      expect(config['layer_height']).toBe('0.15');
      expect(config['first_layer_height']).toBe('0.25');
    });

    it('maps wall settings', () => {
      const config = build({ shellCount: 4, topLayers: 5, bottomLayers: 3 });
      expect(config['perimeters']).toBe('4');
      expect(config['top_solid_layers']).toBe('5');
      expect(config['bottom_solid_layers']).toBe('3');
    });

    it('maps shell order: out-in → external_perimeters_first=1', () => {
      expect(build({ shellOrder: 'out-in' })['external_perimeters_first']).toBe('1');
    });

    it('maps shell order: in-out → external_perimeters_first=0', () => {
      expect(build({ shellOrder: 'in-out' })['external_perimeters_first']).toBe('0');
    });

    it('maps infill density as percentage string', () => {
      expect(build({ infillDensity: 0.2 })['fill_density']).toBe('20%');
      expect(build({ infillDensity: 0.15 })['fill_density']).toBe('15%');
      expect(build({ infillDensity: 1 })['fill_density']).toBe('100%');
    });

    it('maps infill pattern and angle', () => {
      const config = build({ infillPattern: 'gyroid', infillAngle: 45 });
      expect(config['fill_pattern']).toBe('gyroid');
      expect(config['fill_angle']).toBe('45');
    });

    it('maps travel and first layer speed', () => {
      const config = build({ travelSpeed: 150, firstLayerSpeed: 25 });
      expect(config['travel_speed']).toBe('150');
      expect(config['first_layer_speed']).toBe('25');
    });

    it('maps first layer infill speed', () => {
      const config = build({ firstLayerFillSpeed: 60 });
      expect(config['first_layer_infill_speed']).toBe('60');
    });

    it('maps outer wall speed, defaults to 50% when 0', () => {
      expect(build({ outerWallSpeed: 0 })['external_perimeter_speed']).toBe('50%');
      expect(build({ outerWallSpeed: 30 })['external_perimeter_speed']).toBe('30');
    });
  });

  describe('support settings', () => {
    it('support enabled → support_material=1', () => {
      expect(build({ supportEnabled: true })['support_material']).toBe('1');
    });

    it('support disabled → support_material=0', () => {
      expect(build({ supportEnabled: false })['support_material']).toBe('0');
    });

    it('maps support angle to threshold', () => {
      expect(build({ supportAngle: 50 })['support_material_threshold']).toBe('50');
    });
  });

  describe('adhesion settings', () => {
    it('skirt adhesion sets skirts count', () => {
      const config = build({ adhesionType: 'skirt', skirtCount: 3 });
      expect(config['skirts']).toBe('3');
      expect(config['brim_width']).toBe('0');
      expect(config['raft_layers']).toBe('0');
    });

    it('brim adhesion sets brim_width', () => {
      const config = build({ adhesionType: 'brim', brimWidth: 8 });
      expect(config['skirts']).toBe('0');
      expect(config['brim_width']).toBe('8');
      expect(config['raft_layers']).toBe('0');
    });

    it('raft adhesion sets raft_layers', () => {
      const config = build({ adhesionType: 'raft' });
      expect(config['skirts']).toBe('0');
      expect(config['brim_width']).toBe('0');
      expect(config['raft_layers']).toBe('2');
    });

    it('none adhesion disables all', () => {
      const config = build({ adhesionType: 'none' });
      expect(config['skirts']).toBe('0');
      expect(config['brim_width']).toBe('0');
      expect(config['raft_layers']).toBe('0');
    });
  });

  describe('filament/temperature settings', () => {
    it('maps temperature fields', () => {
      const config = build({}, {
        nozzleTemp: 230,
        bedTemp: 80,
        firstLayerNozzleTemp: 235,
        firstLayerBedTemp: 85,
      });
      expect(config['temperature']).toBe('230');
      expect(config['bed_temperature']).toBe('80');
      expect(config['first_layer_temperature']).toBe('235');
      expect(config['first_layer_bed_temperature']).toBe('85');
    });

    it('maps fan speed directly (0-100)', () => {
      expect(build({}, { fanSpeed: 100 })['max_fan_speed']).toBe('100');
      expect(build({}, { fanSpeed: 50 })['max_fan_speed']).toBe('50');
      expect(build({}, { fanSpeed: 0 })['max_fan_speed']).toBe('0');
    });

    it('disables first layer fan when firstLayerFan=0', () => {
      expect(build({}, { firstLayerFan: 0 })['disable_fan_first_layers']).toBe('1');
    });

    it('enables first layer fan when firstLayerFan>0', () => {
      expect(build({}, { firstLayerFan: 50 })['disable_fan_first_layers']).toBe('0');
    });

    it('maps retraction settings', () => {
      const config = build({}, { retractDist: 5, retractSpeed: 50 });
      expect(config['retract_length']).toBe('5');
      expect(config['retract_speed']).toBe('50');
    });

    it('maps speed fields', () => {
      const config = build({}, { printSpeed: 60, minSpeed: 15, minLayerTime: 8 });
      expect(config['perimeter_speed']).toBe('60');
      expect(config['infill_speed']).toBe('60');
      expect(config['min_print_speed']).toBe('15');
      expect(config['slowdown_below_layer_time']).toBe('8');
    });

    it('maps derived speed sub-keys from printSpeed', () => {
      const config = build({}, { printSpeed: 80 });
      expect(config['solid_infill_speed']).toBe('80');
      expect(config['top_solid_infill_speed']).toBe('40'); // 50% of printSpeed
      expect(config['support_material_speed']).toBe('80');
      expect(config['gap_fill_speed']).toBe('80');
      expect(config['bridge_speed']).toBe('40'); // 50% of printSpeed
    });
  });

  describe('printer settings', () => {
    it('maps bed shape for non-centered origin', () => {
      const config = build({}, {}, { bedWidth: 250, bedDepth: 210, originCenter: false });
      expect(config['bed_shape']).toBe('0x0,250x0,250x210,0x210');
    });

    it('maps bed shape for centered origin', () => {
      const config = build({}, {}, { bedWidth: 200, bedDepth: 200, originCenter: true });
      expect(config['bed_shape']).toBe('-100x-100,100x-100,100x100,-100x100');
    });

    it('passes start/end gcode unchanged (PrusaSlicer-native vars)', () => {
      const config = build({}, {}, {
        startGcode: 'M109 S{first_layer_temperature[0]}',
        endGcode: 'END_PRINT',
      });
      expect(config['start_gcode']).toBe('M109 S{first_layer_temperature[0]}');
      expect(config['end_gcode']).toBe('END_PRINT');
    });

    it('maps nozzle_diameter array for multiple extruders', () => {
      const config = buildPrusaConfig(
        DEFAULT_PRINT_PROFILE, PLA_RESOLVED, DEFAULT_PRINTER_SETTINGS,
        { nozzleDiameter: 0.6, filamentDiameter: 2.85, bedCircular: false } as any, 2,
      );
      expect(config['nozzle_diameter']).toBe('0.6,0.6');
      expect(config['filament_diameter']).toBe('2.85,2.85');
    });
  });

  describe('retraction and z-hop', () => {
    it('maps z-hop height to retract_lift', () => {
      expect(build({ zHopHeight: 0.3 })['retract_lift']).toBe('0.3');
    });

    it('maps retract on layer change', () => {
      expect(build({ retractOnLayerChange: true })['retract_layer_change']).toBe('1');
      expect(build({ retractOnLayerChange: false })['retract_layer_change']).toBe('0');
    });

    it('enables wipe when wipeDistance > 0', () => {
      expect(build({ wipeDistance: 2 })['wipe']).toBe('1');
      expect(build({ wipeDistance: 0 })['wipe']).toBe('0');
    });
  });

  describe('arc fitting', () => {
    it('sets gcode_resolution when arcEnabled', () => {
      expect(build({ arcEnabled: true })['gcode_resolution']).toBe('0.0125');
    });

    it('does not set gcode_resolution when arcEnabled is false', () => {
      expect(build({ arcEnabled: false })['gcode_resolution']).toBeUndefined();
    });
  });
});

// ─── convertKlipperGcode ──────────────────────────────────

describe('convertKlipperGcode', () => {
  it('converts Klipper {tool} to PrusaSlicer [next_extruder]', () => {
    expect(convertKlipperGcode('T{tool}')).toBe('T[next_extruder]');
  });

  it('converts uppercase {TOOL}', () => {
    expect(convertKlipperGcode('T{TOOL}')).toBe('T[next_extruder]');
  });

  it('converts {tool_nr}', () => {
    expect(convertKlipperGcode('T{tool_nr}')).toBe('T[next_extruder]');
  });

  it('converts Klipper temperature variables', () => {
    expect(convertKlipperGcode('M104 S{temp}')).toBe('M104 S[first_layer_temperature]');
    expect(convertKlipperGcode('M140 S{BED_TEMP}')).toBe('M140 S[first_layer_bed_temperature]');
  });

  it('passes PrusaSlicer-native expressions through unchanged', () => {
    // PrusaSlicer expressions like {next_extruder} and {first_layer_temperature[0]}
    expect(convertKlipperGcode('T{next_extruder}')).toBe('T{next_extruder}');
    expect(convertKlipperGcode('M109 S{first_layer_temperature[0]}')).toBe('M109 S{first_layer_temperature[0]}');
  });

  it('handles multiple variables in one string', () => {
    const input = 'START_PRINT BED_TEMP={BED_TEMP} EXTRUDER_TEMP={EXTRUDER_TEMP}';
    const expected = 'START_PRINT BED_TEMP=[first_layer_bed_temperature] EXTRUDER_TEMP=[first_layer_temperature]';
    expect(convertKlipperGcode(input)).toBe(expected);
  });
});

// ─── toolchange_gcode integration ─────────────────────────

describe('buildPrusaConfig toolchange_gcode', () => {
  function buildWithToolchange(gcode: string) {
    return buildPrusaConfig(
      DEFAULT_PRINT_PROFILE,
      PLA_RESOLVED,
      { ...DEFAULT_PRINTER_SETTINGS, toolChangeGcode: gcode },
      null,
      2,
    );
  }

  it('converts T{tool} to T[next_extruder] in config', () => {
    const config = buildWithToolchange('T{tool}');
    expect(config['toolchange_gcode']).toBe('T[next_extruder]');
  });

  it('passes PrusaSlicer-native T{next_extruder} through unchanged', () => {
    const config = buildWithToolchange('T{next_extruder}');
    expect(config['toolchange_gcode']).toBe('T{next_extruder}');
  });

  it('does not set toolchange_gcode when empty', () => {
    const config = buildWithToolchange('');
    expect(config['toolchange_gcode']).toBeUndefined();
  });
});

// ─── getModelHeightFromSTL ────────────────────────────────

describe('getModelHeightFromSTL', () => {
  function makeBinarySTL(triangles: { vertices: [number, number, number][] }[]): ArrayBuffer {
    const numTriangles = triangles.length;
    const buf = new ArrayBuffer(84 + numTriangles * 50);
    const view = new DataView(buf);
    view.setUint32(80, numTriangles, true);
    for (let i = 0; i < numTriangles; i++) {
      const base = 84 + i * 50;
      for (let v = 0; v < 3; v++) {
        const verts = triangles[i].vertices[v];
        view.setFloat32(base + 12 + v * 12, verts[0], true);
        view.setFloat32(base + 12 + v * 12 + 4, verts[1], true);
        view.setFloat32(base + 12 + v * 12 + 8, verts[2], true);
      }
    }
    return buf;
  }

  it('returns max Z from triangles', () => {
    const stl = makeBinarySTL([
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 5]] },
      { vertices: [[0, 0, 0], [1, 0, 10], [0, 1, 3]] },
    ]);
    expect(getModelHeightFromSTL(stl)).toBe(10);
  });

  it('returns 0 for too-small buffer', () => {
    expect(getModelHeightFromSTL(new ArrayBuffer(10))).toBe(0);
  });

  it('returns 0 for truncated buffer', () => {
    const buf = new ArrayBuffer(84);
    const view = new DataView(buf);
    view.setUint32(80, 100, true);
    expect(getModelHeightFromSTL(buf)).toBe(0);
  });
});
