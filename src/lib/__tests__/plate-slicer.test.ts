// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Exhaustive tests for plate-slicer.ts — settings merge, config generation,
 * validation, and auto-arrange for multi-object build plates.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeObjectSettings,
  buildPlateSliceConfig,
  validatePlateForSlicing,
  autoArrangeObjects,
  computeSTLBoundingBox,
  compute3MFBoundingBox,
  computeMeshBoundingBox,
  extractSTLFaces,
  findLayFlatRotation,
  applyRotationToSTL,
  layFlatMesh,
  extract3MFFaces,
  applyRotationTo3MF,
  computePrimeTowerDepth,
  computeRecommendedPrimeTowerWidth,
  getMaxFlushVolume,
} from '../plate-slicer';
import type { AutoArrangeOptions } from '../plate-slicer';
import type { PrimeTowerConfig } from '../../types/build-plate';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';
import type { BuildPlate, BuildPlateObject } from '../../types/build-plate';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';
import type { PrinterSettings } from '../slicer-settings';

// ─── Test fixtures ───────────────────────────────────────

const DEFAULT_FILAMENT: ResolvedFilamentSettings = {
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

const DEFAULT_PRINTER: PrinterSettings = {
  bedWidth: 220,
  bedDepth: 220,
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

/** Create a minimal BuildPlateObject for testing */
function makeObject(overrides: Partial<BuildPlateObject> = {}): BuildPlateObject {
  return {
    id: overrides.id ?? 'obj-1',
    name: overrides.name ?? 'Test Object',
    type: overrides.type ?? 'stl',
    meshData: overrides.meshData ?? new ArrayBuffer(10),
    meshFormat: overrides.meshFormat ?? 'stl',
    position: overrides.position ?? { x: 100, y: 100 },
    rotation: overrides.rotation ?? 0,
    scale: overrides.scale ?? { x: 1, y: 1, z: 1 },
    ...overrides,
  };
}

/** Create a minimal BuildPlate for testing */
function makePlate(overrides: Partial<BuildPlate> = {}): BuildPlate {
  return {
    objects: overrides.objects ?? [makeObject()],
    plateProfile: overrides.plateProfile ?? { ...DEFAULT_PRINT_PROFILE },
    primeTower: overrides.primeTower ?? {
      enabled: false,
      position: { x: 200, y: 200 },
      width: 60,
      brimWidth: 3,
    },
    printSequence: overrides.printSequence ?? 'by_layer',
    bedWidth: overrides.bedWidth ?? 220,
    bedDepth: overrides.bedDepth ?? 220,
    maxHeight: overrides.maxHeight ?? 250,
    originCenter: overrides.originCenter ?? false,
  };
}

// ─── mergeObjectSettings ────────────────────────────────

describe('mergeObjectSettings', () => {
  it('returns plate defaults when no overrides', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE);
    expect(result).toEqual(DEFAULT_PRINT_PROFILE);
  });

  it('returns a copy, not the same reference', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE);
    expect(result).not.toBe(DEFAULT_PRINT_PROFILE);
  });

  it('returns plate defaults when overrides is undefined', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, undefined);
    expect(result).toEqual(DEFAULT_PRINT_PROFILE);
  });

  it('returns plate defaults when overrides is empty object', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, {});
    expect(result).toEqual(DEFAULT_PRINT_PROFILE);
  });

  it('overrides a single field', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, { wallLoops: 5 });
    expect(result.wallLoops).toBe(5);
    // Other fields unchanged
    expect(result.layerHeight).toBe(DEFAULT_PRINT_PROFILE.layerHeight);
    expect(result.sparseInfillDensity).toBe(DEFAULT_PRINT_PROFILE.sparseInfillDensity);
  });

  it('overrides multiple fields', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, {
      wallLoops: 5,
      sparseInfillDensity: 50,
      supportEnabled: true,
    });
    expect(result.wallLoops).toBe(5);
    expect(result.sparseInfillDensity).toBe(50);
    expect(result.supportEnabled).toBe(true);
    // Non-overridden field unchanged
    expect(result.layerHeight).toBe(DEFAULT_PRINT_PROFILE.layerHeight);
  });

  it('override with same value as default still produces correct result', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, {
      wallLoops: DEFAULT_PRINT_PROFILE.wallLoops,
    });
    expect(result.wallLoops).toBe(DEFAULT_PRINT_PROFILE.wallLoops);
  });

  it('does NOT override when value is undefined', () => {
    const overrides: Partial<PrintProfile> = { wallLoops: undefined };
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, overrides);
    expect(result.wallLoops).toBe(DEFAULT_PRINT_PROFILE.wallLoops);
  });

  it('overrides boolean fields correctly', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, {
      supportEnabled: true,
      spiralMode: true,
    });
    expect(result.supportEnabled).toBe(true);
    expect(result.spiralMode).toBe(true);
  });

  it('overrides string enum fields correctly', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, {
      sparseInfillPattern: 'honeycomb',
      seamPosition: 'random',
    });
    expect(result.sparseInfillPattern).toBe('honeycomb');
    expect(result.seamPosition).toBe('random');
  });

  it('overrides layer height to a non-default value', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, { layerHeight: 0.1 });
    expect(result.layerHeight).toBe(0.1);
  });

  it('overrides print sequence field', () => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, { printSequence: 'by_object' });
    expect(result.printSequence).toBe('by_object');
  });
});

// ─── buildPlateSliceConfig ──────────────────────────────

describe('buildPlateSliceConfig', () => {
  it('builds config for single object with no overrides', () => {
    const plate = makePlate({
      objects: [makeObject({ id: 'a', position: { x: 50, y: 60 }, rotation: 45 })],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);

    expect(job.objects).toHaveLength(1);
    expect(job.objects[0].posX).toBe(50);
    expect(job.objects[0].posY).toBe(60);
    expect(job.objects[0].rotZ).toBe(45);
    expect(job.objects[0].scaleX).toBe(1);
    expect(job.objects[0].scaleY).toBe(1);
    expect(job.objects[0].scaleZ).toBe(1);
    expect(job.objects[0].format).toBe('stl');
    // No per-object config diff when no overrides
    expect(job.objects[0].config).toBeUndefined();
    expect(job.printSequence).toBe('by_layer');
  });

  it('builds config for single object with overrides', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          printOverrides: { wallLoops: 5, sparseInfillDensity: 50 },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);

    expect(job.objects).toHaveLength(1);
    // Per-object config should contain the differing keys
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['wall_loops']).toBe('5');
    expect(job.objects[0].config!['sparse_infill_density']).toBe('50%');
  });

  it('builds config for multiple objects with mixed overrides', () => {
    const plate = makePlate({
      objects: [
        makeObject({ id: 'a', position: { x: 30, y: 30 } }),
        makeObject({
          id: 'b',
          position: { x: 150, y: 150 },
          printOverrides: { wallLoops: 2 },
        }),
        makeObject({
          id: 'c',
          position: { x: 80, y: 80 },
          printOverrides: { supportEnabled: true },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);

    expect(job.objects).toHaveLength(3);
    // First object: no overrides
    expect(job.objects[0].config).toBeUndefined();
    // Second object: wallLoops override
    expect(job.objects[1].config).toBeDefined();
    expect(job.objects[1].config!['wall_loops']).toBe('2');
    // Third object: support override
    expect(job.objects[2].config).toBeDefined();
    expect(job.objects[2].config!['enable_support']).toBe('1');
  });

  it('does not produce per-object config when override matches plate default', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          // Override with the same value as the plate default
          printOverrides: { wallLoops: DEFAULT_PRINT_PROFILE.wallLoops },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);

    // Config diff should be undefined since values are the same
    expect(job.objects[0].config).toBeUndefined();
  });

  it('passes through empty overrides without generating config diff', () => {
    const plate = makePlate({
      objects: [makeObject({ id: 'a', printOverrides: {} })],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeUndefined();
  });

  it('preserves print sequence in the job', () => {
    const plate = makePlate({ printSequence: 'by_object' });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.printSequence).toBe('by_object');
  });

  it('preserves mesh format for 3MF objects', () => {
    const plate = makePlate({
      objects: [makeObject({ id: 'a', meshFormat: '3mf', type: '3mf' })],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].format).toBe('3mf');
  });

  it('preserves object scale in the job', () => {
    const plate = makePlate({
      objects: [makeObject({ id: 'a', scale: { x: 2, y: 1.5, z: 0.5 } })],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].scaleX).toBe(2);
    expect(job.objects[0].scaleY).toBe(1.5);
    expect(job.objects[0].scaleZ).toBe(0.5);
  });

  it('global config uses plate profile', () => {
    const plate = makePlate({
      plateProfile: { ...DEFAULT_PRINT_PROFILE, wallLoops: 7 },
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.globalConfig['wall_loops']).toBe('7');
  });
});

// ─── Settings override system — exhaustive ───────────────

describe('Settings override system — every PrintProfile field', () => {
  // Collect all field names from DEFAULT_PRINT_PROFILE
  const allFields = Object.keys(DEFAULT_PRINT_PROFILE) as Array<keyof PrintProfile>;

  it('DEFAULT_PRINT_PROFILE has at least 100 fields', () => {
    expect(allFields.length).toBeGreaterThanOrEqual(100);
  });

  // Test every number field can be overridden
  const numberFields = allFields.filter(
    (f) => typeof DEFAULT_PRINT_PROFILE[f] === 'number',
  ) as Array<keyof PrintProfile>;

  it.each(numberFields)('number field "%s" can be overridden per-object', (field) => {
    const defaultVal = DEFAULT_PRINT_PROFILE[field] as number;
    const overrideVal = defaultVal === 0 ? 42 : defaultVal * 2 + 1;
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, { [field]: overrideVal } as Partial<PrintProfile>);
    expect((result as Record<string, unknown>)[field]).toBe(overrideVal);
  });

  it.each(numberFields)('number field "%s" falls through when not overridden', (field) => {
    // Override a DIFFERENT field, verify this one keeps its default
    const otherField = numberFields.find((f) => f !== field)!;
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, { [otherField]: 999 } as Partial<PrintProfile>);
    expect((result as Record<string, unknown>)[field]).toBe(DEFAULT_PRINT_PROFILE[field]);
  });

  // Test every boolean field can be overridden
  const booleanFields = allFields.filter(
    (f) => typeof DEFAULT_PRINT_PROFILE[f] === 'boolean',
  ) as Array<keyof PrintProfile>;

  it.each(booleanFields)('boolean field "%s" can be overridden per-object', (field) => {
    const defaultVal = DEFAULT_PRINT_PROFILE[field] as boolean;
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, { [field]: !defaultVal } as Partial<PrintProfile>);
    expect((result as Record<string, unknown>)[field]).toBe(!defaultVal);
  });

  // Test every string field can be overridden
  const stringFields = allFields.filter(
    (f) => typeof DEFAULT_PRINT_PROFILE[f] === 'string',
  ) as Array<keyof PrintProfile>;

  it.each(stringFields)('string field "%s" can be overridden per-object', (field) => {
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, { [field]: 'test_override_value' } as Partial<PrintProfile>);
    expect((result as Record<string, unknown>)[field]).toBe('test_override_value');
  });

  it('undefined values in overrides do not replace defaults for any field', () => {
    // Create an overrides object with ALL fields set to undefined
    const allUndefined: Partial<PrintProfile> = {};
    for (const f of allFields) {
      (allUndefined as Record<string, unknown>)[f] = undefined;
    }
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, allUndefined);
    // Every field should still be the default
    for (const f of allFields) {
      expect((result as Record<string, unknown>)[f]).toBe(DEFAULT_PRINT_PROFILE[f]);
    }
  });

  it('overriding all fields produces a fully overridden profile', () => {
    const overrides: Partial<PrintProfile> = {};
    for (const f of allFields) {
      const val = DEFAULT_PRINT_PROFILE[f];
      if (typeof val === 'number') {
        (overrides as Record<string, unknown>)[f] = val + 100;
      } else if (typeof val === 'boolean') {
        (overrides as Record<string, unknown>)[f] = !val;
      } else if (typeof val === 'string') {
        (overrides as Record<string, unknown>)[f] = val + '_overridden';
      }
    }
    const result = mergeObjectSettings(DEFAULT_PRINT_PROFILE, overrides as Partial<PrintProfile>);
    for (const f of allFields) {
      expect((result as Record<string, unknown>)[f]).toBe((overrides as Record<string, unknown>)[f]);
    }
  });
});

describe('Settings override — multi-object config diffs', () => {
  it('three objects with different overrides produce independent diffs', () => {
    const plate = makePlate({
      objects: [
        makeObject({ id: 'a', printOverrides: { layerHeight: 0.1 } }),
        makeObject({ id: 'b', printOverrides: { wallLoops: 5, sparseInfillDensity: 80 } }),
        makeObject({ id: 'c' }), // no overrides
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);

    // Object A: only layer_height differs
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['layer_height']).toBe('0.1');
    expect(job.objects[0].config!['wall_loops']).toBeUndefined();

    // Object B: wallLoops and infill differ
    expect(job.objects[1].config).toBeDefined();
    expect(job.objects[1].config!['wall_loops']).toBe('5');
    expect(job.objects[1].config!['sparse_infill_density']).toBe('80%');
    expect(job.objects[1].config!['layer_height']).toBeUndefined();

    // Object C: no diff
    expect(job.objects[2].config).toBeUndefined();
  });

  it('objects overriding the same field to different values get correct diffs', () => {
    const plate = makePlate({
      objects: [
        makeObject({ id: 'a', printOverrides: { wallLoops: 1 } }),
        makeObject({ id: 'b', printOverrides: { wallLoops: 8 } }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config!['wall_loops']).toBe('1');
    expect(job.objects[1].config!['wall_loops']).toBe('8');
  });

  it('override with same value as plate default produces no diff entry', () => {
    const plate = makePlate({
      plateProfile: { ...DEFAULT_PRINT_PROFILE, wallLoops: 3 },
      objects: [
        makeObject({ id: 'a', printOverrides: { wallLoops: 3 } }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeUndefined();
  });

  it('non-default plate profile with per-object override matching plate produces no diff', () => {
    const customProfile = { ...DEFAULT_PRINT_PROFILE, sparseInfillDensity: 60, wallLoops: 5 };
    const plate = makePlate({
      plateProfile: customProfile,
      objects: [
        makeObject({ id: 'a', printOverrides: { sparseInfillDensity: 60, wallLoops: 5 } }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeUndefined();
  });

  it('non-default plate profile with per-object override differing from plate produces diff', () => {
    const customProfile = { ...DEFAULT_PRINT_PROFILE, sparseInfillDensity: 60 };
    const plate = makePlate({
      plateProfile: customProfile,
      objects: [
        makeObject({ id: 'a', printOverrides: { sparseInfillDensity: 40 } }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['sparse_infill_density']).toBe('40%');
  });
});

describe('Settings override — specific field categories', () => {
  it('adaptiveLayerHeight boolean passes through per-object', () => {
    const plate = makePlate({
      plateProfile: { ...DEFAULT_PRINT_PROFILE, adaptiveLayerHeight: false },
      objects: [
        makeObject({ id: 'a', printOverrides: { adaptiveLayerHeight: true } }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['adaptive_layer_height']).toBe('1');
  });

  it('support fields can be overridden per-object', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          printOverrides: {
            supportEnabled: true,
            supportType: 'tree_auto',
            supportThresholdAngle: 30,
            supportDensity: 50,
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['enable_support']).toBe('1');
    expect(job.objects[0].config!['support_type']).toBe('tree(auto)');
    expect(job.objects[0].config!['support_threshold_angle']).toBe('30');
    expect(job.objects[0].config!['sparse_infill_density']).toBeUndefined(); // not overridden
  });

  it('speed and acceleration fields can be overridden per-object', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          printOverrides: {
            outerWallSpeed: 60,
            innerWallSpeed: 90,
            defaultAcceleration: 1000,
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['outer_wall_speed']).toBe('60');
    expect(job.objects[0].config!['inner_wall_speed']).toBe('90');
    expect(job.objects[0].config!['default_acceleration']).toBe('1000');
  });

  it('adhesion fields can be overridden per-object', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          printOverrides: {
            adhesionType: 'brim',
            brimWidth: 12,
            brimType: 'outer_only',
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['brim_width']).toBe('12');
    expect(job.objects[0].config!['brim_type']).toBe('outer_only');
  });

  it('advanced fields (fuzzy skin, ironing) can be overridden per-object', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          printOverrides: {
            fuzzySkinType: 'external',
            ironingType: 'top',
            spiralMode: true,
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['fuzzy_skin']).toBe('external');
    expect(job.objects[0].config!['ironing_type']).toBe('top');
    expect(job.objects[0].config!['spiral_mode']).toBe('1');
  });

  it('compensation fields can be overridden per-object', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          printOverrides: {
            elephantFootCompensation: 0.2,
            xyHoleCompensation: -0.1,
            xyContourCompensation: 0.05,
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['elefant_foot_compensation']).toBe('0.2');
    expect(job.objects[0].config!['xy_hole_compensation']).toBe('-0.1');
    expect(job.objects[0].config!['xy_contour_compensation']).toBe('0.05');
  });

  it('interlocking beam fields can be overridden per-object', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          printOverrides: {
            interlockingBeam: true,
            interlockingBeamWidth: 1.2,
            interlockingDepth: 3,
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['interlocking_beam']).toBe('1');
    expect(job.objects[0].config!['interlocking_beam_width']).toBe('1.2');
    expect(job.objects[0].config!['interlocking_depth']).toBe('3');
  });

  it('tree support fields can be overridden per-object', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          printOverrides: {
            treeSupportBranchDistance: 8,
            treeSupportTipDiameter: 1.2,
            treeSupportBranchAngle: 30,
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['tree_support_branch_distance']).toBe('8');
    expect(job.objects[0].config!['tree_support_tip_diameter']).toBe('1.2');
    expect(job.objects[0].config!['tree_support_branch_angle']).toBe('30');
  });

  it('seam and scarf fields can be overridden per-object', () => {
    const plate = makePlate({
      objects: [
        makeObject({
          id: 'a',
          printOverrides: {
            seamPosition: 'random',
            seamScarfType: 'external',
            scarfJointSpeed: 50,
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['seam_position']).toBe('random');
    expect(job.objects[0].config!['seam_slope_type']).toBe('external');
    expect(job.objects[0].config!['seam_slope_start_height']).toBeUndefined(); // not overridden
  });

  it('plate-level printSequence is passed to job.printSequence', () => {
    const plate = makePlate({ printSequence: 'by_object' });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.printSequence).toBe('by_object');

    const plate2 = makePlate({ printSequence: 'by_layer' });
    const job2 = buildPlateSliceConfig(plate2, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job2.printSequence).toBe('by_layer');
  });

  it('printSequence in plate profile generates correct global config key', () => {
    const plate = makePlate({
      plateProfile: { ...DEFAULT_PRINT_PROFILE, printSequence: 'by_object' },
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.globalConfig['print_sequence']).toBe('by object');
  });

  it('mixed overrides: some fields match plate, some differ', () => {
    const customProfile = { ...DEFAULT_PRINT_PROFILE, wallLoops: 5, layerHeight: 0.3 };
    const plate = makePlate({
      plateProfile: customProfile,
      objects: [
        makeObject({
          id: 'a',
          printOverrides: {
            wallLoops: 5,    // same as plate → no diff
            layerHeight: 0.1, // different → diff
            supportEnabled: true, // different → diff
          },
        }),
      ],
    });
    const job = buildPlateSliceConfig(plate, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(job.objects[0].config).toBeDefined();
    expect(job.objects[0].config!['wall_loops']).toBeUndefined(); // same as plate
    expect(job.objects[0].config!['layer_height']).toBe('0.1');
    expect(job.objects[0].config!['enable_support']).toBe('1');
  });
});

// ─── validatePlateForSlicing ─────────────────────────────

describe('validatePlateForSlicing', () => {
  it('returns error for empty plate', () => {
    const plate = makePlate({ objects: [] });
    const errors = validatePlateForSlicing(plate);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no objects/i);
  });

  it('returns no errors for valid plate', () => {
    const plate = makePlate({
      objects: [makeObject({ position: { x: 100, y: 100 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors).toHaveLength(0);
  });

  it('detects object outside bed on X axis (too large)', () => {
    const plate = makePlate({
      objects: [makeObject({ name: 'BigX', position: { x: 250, y: 100 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('BigX') && e.includes('X axis'))).toBe(true);
  });

  it('detects object outside bed on Y axis (too large)', () => {
    const plate = makePlate({
      objects: [makeObject({ name: 'BigY', position: { x: 100, y: 300 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('BigY') && e.includes('Y axis'))).toBe(true);
  });

  it('detects object outside bed on X axis (negative, non-center origin)', () => {
    const plate = makePlate({
      originCenter: false,
      objects: [makeObject({ name: 'NegX', position: { x: -10, y: 100 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('NegX') && e.includes('X axis'))).toBe(true);
  });

  it('detects object outside bed on Y axis (negative, non-center origin)', () => {
    const plate = makePlate({
      originCenter: false,
      objects: [makeObject({ name: 'NegY', position: { x: 100, y: -5 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('NegY') && e.includes('Y axis'))).toBe(true);
  });

  it('handles center-origin bed bounds correctly', () => {
    const plate = makePlate({
      bedWidth: 200,
      bedDepth: 200,
      originCenter: true,
      objects: [makeObject({ position: { x: 0, y: 0 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors).toHaveLength(0);
  });

  it('detects out-of-bounds with center-origin', () => {
    const plate = makePlate({
      bedWidth: 200,
      bedDepth: 200,
      originCenter: true,
      objects: [makeObject({ name: 'Far', position: { x: 110, y: 0 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('Far') && e.includes('X axis'))).toBe(true);
  });

  it('allows objects at bed edges', () => {
    const plate = makePlate({
      bedWidth: 220,
      bedDepth: 220,
      originCenter: false,
      objects: [
        makeObject({ name: 'Corner', position: { x: 0, y: 0 } }),
        makeObject({ name: 'FarCorner', position: { x: 220, y: 220 } }),
      ],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors).toHaveLength(0);
  });

  it('reports multiple errors for multiple out-of-bounds objects', () => {
    const plate = makePlate({
      bedWidth: 220,
      bedDepth: 220,
      originCenter: false,
      objects: [
        makeObject({ name: 'ObjA', position: { x: -5, y: 100 } }),
        makeObject({ name: 'ObjB', position: { x: 100, y: 300 } }),
      ],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBe(2);
    expect(errors.some(e => e.includes('ObjA'))).toBe(true);
    expect(errors.some(e => e.includes('ObjB'))).toBe(true);
  });

  it('warns about by-object mode with overlapping positions', () => {
    const plate = makePlate({
      printSequence: 'by_object',
      objects: [
        makeObject({ id: 'a', position: { x: 100, y: 100 } }),
        makeObject({ id: 'b', position: { x: 100, y: 100 } }),
      ],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('by-object') || e.includes('By-object'))).toBe(true);
  });

  it('no overlap warning for by-object mode with distinct positions', () => {
    const plate = makePlate({
      printSequence: 'by_object',
      objects: [
        makeObject({ id: 'a', position: { x: 50, y: 50 } }),
        makeObject({ id: 'b', position: { x: 150, y: 150 } }),
      ],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors).toHaveLength(0);
  });

  it('no overlap warning for by-layer mode even with same positions', () => {
    const plate = makePlate({
      printSequence: 'by_layer',
      objects: [
        makeObject({ id: 'a', position: { x: 100, y: 100 } }),
        makeObject({ id: 'b', position: { x: 100, y: 100 } }),
      ],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors).toHaveLength(0);
  });

  it('no overlap warning for single object in by-object mode', () => {
    const plate = makePlate({
      printSequence: 'by_object',
      objects: [makeObject({ id: 'a', position: { x: 100, y: 100 } })],
    });
    const errors = validatePlateForSlicing(plate);
    expect(errors).toHaveLength(0);
  });
});

// ─── autoArrangeObjects ──────────────────────────────────

describe('autoArrangeObjects', () => {
  it('returns empty array for no objects', () => {
    const result = autoArrangeObjects([], 220, 220, false);
    expect(result).toHaveLength(0);
  });

  it('places single object near front-left (non-center origin)', () => {
    const objs = [makeObject({ id: 'a' })];
    const result = autoArrangeObjects(objs, 220, 220, false, 10, 30);
    expect(result).toHaveLength(1);
    // startX = 0 + 10 + 15 = 25, startY = 0 + 10 + 15 = 25
    expect(result[0].position.x).toBe(25);
    expect(result[0].position.y).toBe(25);
  });

  it('places single object near center-left for center-origin bed', () => {
    const objs = [makeObject({ id: 'a' })];
    const result = autoArrangeObjects(objs, 220, 220, true, 10, 30);
    expect(result).toHaveLength(1);
    // startX = -110 + 10 + 15 = -85, startY = -110 + 10 + 15 = -85
    expect(result[0].position.x).toBe(-85);
    expect(result[0].position.y).toBe(-85);
  });

  it('places two objects side by side in a row', () => {
    const objs = [
      makeObject({ id: 'a' }),
      makeObject({ id: 'b' }),
    ];
    const result = autoArrangeObjects(objs, 220, 220, false, 10, 30);
    expect(result).toHaveLength(2);
    // First at startX=25, second at 25 + 30 + 10 = 65
    expect(result[0].position.x).toBe(25);
    expect(result[1].position.x).toBe(65);
    // Same Y (same row)
    expect(result[0].position.y).toBe(result[1].position.y);
  });

  it('wraps to next row when objects exceed bed width', () => {
    const objs = Array.from({ length: 10 }, (_, i) => makeObject({ id: `obj-${i}` }));
    // With bedWidth=100, estimatedSize=30, spacing=10:
    // startX = 25, endX = 100 - 15 = 85
    // Fits: 25, 65 (next would be 105 > 85, wrap)
    const result = autoArrangeObjects(objs, 100, 300, false, 10, 30);
    expect(result).toHaveLength(10);

    // First row: x=25, x=65
    expect(result[0].position.x).toBe(25);
    expect(result[1].position.x).toBe(65);
    // Second row wraps
    expect(result[2].position.x).toBe(25);
    expect(result[2].position.y).toBeGreaterThan(result[0].position.y);
  });

  it('does not mutate input objects', () => {
    const original = makeObject({ id: 'a', position: { x: 0, y: 0 } });
    const objs = [original];
    autoArrangeObjects(objs, 220, 220, false);
    expect(original.position.x).toBe(0);
    expect(original.position.y).toBe(0);
  });

  it('preserves object properties other than position', () => {
    const original = makeObject({
      id: 'a',
      name: 'My Object',
      rotation: 45,
      scale: { x: 2, y: 2, z: 2 },
      printOverrides: { wallLoops: 5 },
    });
    const result = autoArrangeObjects([original], 220, 220, false);
    expect(result[0].id).toBe('a');
    expect(result[0].name).toBe('My Object');
    expect(result[0].rotation).toBe(45);
    expect(result[0].scale).toEqual({ x: 2, y: 2, z: 2 });
    expect(result[0].printOverrides).toEqual({ wallLoops: 5 });
  });

  it('uses custom spacing', () => {
    const objs = [makeObject({ id: 'a' }), makeObject({ id: 'b' })];
    const result = autoArrangeObjects(objs, 220, 220, false, 20, 30);
    // startX = 0 + 20 + 15 = 35
    // second = 35 + 30 + 20 = 85
    expect(result[0].position.x).toBe(35);
    expect(result[1].position.x).toBe(85);
  });

  it('handles objects that overflow the bed gracefully (no crash)', () => {
    // Very small bed, many objects — should still produce positions
    const objs = Array.from({ length: 20 }, (_, i) => makeObject({ id: `obj-${i}` }));
    const result = autoArrangeObjects(objs, 50, 50, false, 5, 30);
    expect(result).toHaveLength(20);
    // Objects beyond the bed just keep going (no crash)
    result.forEach(obj => {
      expect(typeof obj.position.x).toBe('number');
      expect(typeof obj.position.y).toBe('number');
    });
  });

  it('sorts objects by area (largest first) for better packing', () => {
    // Create objects with different bounding boxes via meshData
    const smallObj = makeObject({ id: 'small', meshData: makeSTLData(10, 10, 10) });
    const largeObj = makeObject({ id: 'large', meshData: makeSTLData(50, 50, 10) });
    // Put small first — arrange should still place large first (it gets priority)
    const result = autoArrangeObjects([smallObj, largeObj], 220, 220, false);
    // Large gets placed at its best position (spacing + 25 = 35)
    expect(result[1].position.x).toBe(35);
    expect(result[1].position.y).toBe(35);
    // Small is placed without overlapping the large
    const dx = Math.abs(result[0].position.x - result[1].position.x);
    const dy = Math.abs(result[0].position.y - result[1].position.y);
    // At least one axis must have enough gap (halfW_s + halfW_l + spacing = 5+25+10 = 40)
    expect(dx >= 40 || dy >= 40).toBe(true);
  });

  it('uses actual mesh bounding boxes for spacing', () => {
    // Two objects with known sizes: 20mm and 40mm wide
    const obj20 = makeObject({ id: 'a', meshData: makeSTLData(20, 20, 10) });
    const obj40 = makeObject({ id: 'b', meshData: makeSTLData(40, 40, 10) });
    const result = autoArrangeObjects([obj20, obj40], 220, 220, false, 10);
    // Objects should not overlap (40mm gets placed first due to area sort)
    const aRect = { cx: result[0].position.x, hw: 10 };
    const bRect = { cx: result[1].position.x, hw: 20 };
    const gap = Math.abs(aRect.cx - bRect.cx) - aRect.hw - bRect.hw;
    expect(gap).toBeGreaterThanOrEqual(10); // at least spacing apart
  });

  it('accepts AutoArrangeOptions object', () => {
    const objs = [makeObject({ id: 'a', meshData: makeSTLData(20, 20, 10) })];
    const opts: AutoArrangeOptions = { spacing: 15, fallbackSize: 40 };
    const result = autoArrangeObjects(objs, 220, 220, false, opts);
    expect(result).toHaveLength(1);
    // Position = spacing + halfW = 15 + 10 = 25
    expect(result[0].position.x).toBe(25);
    expect(result[0].position.y).toBe(25);
  });

  it('reserves space for prime tower', () => {
    const tower: PrimeTowerConfig = {
      enabled: true,
      position: { x: 25, y: 25 },
      width: 30,
      brimWidth: 0,
    };
    const objs = [makeObject({ id: 'a', meshData: makeSTLData(20, 20, 10) })];
    const opts: AutoArrangeOptions = { spacing: 10, primeTower: tower };
    const result = autoArrangeObjects(objs, 220, 220, false, opts);
    // Object should not overlap with tower at (25,25) with half-size 15
    const dx = Math.abs(result[0].position.x - 25);
    const dy = Math.abs(result[0].position.y - 25);
    // Object halfW=10, tower halfW=15, spacing=10 → need dx >= 35 or dy >= 35
    expect(dx >= 35 || dy >= 35).toBe(true);
  });

  it('does not reserve space for disabled prime tower', () => {
    const tower: PrimeTowerConfig = {
      enabled: false,
      position: { x: 25, y: 25 },
      width: 30,
      brimWidth: 0,
    };
    const objs = [makeObject({ id: 'a', meshData: makeSTLData(20, 20, 10) })];
    const opts: AutoArrangeOptions = { spacing: 10, primeTower: tower };
    const result = autoArrangeObjects(objs, 220, 220, false, opts);
    // Object at (20, 20) — can overlap tower position since tower is disabled
    expect(result[0].position.x).toBe(20);
    expect(result[0].position.y).toBe(20);
  });

  it('tries 90° rotation for better fit on narrow bed', () => {
    // Object is 60mm wide × 20mm deep on a 50mm wide bed
    // Without rotation it doesn't fit, with 90° rotation it does (20mm wide)
    const obj = makeObject({ id: 'a', meshData: makeSTLData(60, 20, 10) });
    const opts: AutoArrangeOptions = { spacing: 5, tryRotation: true };
    const result = autoArrangeObjects([obj], 50, 200, false, opts);
    // Should rotate 90° to fit (20mm wide fits in 50mm bed)
    expect(result[0].rotation).toBe(90); // original 0 + 90
    expect(result[0].position.x).toBeLessThanOrEqual(50);
  });

  it('does not rotate when tryRotation is false', () => {
    const obj = makeObject({ id: 'a', rotation: 0, meshData: makeSTLData(60, 20, 10) });
    const opts: AutoArrangeOptions = { spacing: 5, tryRotation: false };
    const result = autoArrangeObjects([obj], 50, 200, false, opts);
    // Can't fit without rotation — goes to overflow position
    expect(result[0].rotation).toBe(0);
  });

  it('applies object scale to bounding box', () => {
    // 20mm object scaled 2x = 40mm effective
    const obj = makeObject({
      id: 'a',
      meshData: makeSTLData(20, 20, 10),
      scale: { x: 2, y: 2, z: 1 },
    });
    const result = autoArrangeObjects([obj], 220, 220, false, 10);
    // Position = spacing + scaledHalf = 10 + 20 = 30
    expect(result[0].position.x).toBe(30);
    expect(result[0].position.y).toBe(30);
  });

  it('preserves original order in result array', () => {
    // Objects with different sizes — sorting changes placement order
    // but result array should match input order
    const small = makeObject({ id: 'small', meshData: makeSTLData(10, 10, 5) });
    const large = makeObject({ id: 'large', meshData: makeSTLData(50, 50, 5) });
    const medium = makeObject({ id: 'medium', meshData: makeSTLData(30, 30, 5) });
    const result = autoArrangeObjects([small, large, medium], 220, 220, false);
    expect(result[0].id).toBe('small');
    expect(result[1].id).toBe('large');
    expect(result[2].id).toBe('medium');
  });
});

// ─── Bounding box computation ────────────────────────────

/**
 * Create a minimal binary STL buffer with one triangle that spans
 * from (0,0,0) to (width, depth, height).
 */
function makeSTLData(width: number, depth: number, height: number): ArrayBuffer {
  // 80-byte header + 4-byte count + 2 triangles × 50 bytes = 184 bytes
  const triangleCount = 2;
  const buf = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangleCount, true);

  // Triangle 1: (0,0,0), (width, 0, 0), (0, depth, 0) — covers X and Y
  let off = 84;
  // Normal (ignored for bounding box)
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 1, true); off += 4;
  // Vertex 1: (0, 0, 0)
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  // Vertex 2: (width, 0, 0)
  view.setFloat32(off, width, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  // Vertex 3: (0, depth, 0)
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, depth, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  // Attribute byte count
  view.setUint16(off, 0, true); off += 2;

  // Triangle 2: (0,0,height), (width,depth,0), (0,0,0) — covers Z
  // Normal
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 1, true); off += 4;
  // Vertex 1: (0, 0, height)
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, height, true); off += 4;
  // Vertex 2: (width, depth, 0)
  view.setFloat32(off, width, true); off += 4;
  view.setFloat32(off, depth, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  // Vertex 3: (0, 0, 0)
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  view.setFloat32(off, 0, true); off += 4;
  // Attribute byte count
  view.setUint16(off, 0, true);

  return buf;
}

describe('computeSTLBoundingBox', () => {
  it('computes correct bounds for a simple STL', () => {
    const data = makeSTLData(30, 40, 50);
    const bounds = computeSTLBoundingBox(data);
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeCloseTo(30, 1);
    expect(bounds!.depth).toBeCloseTo(40, 1);
    expect(bounds!.height).toBeCloseTo(50, 1);
  });

  it('returns null for buffer smaller than header', () => {
    expect(computeSTLBoundingBox(new ArrayBuffer(10))).toBeNull();
  });

  it('returns null for zero triangles', () => {
    const buf = new ArrayBuffer(84);
    const view = new DataView(buf);
    view.setUint32(80, 0, true);
    expect(computeSTLBoundingBox(buf)).toBeNull();
  });

  it('returns null for truncated buffer', () => {
    const buf = new ArrayBuffer(100); // header says triangles but not enough data
    const view = new DataView(buf);
    view.setUint32(80, 10, true); // claims 10 triangles (needs 584 bytes)
    expect(computeSTLBoundingBox(buf)).toBeNull();
  });

  it('handles unit cube (1x1x1)', () => {
    const data = makeSTLData(1, 1, 1);
    const bounds = computeSTLBoundingBox(data);
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeCloseTo(1, 1);
    expect(bounds!.depth).toBeCloseTo(1, 1);
    expect(bounds!.height).toBeCloseTo(1, 1);
  });
});

describe('compute3MFBoundingBox', () => {
  it('returns null for non-ZIP data', () => {
    expect(compute3MFBoundingBox(new ArrayBuffer(10))).toBeNull();
  });

  it('returns null for empty buffer', () => {
    expect(compute3MFBoundingBox(new ArrayBuffer(0))).toBeNull();
  });
});

describe('computeMeshBoundingBox', () => {
  it('computes STL bounds with unit scale', () => {
    const data = makeSTLData(20, 30, 40);
    const bounds = computeMeshBoundingBox(data, 'stl');
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeCloseTo(20, 1);
    expect(bounds!.depth).toBeCloseTo(30, 1);
    expect(bounds!.height).toBeCloseTo(40, 1);
  });

  it('applies scale factors', () => {
    const data = makeSTLData(20, 30, 40);
    const bounds = computeMeshBoundingBox(data, 'stl', { x: 2, y: 0.5, z: 3 });
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeCloseTo(40, 1);  // 20 × 2
    expect(bounds!.depth).toBeCloseTo(15, 1);  // 30 × 0.5
    expect(bounds!.height).toBeCloseTo(120, 1); // 40 × 3
  });

  it('handles negative scale (mirror)', () => {
    const data = makeSTLData(20, 30, 40);
    const bounds = computeMeshBoundingBox(data, 'stl', { x: -1, y: 1, z: 1 });
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeCloseTo(20, 1); // abs(-1) × 20
  });

  it('returns null for unparseable data', () => {
    expect(computeMeshBoundingBox(new ArrayBuffer(10), 'stl')).toBeNull();
  });

  it('returns null for unparseable 3MF', () => {
    expect(computeMeshBoundingBox(new ArrayBuffer(10), '3mf')).toBeNull();
  });
});

// ─── Lay Flat tests ──────────────────────────────────────

/**
 * Create an STL with a large flat face whose outward normal points in the
 * given direction. The face is a 100×100mm quad (2 triangles) placed at
 * the origin. A small triangle in a perpendicular direction ensures the
 * mesh isn't perfectly flat.
 */
function makeSTLWithFlatFace(normalDir: 'x' | '-x' | 'y' | '-y' | 'z' | '-z'): ArrayBuffer {
  // 4 triangles: 2 for the large face, 2 small perpendicular
  const triangleCount = 4;
  const buf = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangleCount, true);

  function writeTriangle(idx: number, n: [number, number, number], v0: [number, number, number], v1: [number, number, number], v2: [number, number, number]) {
    let off = 84 + idx * 50;
    view.setFloat32(off, n[0], true); off += 4;
    view.setFloat32(off, n[1], true); off += 4;
    view.setFloat32(off, n[2], true); off += 4;
    for (const v of [v0, v1, v2]) {
      view.setFloat32(off, v[0], true); off += 4;
      view.setFloat32(off, v[1], true); off += 4;
      view.setFloat32(off, v[2], true); off += 4;
    }
    view.setUint16(off, 0, true);
  }

  // Large face triangles (100×100mm quad)
  // The vertices define a plane whose normal points in the desired direction
  switch (normalDir) {
    case 'z':
      writeTriangle(0, [0, 0, 1], [0, 0, 50], [100, 0, 50], [0, 100, 50]);
      writeTriangle(1, [0, 0, 1], [100, 0, 50], [100, 100, 50], [0, 100, 50]);
      // Small faces on the side
      writeTriangle(2, [0, -1, 0], [0, 0, 0], [10, 0, 0], [0, 0, 10]);
      writeTriangle(3, [0, -1, 0], [0, 0, 0], [0, 0, 10], [10, 0, 10]);
      break;
    case '-z':
      writeTriangle(0, [0, 0, -1], [0, 0, 0], [0, 100, 0], [100, 0, 0]);
      writeTriangle(1, [0, 0, -1], [100, 0, 0], [0, 100, 0], [100, 100, 0]);
      writeTriangle(2, [0, -1, 0], [0, 0, 0], [10, 0, 0], [0, 0, 10]);
      writeTriangle(3, [0, -1, 0], [0, 0, 0], [0, 0, 10], [10, 0, 10]);
      break;
    case 'x':
      writeTriangle(0, [1, 0, 0], [50, 0, 0], [50, 100, 0], [50, 0, 100]);
      writeTriangle(1, [1, 0, 0], [50, 100, 0], [50, 100, 100], [50, 0, 100]);
      writeTriangle(2, [0, 0, -1], [0, 0, 0], [10, 0, 0], [0, 10, 0]);
      writeTriangle(3, [0, 0, -1], [0, 0, 0], [0, 10, 0], [10, 10, 0]);
      break;
    case '-x':
      writeTriangle(0, [-1, 0, 0], [0, 0, 0], [0, 0, 100], [0, 100, 0]);
      writeTriangle(1, [-1, 0, 0], [0, 100, 0], [0, 0, 100], [0, 100, 100]);
      writeTriangle(2, [0, 0, -1], [0, 0, 0], [10, 0, 0], [0, 10, 0]);
      writeTriangle(3, [0, 0, -1], [0, 0, 0], [0, 10, 0], [10, 10, 0]);
      break;
    case 'y':
      writeTriangle(0, [0, 1, 0], [0, 50, 0], [0, 50, 100], [100, 50, 0]);
      writeTriangle(1, [0, 1, 0], [100, 50, 0], [0, 50, 100], [100, 50, 100]);
      writeTriangle(2, [0, 0, -1], [0, 0, 0], [10, 0, 0], [0, 10, 0]);
      writeTriangle(3, [0, 0, -1], [0, 0, 0], [0, 10, 0], [10, 10, 0]);
      break;
    case '-y':
      writeTriangle(0, [0, -1, 0], [0, 0, 0], [100, 0, 0], [0, 0, 100]);
      writeTriangle(1, [0, -1, 0], [100, 0, 0], [100, 0, 100], [0, 0, 100]);
      writeTriangle(2, [0, 0, -1], [0, 0, 0], [10, 0, 0], [0, 10, 0]);
      writeTriangle(3, [0, 0, -1], [0, 0, 0], [0, 10, 0], [10, 10, 0]);
      break;
  }

  return buf;
}

describe('extractSTLFaces', () => {
  it('extracts faces from a valid STL', () => {
    const data = makeSTLWithFlatFace('z');
    const faces = extractSTLFaces(data);
    expect(faces).not.toBeNull();
    expect(faces!.length).toBe(4);
  });

  it('returns null for tiny buffer', () => {
    expect(extractSTLFaces(new ArrayBuffer(10))).toBeNull();
  });

  it('returns null for zero-triangle STL', () => {
    const buf = new ArrayBuffer(84);
    new DataView(buf).setUint32(80, 0, true);
    expect(extractSTLFaces(buf)).toBeNull();
  });

  it('computes correct normals from vertices', () => {
    const data = makeSTLWithFlatFace('z');
    const faces = extractSTLFaces(data)!;
    // First two faces should have normals close to +Z
    expect(faces[0].normal.z).toBeGreaterThan(0.9);
    expect(faces[1].normal.z).toBeGreaterThan(0.9);
  });

  it('computes face areas', () => {
    const data = makeSTLWithFlatFace('z');
    const faces = extractSTLFaces(data)!;
    // 100×100 quad = 2 triangles each with area 5000
    expect(faces[0].area).toBeGreaterThan(1000);
    expect(faces[0].area + faces[1].area).toBeGreaterThan(faces[2].area + faces[3].area);
  });
});

describe('findLayFlatRotation', () => {
  it('returns null when largest face already points down (-Z)', () => {
    const data = makeSTLWithFlatFace('-z');
    const faces = extractSTLFaces(data)!;
    const rotation = findLayFlatRotation(faces);
    expect(rotation).toBeNull();
  });

  it('returns rotation for face pointing up (+Z)', () => {
    const data = makeSTLWithFlatFace('z');
    const faces = extractSTLFaces(data)!;
    const rotation = findLayFlatRotation(faces);
    expect(rotation).not.toBeNull();
    // Should be ~180° rotation around some horizontal axis
    expect(rotation!.angle).toBeCloseTo(Math.PI, 1);
  });

  it('returns rotation for face pointing +X', () => {
    const data = makeSTLWithFlatFace('x');
    const faces = extractSTLFaces(data)!;
    const rotation = findLayFlatRotation(faces);
    expect(rotation).not.toBeNull();
    // Should be ~90° rotation
    expect(rotation!.angle).toBeCloseTo(Math.PI / 2, 1);
  });

  it('returns rotation for face pointing -Y', () => {
    const data = makeSTLWithFlatFace('-y');
    const faces = extractSTLFaces(data)!;
    const rotation = findLayFlatRotation(faces);
    expect(rotation).not.toBeNull();
    expect(rotation!.angle).toBeCloseTo(Math.PI / 2, 1);
  });

  it('returns null for empty face list', () => {
    expect(findLayFlatRotation([])).toBeNull();
  });
});

describe('applyRotationToSTL', () => {
  it('produces a new buffer (does not mutate input)', () => {
    const data = makeSTLWithFlatFace('z');
    const original = new Uint8Array(data).slice();
    const result = applyRotationToSTL(data, { x: 1, y: 0, z: 0 }, Math.PI);
    expect(result).not.toBe(data);
    expect(new Uint8Array(data)).toEqual(original);
  });

  it('shifts minimum Z to 0 after rotation', () => {
    const data = makeSTLWithFlatFace('x');
    const faces = extractSTLFaces(data)!;
    const rotation = findLayFlatRotation(faces)!;
    const result = applyRotationToSTL(data, rotation.axis, rotation.angle);
    const bounds = computeSTLBoundingBox(result);
    expect(bounds).not.toBeNull();
    // After rotation, the mesh should sit on the bed — check that there are
    // vertices near Z=0 (min Z should be ~0)
    const view = new DataView(result);
    const count = view.getUint32(80, true);
    let minZ = Infinity;
    for (let i = 0; i < count; i++) {
      for (let v = 0; v < 3; v++) {
        const z = view.getFloat32(84 + i * 50 + 12 + v * 12 + 8, true);
        if (z < minZ) minZ = z;
      }
    }
    expect(minZ).toBeCloseTo(0, 2);
  });

  it('180° rotation around X flips Z axis', () => {
    // Create a point at (0, 0, 10) — after 180° around X, should be at (0, 0, -10),
    // then shifted to Z=0
    const data = makeSTLData(10, 10, 20);
    const result = applyRotationToSTL(data, { x: 1, y: 0, z: 0 }, Math.PI);
    const bounds = computeSTLBoundingBox(result);
    expect(bounds).not.toBeNull();
    // Height should be preserved
    expect(bounds!.height).toBeCloseTo(20, 0);
  });
});

describe('layFlatMesh', () => {
  it('returns null for mesh already lying flat (largest face is -Z)', () => {
    const data = makeSTLWithFlatFace('-z');
    expect(layFlatMesh(data, 'stl')).toBeNull();
  });

  it('rotates mesh with +Z face to lie flat', () => {
    const data = makeSTLWithFlatFace('z');
    const result = layFlatMesh(data, 'stl');
    expect(result).not.toBeNull();
    // After lay flat, the largest face should now point down
    const faces = extractSTLFaces(result!)!;
    // Find the two largest faces (the big quad)
    const sorted = [...faces].sort((a, b) => b.area - a.area);
    // Their normal should now be close to -Z
    expect(sorted[0].normal.z).toBeLessThan(-0.9);
  });

  it('rotates mesh with +X face to lie flat', () => {
    const data = makeSTLWithFlatFace('x');
    const result = layFlatMesh(data, 'stl');
    expect(result).not.toBeNull();
    const faces = extractSTLFaces(result!)!;
    const sorted = [...faces].sort((a, b) => b.area - a.area);
    expect(sorted[0].normal.z).toBeLessThan(-0.9);
  });

  it('returns null for unparseable data', () => {
    expect(layFlatMesh(new ArrayBuffer(10), 'stl')).toBeNull();
  });

  it('places rotated mesh on bed (minZ ≈ 0)', () => {
    const data = makeSTLWithFlatFace('y');
    const result = layFlatMesh(data, 'stl')!;
    expect(result).not.toBeNull();
    const view = new DataView(result);
    const count = view.getUint32(80, true);
    let minZ = Infinity;
    for (let i = 0; i < count; i++) {
      for (let v = 0; v < 3; v++) {
        const z = view.getFloat32(84 + i * 50 + 12 + v * 12 + 8, true);
        if (z < minZ) minZ = z;
      }
    }
    expect(minZ).toBeCloseTo(0, 2);
  });
});

describe('extract3MFFaces', () => {
  it('returns null for non-3MF data', () => {
    expect(extract3MFFaces(new ArrayBuffer(10))).toBeNull();
  });
});

// ─── Prime tower sizing from flush volumes ───────────────────────────

describe('getMaxFlushVolume', () => {
  it('returns 0 for single extruder (1x1 matrix)', () => {
    expect(getMaxFlushVolume([0], 1, 1.0)).toBe(0);
  });

  it('returns max off-diagonal value for 2x2 matrix', () => {
    // matrix: [0, 140, 200, 0]  → from=0→to=1: 140, from=1→to=0: 200
    expect(getMaxFlushVolume([0, 140, 200, 0], 2, 1.0)).toBe(200);
  });

  it('applies multiplier to matrix values', () => {
    expect(getMaxFlushVolume([0, 140, 200, 0], 2, 1.5)).toBe(300);
  });

  it('handles 3x3 matrix', () => {
    // 3x3: find max among all off-diagonal entries
    const matrix = [0, 100, 150, 120, 0, 180, 90, 200, 0];
    expect(getMaxFlushVolume(matrix, 3, 1.0)).toBe(200);
  });

  it('returns 0 when multiplier is 0', () => {
    expect(getMaxFlushVolume([0, 140, 200, 0], 2, 0)).toBe(0);
  });
});

describe('computePrimeTowerDepth', () => {
  it('returns minimum depth (one line width) for zero flush volume', () => {
    // OrcaSlicer formula: floor(0/width) + 1 = 1 pass minimum
    expect(computePrimeTowerDepth(0, 60, 0.2, 0.4)).toBeCloseTo(0.4, 2);
  });

  it('returns positive depth for typical flush volume', () => {
    const depth = computePrimeTowerDepth(140, 60, 0.2, 0.4);
    expect(depth).toBeGreaterThan(0);
  });

  it('depth increases with flush volume', () => {
    const depth1 = computePrimeTowerDepth(100, 60, 0.2, 0.4);
    const depth2 = computePrimeTowerDepth(200, 60, 0.2, 0.4);
    expect(depth2).toBeGreaterThan(depth1);
  });

  it('depth decreases with wider tower', () => {
    const depth1 = computePrimeTowerDepth(140, 40, 0.2, 0.4);
    const depth2 = computePrimeTowerDepth(140, 80, 0.2, 0.4);
    expect(depth2).toBeLessThan(depth1);
  });

  it('depth increases with smaller layer height (more passes)', () => {
    const depth1 = computePrimeTowerDepth(140, 60, 0.3, 0.4);
    const depth2 = computePrimeTowerDepth(140, 60, 0.1, 0.4);
    expect(depth2).toBeGreaterThan(depth1);
  });

  it('matches OrcaSlicer formula for known values', () => {
    // Manual calculation:
    // volume_to_length(140, 0.4, 0.2):
    //   area = 0.2 * (0.4 - 0.2 * (1 - PI/4)) = 0.2 * (0.4 - 0.04292) = 0.2 * 0.35708 = 0.071416
    //   length = 140 / 0.071416 ≈ 1960.3
    // effective_width = 60 - 3 * 0.4 = 58.8
    // passes = floor(1960.3 / 58.8) + 1 = 33 + 1 = 34
    // depth = 34 * 0.4 * 1.0 = 13.6
    const depth = computePrimeTowerDepth(140, 60, 0.2, 0.4);
    expect(depth).toBeCloseTo(13.6, 1);
  });
});

describe('computeRecommendedPrimeTowerWidth', () => {
  it('returns minimum width (35mm) for zero flush volume', () => {
    expect(computeRecommendedPrimeTowerWidth(0, 0.2, 0.4)).toBe(35);
  });

  it('returns a reasonable width for typical 140mm³ flush', () => {
    const width = computeRecommendedPrimeTowerWidth(140, 0.2, 0.4);
    expect(width).toBeGreaterThanOrEqual(35);
    expect(width).toBeLessThanOrEqual(150);
  });

  it('wider tower for larger flush volumes', () => {
    const width1 = computeRecommendedPrimeTowerWidth(100, 0.2, 0.4);
    const width2 = computeRecommendedPrimeTowerWidth(400, 0.2, 0.4);
    expect(width2).toBeGreaterThanOrEqual(width1);
  });

  it('produces roughly square footprint (depth ≈ width)', () => {
    const volume = 200;
    const layerHeight = 0.2;
    const lineWidth = 0.4;
    const width = computeRecommendedPrimeTowerWidth(volume, layerHeight, lineWidth);
    const depth = computePrimeTowerDepth(volume, width, layerHeight, lineWidth);
    // Depth should be within 50% of width for a roughly square tower
    expect(depth).toBeLessThanOrEqual(width * 1.5);
  });

  it('returns integer values', () => {
    const width = computeRecommendedPrimeTowerWidth(180, 0.2, 0.4);
    expect(width).toBe(Math.round(width));
  });

  it('never exceeds 150mm', () => {
    // Even with very large flush volume
    const width = computeRecommendedPrimeTowerWidth(1000, 0.2, 0.4);
    expect(width).toBeLessThanOrEqual(150);
  });

  it('never goes below 35mm', () => {
    const width = computeRecommendedPrimeTowerWidth(1, 0.2, 0.4);
    expect(width).toBeGreaterThanOrEqual(35);
  });
});
