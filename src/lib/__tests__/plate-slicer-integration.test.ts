// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Integration tests for plate slicing pipeline.
 *
 * Tests the full config generation path from BuildPlate through
 * buildPlateSliceConfig → OrcaSlicer config, including per-object
 * overrides, multicolor, prime tower, flush volumes, and print sequence.
 *
 * These tests do NOT call the WASM slicer — they verify that the
 * generated PlateSliceJob is correct for the slicer worker to consume.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPlateSliceConfig,
  validatePlateForSlicing,
} from '../plate-slicer';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';
import type {
  BuildPlate,
  BuildPlateObject,
  FlushVolumeConfig,
} from '../../types/build-plate';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';
import type { PrinterSettings } from '../slicer-settings';

// ─── Fixtures ─────────────────────────────────────────────

const FILAMENT: ResolvedFilamentSettings = {
  nozzleTemp: 210,
  bedTemp: 60,
  fanSpeed: 100,
  firstLayerFan: 0,
  printSpeed: 50,
  retractDist: 0.8,
  retractSpeed: 30,
  deretractionSpeed: 0,
  firstLayerNozzleTemp: 215,
  firstLayerBedTemp: 65,
  minSpeed: 20,
  minLayerTime: 6,
  flowRatio: 1.0,
  enablePressureAdvance: false,
  pressureAdvance: 0.04,
  adaptivePressureAdvance: false,
  overhangFanSpeed: 100,
  overhangFanThreshold: 0,
  enableOverhangBridgeFan: true,
  closeFanFirstLayers: 1,
  fanCoolingLayerTime: 60,
  slowDownLayerTime: 4,
  fanMaxSpeed: 100,
  coolPlateTemp: 55,
  coolPlateTempInitialLayer: 60,
  engPlateTemp: 80,
  engPlateTempInitialLayer: 85,
  texturedPlateTemp: 65,
  texturedPlateTempInitialLayer: 70,
};

const PRINTER: PrinterSettings = {
  bedWidth: 235,
  bedDepth: 235,
  maxHeight: 250,
  originCenter: false,
  startGcode: '',
  endGcode: '',
  toolChangeGcode: '',
  printableArea: [],
  bedExcludeAreas: [],
  printerStructureType: 'i3',
  nozzleType: 'brass',
  nozzleHRC: 0,
  auxiliaryFan: false,
  chamberTempControl: false,
  maxVolumetricSpeed: 0,
};

function makeObj(overrides: Partial<BuildPlateObject> = {}): BuildPlateObject {
  return {
    id: overrides.id ?? 'obj-1',
    name: overrides.name ?? 'Object',
    type: overrides.type ?? 'stl',
    meshData: overrides.meshData ?? new ArrayBuffer(100),
    meshFormat: overrides.meshFormat ?? 'stl',
    position: overrides.position ?? { x: 100, y: 100 },
    rotation: overrides.rotation ?? 0,
    scale: overrides.scale ?? { x: 1, y: 1, z: 1 },
    ...overrides,
  };
}

function makePlate(overrides: Partial<BuildPlate> = {}): BuildPlate {
  return {
    objects: overrides.objects ?? [makeObj()],
    plateProfile: overrides.plateProfile ?? { ...DEFAULT_PRINT_PROFILE },
    primeTower: overrides.primeTower ?? {
      enabled: false,
      position: { x: 200, y: 200 },
      width: 60,
      brimWidth: 3,
    },
    printSequence: overrides.printSequence ?? 'by_layer',
    bedWidth: overrides.bedWidth ?? 235,
    bedDepth: overrides.bedDepth ?? 235,
    maxHeight: overrides.maxHeight ?? 250,
    originCenter: overrides.originCenter ?? false,
    ...overrides,
  };
}

// ─── Single STL object → valid config ───────────────────

describe('single STL object pipeline', () => {
  it('produces a valid PlateSliceJob with correct transform', () => {
    const plate = makePlate({
      objects: [makeObj({
        id: 'cube',
        position: { x: 117, y: 117 },
        rotation: 30,
        scale: { x: 1.5, y: 1.5, z: 2.0 },
      })],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);

    expect(job.objects).toHaveLength(1);
    const obj = job.objects[0];
    expect(obj.format).toBe('stl');
    expect(obj.posX).toBe(117);
    expect(obj.posY).toBe(117);
    expect(obj.rotZ).toBe(30);
    expect(obj.scaleX).toBe(1.5);
    expect(obj.scaleY).toBe(1.5);
    expect(obj.scaleZ).toBe(2.0);
    expect(obj.config).toBeUndefined();
  });

  it('global config contains expected slicer keys', () => {
    const plate = makePlate();
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);

    // Spot-check a few critical config keys
    expect(job.globalConfig['layer_height']).toBeDefined();
    expect(job.globalConfig['wall_loops']).toBeDefined();
    expect(job.globalConfig['sparse_infill_density']).toBeDefined();
    expect(job.globalConfig['nozzle_temperature']).toBeDefined();
    expect(job.globalConfig['hot_plate_temp']).toBeDefined();
    expect(job.globalConfig['print_sequence']).toBe('by layer');
  });

  it('meshData reference is passed through (not copied)', () => {
    const buf = new ArrayBuffer(256);
    const plate = makePlate({ objects: [makeObj({ meshData: buf })] });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);
    expect(job.objects[0].data).toBe(buf);
  });
});

// ─── Two STL objects with different positions ───────────

describe('two STL objects with different positions', () => {
  it('each object has its own position in the job', () => {
    const plate = makePlate({
      objects: [
        makeObj({ id: 'a', position: { x: 50, y: 50 }, rotation: 0 }),
        makeObj({ id: 'b', position: { x: 180, y: 180 }, rotation: 90 }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);

    expect(job.objects).toHaveLength(2);
    expect(job.objects[0].posX).toBe(50);
    expect(job.objects[0].posY).toBe(50);
    expect(job.objects[0].rotZ).toBe(0);
    expect(job.objects[1].posX).toBe(180);
    expect(job.objects[1].posY).toBe(180);
    expect(job.objects[1].rotZ).toBe(90);
  });

  it('both share the same global config', () => {
    const plate = makePlate({
      objects: [
        makeObj({ id: 'a', position: { x: 50, y: 50 } }),
        makeObj({ id: 'b', position: { x: 180, y: 180 } }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);

    // Neither has per-object overrides
    expect(job.objects[0].config).toBeUndefined();
    expect(job.objects[1].config).toBeUndefined();
    // Global config is a single shared object
    expect(job.globalConfig).toBeDefined();
    expect(Object.keys(job.globalConfig).length).toBeGreaterThan(10);
  });
});

// ─── Object with print overrides ────────────────────────

describe('object with print overrides', () => {
  it('per-object config diff contains overridden keys only', () => {
    const plate = makePlate({
      objects: [
        makeObj({
          id: 'overridden',
          printOverrides: {
            wallLoops: 6,
            sparseInfillDensity: 80,
            layerHeight: 0.1,
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);

    const cfg = job.objects[0].config;
    expect(cfg).toBeDefined();
    expect(cfg!['wall_loops']).toBe('6');
    expect(cfg!['sparse_infill_density']).toBe('80%');
    expect(cfg!['layer_height']).toBe('0.1');
  });

  it('non-overridden keys are NOT in the per-object config', () => {
    const plate = makePlate({
      objects: [
        makeObj({
          printOverrides: { wallLoops: 6 },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);
    const cfg = job.objects[0].config!;

    // wall_loops should be there (it differs)
    expect(cfg['wall_loops']).toBe('6');
    // Other keys should NOT be in the per-object diff
    expect(cfg['sparse_infill_density']).toBeUndefined();
    expect(cfg['layer_height']).toBeUndefined();
  });

  it('one object overridden, another default — only first has config', () => {
    const plate = makePlate({
      objects: [
        makeObj({ id: 'a', printOverrides: { supportEnabled: true } }),
        makeObj({ id: 'b' }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);

    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['enable_support']).toBe('1');
    expect(job.objects[1].config).toBeUndefined();
  });

  it('override with plate-default value produces no diff', () => {
    const plate = makePlate({
      objects: [
        makeObj({
          printOverrides: {
            wallLoops: DEFAULT_PRINT_PROFILE.wallLoops,
            layerHeight: DEFAULT_PRINT_PROFILE.layerHeight,
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);
    expect(job.objects[0].config).toBeUndefined();
  });
});

// ─── Multicolor 3MF + STL on same plate ─────────────────

describe('multicolor 3MF + STL on same plate', () => {
  it('3MF object uses 3mf format, STL uses stl', () => {
    const plate = makePlate({
      objects: [
        makeObj({
          id: 'multi',
          type: '3mf',
          meshFormat: '3mf',
          colorGroups: [
            { color: '#FF0000', name: 'Red' },
            { color: '#00FF00', name: 'Green' },
          ],
          position: { x: 60, y: 60 },
        }),
        makeObj({
          id: 'single',
          type: 'stl',
          meshFormat: 'stl',
          position: { x: 170, y: 170 },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 2);

    expect(job.objects[0].format).toBe('3mf');
    expect(job.objects[1].format).toBe('stl');
  });

  it('extruder count affects global config (multi-extruder nozzle temp)', () => {
    const plate = makePlate({
      objects: [
        makeObj({
          id: 'multi',
          type: '3mf',
          meshFormat: '3mf',
          colorGroups: [{ color: '#FF0000' }, { color: '#0000FF' }],
        }),
        makeObj({ id: 'single' }),
      ],
    });
    // With 2 extruders, global config should have multi-extruder nozzle temps
    const job2 = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 2);
    const nozzleTemp2 = job2.globalConfig['nozzle_temperature'];
    // Should be comma-separated for 2 extruders
    expect(nozzleTemp2).toContain(',');

    // With 1 extruder, single value
    const job1 = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);
    const nozzleTemp1 = job1.globalConfig['nozzle_temperature'];
    expect(nozzleTemp1).not.toContain(',');
  });
});

// ─── Prime tower config ─────────────────────────────────

describe('prime tower config in global config', () => {
  it('prime tower enabled passes through to global config', () => {
    const plateProfile: PrintProfile = {
      ...DEFAULT_PRINT_PROFILE,
      enablePrimeTower: true,
      primeTowerWidth: 40,
      primeTowerBrimWidth: 5,
    };
    const plate = makePlate({
      plateProfile,
      primeTower: { enabled: true, position: { x: 180, y: 180 }, width: 40, brimWidth: 5 },
      objects: [
        makeObj({ id: 'a' }),
        makeObj({ id: 'b' }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 2);

    expect(job.globalConfig['enable_prime_tower']).toBe('1');
    expect(job.globalConfig['prime_tower_width']).toBe('40');
    expect(job.globalConfig['prime_tower_brim_width']).toBe('5');
  });

  it('prime tower disabled passes through to global config (multi-extruder)', () => {
    const plateProfile: PrintProfile = {
      ...DEFAULT_PRINT_PROFILE,
      enablePrimeTower: false,
    };
    const plate = makePlate({
      plateProfile,
      primeTower: { enabled: false, position: { x: 200, y: 200 }, width: 60, brimWidth: 3 },
    });
    // Prime tower keys only emitted with extruderCount > 1
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 2);

    expect(job.globalConfig['enable_prime_tower']).toBe('0');
  });

  it('prime tower keys not emitted for single extruder', () => {
    const plateProfile: PrintProfile = {
      ...DEFAULT_PRINT_PROFILE,
      enablePrimeTower: true,
    };
    const plate = makePlate({ plateProfile });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);

    // Multi-material block (including prime tower) is skipped for 1 extruder
    expect(job.globalConfig['enable_prime_tower']).toBeUndefined();
  });
});

// ─── Flush volume matrix override ───────────────────────

describe('flush volume matrix override', () => {
  it('custom flush volume matrix overrides global config', () => {
    const fvc: FlushVolumeConfig = {
      matrix: [0, 200, 300, 0],
      multiplier: 1.0,
      extruderCount: 2,
    };
    const plate = makePlate({
      flushVolumeConfig: fvc,
      objects: [
        makeObj({ id: 'a', colorGroups: [{ color: '#F00' }, { color: '#0F0' }] }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 2);

    expect(job.globalConfig['flush_volumes_matrix']).toBe('0,200,300,0');
  });

  it('multiplier scales matrix values', () => {
    const fvc: FlushVolumeConfig = {
      matrix: [0, 200, 300, 0],
      multiplier: 1.5,
      extruderCount: 2,
    };
    const plate = makePlate({
      flushVolumeConfig: fvc,
      objects: [makeObj({ id: 'a' })],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 2);

    // 0*1.5=0, 200*1.5=300, 300*1.5=450, 0*1.5=0
    // Diagonal entries forced to 0 regardless of multiplier
    expect(job.globalConfig['flush_volumes_matrix']).toBe('0,300,450,0');
  });

  it('no flush volume override when config is undefined', () => {
    const plate = makePlate({
      flushVolumeConfig: undefined,
      objects: [makeObj({ id: 'a' })],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 2);

    // Should still have flush_volumes_matrix from the default buildOrcaConfig path
    expect(job.globalConfig['flush_volumes_matrix']).toBeDefined();
  });

  it('no flush volume override for single extruder', () => {
    const fvc: FlushVolumeConfig = {
      matrix: [0, 200, 300, 0],
      multiplier: 1.0,
      extruderCount: 2,
    };
    const plate = makePlate({
      flushVolumeConfig: fvc,
      objects: [makeObj({ id: 'a' })],
    });
    // extruderCount = 1 → flush override not applied, and multi-material
    // block is skipped entirely so flush_volumes_matrix is not emitted
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);

    expect(job.globalConfig['flush_volumes_matrix']).toBeUndefined();
  });
});

// ─── Print sequence modes ───────────────────────────────

describe('print sequence modes', () => {
  it('by_layer mode sets print_sequence to "by layer"', () => {
    const plate = makePlate({ printSequence: 'by_layer' });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);
    expect(job.printSequence).toBe('by_layer');
    expect(job.globalConfig['print_sequence']).toBe('by layer');
  });

  it('by_object mode sets print_sequence to "by object"', () => {
    const plate = makePlate({
      printSequence: 'by_object',
      plateProfile: { ...DEFAULT_PRINT_PROFILE, printSequence: 'by_object' },
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);
    expect(job.printSequence).toBe('by_object');
    expect(job.globalConfig['print_sequence']).toBe('by object');
  });

  it('by_object with per-object override still has correct global config', () => {
    const plate = makePlate({
      printSequence: 'by_object',
      plateProfile: { ...DEFAULT_PRINT_PROFILE, printSequence: 'by_object' },
      objects: [
        makeObj({ id: 'a', printOverrides: { wallLoops: 8 } }),
        makeObj({ id: 'b' }),
      ],
    });
    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 1);

    expect(job.globalConfig['print_sequence']).toBe('by object');
    expect(job.objects[0].config!['wall_loops']).toBe('8');
    expect(job.objects[1].config).toBeUndefined();
  });
});

// ─── Validation catches out-of-bounds objects ───────────

describe('validation integration', () => {
  it('valid plate with two objects passes validation', () => {
    const plate = makePlate({
      objects: [
        makeObj({ id: 'a', position: { x: 50, y: 50 } }),
        makeObj({ id: 'b', position: { x: 180, y: 180 } }),
      ],
    });
    expect(validatePlateForSlicing(plate)).toHaveLength(0);
  });

  it('object at negative X fails for non-center-origin bed', () => {
    const plate = makePlate({
      originCenter: false,
      objects: [makeObj({ name: 'Bad', position: { x: -5, y: 100 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Bad');
    expect(errors[0]).toContain('X axis');
  });

  it('object beyond bed width fails', () => {
    const plate = makePlate({
      bedWidth: 235,
      objects: [makeObj({ name: 'Wide', position: { x: 240, y: 100 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Wide');
  });

  it('center-origin object within bounds passes', () => {
    const plate = makePlate({
      bedWidth: 200,
      bedDepth: 200,
      originCenter: true,
      objects: [
        makeObj({ id: 'a', position: { x: -90, y: -90 } }),
        makeObj({ id: 'b', position: { x: 90, y: 90 } }),
      ],
    });
    expect(validatePlateForSlicing(plate)).toHaveLength(0);
  });

  it('center-origin object outside bounds fails', () => {
    const plate = makePlate({
      bedWidth: 200,
      bedDepth: 200,
      originCenter: true,
      objects: [makeObj({ name: 'OOB', position: { x: 110, y: 0 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('by-object overlapping positions warns', () => {
    const plate = makePlate({
      printSequence: 'by_object',
      objects: [
        makeObj({ id: 'a', position: { x: 100, y: 100 } }),
        makeObj({ id: 'b', position: { x: 100, y: 100 } }),
      ],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.some(e => /by.object/i.test(e))).toBe(true);
  });

  it('empty plate fails validation', () => {
    const plate = makePlate({ objects: [] });
    const errors = validatePlateForSlicing(plate);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no objects/i);
  });
});

// ─── End-to-end: complex plate scenario ─────────────────

describe('complex plate end-to-end', () => {
  it('3 objects, mixed overrides, by_object, prime tower enabled', () => {
    const plateProfile: PrintProfile = {
      ...DEFAULT_PRINT_PROFILE,
      wallLoops: 3,
      sparseInfillDensity: 20,
      enablePrimeTower: true,
      primeTowerWidth: 50,
      printSequence: 'by_object',
    };

    const plate = makePlate({
      plateProfile,
      printSequence: 'by_object',
      primeTower: { enabled: true, position: { x: 200, y: 200 }, width: 50, brimWidth: 3 },
      objects: [
        makeObj({
          id: 'box',
          type: 'stl',
          meshFormat: 'stl',
          position: { x: 40, y: 40 },
          rotation: 0,
          scale: { x: 1, y: 1, z: 1 },
        }),
        makeObj({
          id: 'vase',
          type: 'stl',
          meshFormat: 'stl',
          position: { x: 150, y: 40 },
          rotation: 45,
          scale: { x: 0.8, y: 0.8, z: 0.8 },
          printOverrides: {
            wallLoops: 1,
            sparseInfillDensity: 0,
            spiralMode: true,
          },
        }),
        makeObj({
          id: 'holder',
          type: '3mf',
          meshFormat: '3mf',
          position: { x: 100, y: 170 },
          colorGroups: [{ color: '#000' }, { color: '#FFF' }],
          printOverrides: {
            supportEnabled: true,
            supportThresholdAngle: 30,
          },
        }),
      ],
    });

    const job = buildPlateSliceConfig(plate, FILAMENT, PRINTER, null, 2);

    // Structural checks
    expect(job.objects).toHaveLength(3);
    expect(job.printSequence).toBe('by_object');
    expect(job.globalConfig['print_sequence']).toBe('by object');
    expect(job.globalConfig['enable_prime_tower']).toBe('1');
    expect(job.globalConfig['prime_tower_width']).toBe('50');
    expect(job.globalConfig['wall_loops']).toBe('3');
    expect(job.globalConfig['sparse_infill_density']).toBe('20%');

    // Object 0 (box): no overrides
    expect(job.objects[0].config).toBeUndefined();
    expect(job.objects[0].format).toBe('stl');
    expect(job.objects[0].posX).toBe(40);

    // Object 1 (vase): spiral mode, 1 wall, 0% infill
    expect(job.objects[1].config).toBeDefined();
    expect(job.objects[1].config!['wall_loops']).toBe('1');
    expect(job.objects[1].config!['sparse_infill_density']).toBe('0%');
    expect(job.objects[1].config!['spiral_mode']).toBe('1');
    expect(job.objects[1].rotZ).toBe(45);
    expect(job.objects[1].scaleX).toBe(0.8);

    // Object 2 (holder): support overrides, 3mf format
    expect(job.objects[2].config).toBeDefined();
    expect(job.objects[2].config!['enable_support']).toBe('1');
    expect(job.objects[2].config!['support_threshold_angle']).toBe('30');
    expect(job.objects[2].format).toBe('3mf');

    // Validation should pass (all objects within bed)
    expect(validatePlateForSlicing(plate)).toHaveLength(0);
  });
});
