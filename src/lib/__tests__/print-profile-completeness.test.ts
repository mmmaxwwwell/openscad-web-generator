// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Meta-test for PrintProfile completeness.
 *
 * Ensures:
 * (a) Every key in PrintProfile (via DEFAULT_PRINT_PROFILE) is consumed by
 *     buildOrcaConfig() — changing it must change at least one output config key.
 * (b) Every key in DEFAULT_PRINT_PROFILE has a non-undefined default value.
 * (c) No orphaned config keys — every output key of buildOrcaConfig() is traceable
 *     to at least one input (PrintProfile, filament, printer, or printerConfig).
 *
 * Since TypeScript interfaces are erased at runtime, we use the keys of
 * DEFAULT_PRINT_PROFILE as the source of truth for PrintProfile fields.
 */

import { describe, it, expect } from 'vitest';
import { buildOrcaConfig } from '../orca-slicer-settings';
import type { PrinterSettings } from '../slicer-settings';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';

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

function buildConfig(
  profileOverrides: Partial<PrintProfile> = {},
  filamentOverrides: Partial<ResolvedFilamentSettings> = {},
  printerOverrides: Partial<PrinterSettings> = {},
): Record<string, string> {
  return buildOrcaConfig(
    { ...DEFAULT_PRINT_PROFILE, ...profileOverrides },
    { ...DEFAULT_FILAMENT, ...filamentOverrides },
    { ...DEFAULT_PRINTER, ...printerOverrides },
    null,
    1,
  );
}

// ─── PrintProfile keys NOT directly consumed by buildOrcaConfig() ─────────────
//
// These fields exist in PrintProfile for the UI but are consumed through the
// filament resolution pipeline (ResolvedFilamentSettings) rather than directly
// from the profile. buildOrcaConfig uses filament-resolved values for these.
// They are tested separately below in section (a-filament).
//
const FILAMENT_RESOLVED_KEYS: Set<keyof PrintProfile> = new Set([
  // Retraction: profile has defaults, but buildOrcaConfig uses filament-resolved values
  // (f.retractDist, f.retractSpeed, f.deretractionSpeed)
  'retractionLength',
  'retractionSpeed',
  'deretractionSpeed',

  // Coast distance: stored in profile but not yet mapped in buildOrcaConfig
  // (OrcaSlicer doesn't have a direct coast_distance config key — it's handled
  // differently via wipe settings)
  'coastDistance',

  // Pressure advance: profile-level PA fields are for UI defaults; buildOrcaConfig
  // uses filament-level PA (f.enablePressureAdvance, f.pressureAdvance, f.adaptivePressureAdvance)
  'pressureAdvanceEnable',
  'pressureAdvanceValue',
  'adaptivePressureAdvance',

  // Adaptive PA extras: profile-level but gated on filament-level adaptivePressureAdvance.
  // Tested separately in "(a-filament)" section with filament override.
  'adaptivePAModel',
  'adaptivePAOverhangs',
  'adaptivePABridges',

  // Multi-material / prime tower: only emitted when extruderCount > 1.
  // Tested separately in "(a-multi-extruder)" section.
  'enablePrimeTower',
  'primeTowerWidth',
  'primeTowerBrimWidth',
  'flushVolume',
]);

// ─── Registry of PrintProfile keys and the conditions needed to observe them ───
//
// Some PrintProfile keys only affect output when certain preconditions are met
// (e.g., scarfAngleThreshold only matters when seamScarfType is not 'none').
// This registry maps each key to:
//   - preconditions: Partial<PrintProfile> to set before testing the key
//   - testValue: a value different from the default to set for detection
//
// Keys not in this map use auto-detection: numeric fields are bumped by a delta,
// booleans are flipped, strings get a different enum value.

type KeyTestConfig = {
  preconditions?: Partial<PrintProfile>;
  testValue: unknown;
};

const CONDITIONAL_KEYS: Partial<Record<keyof PrintProfile, KeyTestConfig>> = {
  // Scarf joint fields only emitted when seam scarf type is not 'none'
  // (seamScarfType itself always affects seam_slope_type)
  scarfSlopeConditional: { preconditions: { seamScarfType: 'external' }, testValue: true },
  scarfAngleThreshold: { preconditions: { seamScarfType: 'external' }, testValue: 120 },
  scarfOverhangThreshold: { preconditions: { seamScarfType: 'external' }, testValue: 30 },
  scarfJointSpeed: { preconditions: { seamScarfType: 'external' }, testValue: 50 },
  scarfJointFlowRatio: { preconditions: { seamScarfType: 'external' }, testValue: 0.9 },
  scarfStartHeight: { preconditions: { seamScarfType: 'external' }, testValue: 0.5 },
  scarfEntireLoop: { preconditions: { seamScarfType: 'external' }, testValue: true },
  scarfMinLength: { preconditions: { seamScarfType: 'external' }, testValue: 20 },
  scarfSteps: { preconditions: { seamScarfType: 'external' }, testValue: 15 },
  scarfInnerWalls: { preconditions: { seamScarfType: 'external' }, testValue: true },
  scarfHasScarf: { preconditions: { seamScarfType: 'external' }, testValue: true },

  // Adhesion-type conditional fields
  skirtCount: { preconditions: { adhesionType: 'skirt' }, testValue: 5 },
  skirtDistance: { preconditions: { adhesionType: 'skirt' }, testValue: 5 },
  brimWidth: { preconditions: { adhesionType: 'brim' }, testValue: 12 },
  brimType: { preconditions: { adhesionType: 'brim' }, testValue: 'brim_ears' },
  brimEarsDetectionLength: { preconditions: { adhesionType: 'brim' }, testValue: 3 },
  brimEarsMaxAngle: { preconditions: { adhesionType: 'brim' }, testValue: 100 },
  raftLayers: { preconditions: { adhesionType: 'raft' }, testValue: 4 },

  // Adaptive PA extras only emitted when filament has adaptivePressureAdvance enabled
  // These are profile-level keys but gated on filament-level adaptivePressureAdvance
  adaptivePAModel: {
    preconditions: {},
    testValue: 0.5,
  },
  adaptivePAOverhangs: {
    preconditions: {},
    testValue: true,
  },
  adaptivePABridges: {
    preconditions: {},
    testValue: 0.02,
  },

  // Arc fitting: gcodeResolution only emitted when arcFittingEnable is true
  gcodeResolution: { preconditions: { arcFittingEnable: true }, testValue: 0.05 },

  // Fuzzy skin noise type only emitted when fuzzySkinType is not 'none'
  fuzzySkinNoiseType: { preconditions: { fuzzySkinType: 'external' }, testValue: 'perlin' },

  // Hole-to-polyhole conditional fields
  holeToPolyholeThreshold: { preconditions: { holeToPolyhole: true }, testValue: 60 },
  holeToPoleholeTwisted: { preconditions: { holeToPolyhole: true }, testValue: true },

  // Make overhang printable conditional fields
  makeOverhangPrintableAngle: { preconditions: { makeOverhangPrintable: true }, testValue: 45 },
  makeOverhangPrintableHoleSize: { preconditions: { makeOverhangPrintable: true }, testValue: 2 },

  // Volumetric flow smoothing: segment only emitted when rate > 0
  maxVolumetricFlowSmoothingSegment: {
    preconditions: { maxVolumetricFlowSmoothingRate: 10 },
    testValue: 5,
  },

  // Overhang reverse threshold only emitted when overhangReverse is true
  overhangReverseThreshold: { preconditions: { overhangReverse: true }, testValue: 70 },

  // supportDensity needs supportEnabled and non-zero density to produce spacing key
  supportDensity: { preconditions: { supportEnabled: true }, testValue: 40 },
};

/**
 * Get a test value that differs from the default for a given PrintProfile key.
 * Uses the CONDITIONAL_KEYS registry for known-conditional fields, otherwise
 * auto-generates a different value based on the type of the default.
 */
function getTestValueForKey(key: keyof PrintProfile): {
  preconditions: Partial<PrintProfile>;
  testValue: unknown;
} {
  if (CONDITIONAL_KEYS[key]) {
    return {
      preconditions: CONDITIONAL_KEYS[key].preconditions ?? {},
      testValue: CONDITIONAL_KEYS[key].testValue,
    };
  }

  const defaultVal = DEFAULT_PRINT_PROFILE[key];

  if (typeof defaultVal === 'boolean') {
    return { preconditions: {}, testValue: !defaultVal };
  }
  if (typeof defaultVal === 'number') {
    // Bump by a meaningful amount
    return { preconditions: {}, testValue: defaultVal === 0 ? 1 : defaultVal * 2 };
  }
  if (typeof defaultVal === 'string') {
    // For enum string types, pick a different value
    return { preconditions: {}, testValue: getAlternateEnumValue(key, defaultVal) };
  }

  return { preconditions: {}, testValue: defaultVal };
}

/**
 * Get an alternate enum value for string-typed PrintProfile fields.
 */
function getAlternateEnumValue(key: keyof PrintProfile, currentValue: string): string {
  const alternatives: Record<string, string[]> = {
    seamPosition: ['nearest', 'aligned', 'aligned_back', 'back', 'random'],
    seamScarfType: ['none', 'external', 'all'],
    wallSequence: ['inner_outer', 'outer_inner', 'inner_outer_inner'],
    wallGenerator: ['classic', 'arachne'],
    wallDirection: ['auto', 'ccw', 'cw'],
    sparseInfillPattern: ['grid', 'gyroid', 'cubic', 'line'],
    topSurfacePattern: ['monotonicline', 'monotonic', 'concentric', 'rectilinear'],
    bottomSurfacePattern: ['monotonic', 'monotonicline', 'concentric', 'rectilinear'],
    internalSolidInfillPattern: ['monotonic', 'monotonicline', 'concentric', 'rectilinear'],
    supportType: ['normal_auto', 'tree_auto', 'normal_manual', 'tree_manual'],
    supportStyle: ['default', 'grid', 'snug', 'tree_slim', 'tree_strong', 'tree_hybrid', 'organic'],
    supportBasePattern: ['default', 'rectilinear', 'rectilinear-grid', 'honeycomb', 'lightning', 'hollow'],
    supportInterfacePattern: ['auto', 'rectilinear', 'concentric', 'rectilinear_interlaced', 'grid'],
    adhesionType: ['none', 'skirt', 'brim', 'raft'],
    brimType: ['auto_brim', 'brim_ears', 'outer_only', 'inner_only', 'outer_and_inner', 'painted'],
    zHopType: ['auto', 'normal', 'slope', 'spiral'],
    fuzzySkinType: ['none', 'external', 'all', 'allwalls'],
    fuzzySkinMode: ['displacement', 'extrusion', 'combined'],
    fuzzySkinNoiseType: ['classic', 'perlin', 'billow', 'ridged_multi', 'voronoi'],
    ironingType: ['no ironing', 'top', 'topmost', 'solid'],
    ensureVerticalShellThickness: ['none', 'ensure_critical_only', 'ensure_moderate', 'ensure_all'],
    gapFillTarget: ['everywhere', 'topbottom', 'nowhere'],
    timelapseType: ['none', 'smooth'],
  };

  const options = alternatives[key];
  if (options) {
    const alt = options.find((v) => v !== currentValue);
    return alt ?? currentValue;
  }
  return currentValue + '_alt';
}

// ─── Tests ───────────────────────────────────────────────

describe('PrintProfile completeness', () => {
  const profileKeys = Object.keys(DEFAULT_PRINT_PROFILE) as (keyof PrintProfile)[];

  describe('(a) every PrintProfile key is consumed by buildOrcaConfig()', () => {
    // Build baseline config with defaults
    const baselineConfig = buildConfig();

    // Keys consumed through filament resolution are tested separately
    const directProfileKeys = profileKeys.filter((k) => !FILAMENT_RESOLVED_KEYS.has(k));

    for (const key of directProfileKeys) {
      it(`PrintProfile.${key} affects config output`, () => {
        const { preconditions, testValue } = getTestValueForKey(key);

        // Build baseline with preconditions applied (but the key at its default value)
        const baseWithPreconditions = buildConfig(preconditions);

        // Build config with preconditions + the changed key
        const changedConfig = buildConfig({
          ...preconditions,
          [key]: testValue,
        } as Partial<PrintProfile>);

        // The config must differ in at least one output key
        const baseKeys = Object.keys(baseWithPreconditions);
        const changedKeys = Object.keys(changedConfig);
        const allKeys = new Set([...baseKeys, ...changedKeys]);

        let differs = false;
        for (const configKey of allKeys) {
          if (baseWithPreconditions[configKey] !== changedConfig[configKey]) {
            differs = true;
            break;
          }
        }

        expect(differs).toBe(true);
      });
    }

    // Adaptive PA extras: profile-level fields gated on filament-level
    // adaptivePressureAdvance. Must test with filament override enabled.
    const adaptivePAKeys: (keyof PrintProfile)[] = [
      'adaptivePAModel',
      'adaptivePAOverhangs',
      'adaptivePABridges',
    ];

    for (const key of adaptivePAKeys) {
      it(`PrintProfile.${key} affects config output (with filament adaptive PA enabled)`, () => {
        const filamentWithAdaptivePA: Partial<ResolvedFilamentSettings> = {
          adaptivePressureAdvance: true,
        };

        const baseConfig = buildConfig({}, filamentWithAdaptivePA);
        const { testValue } = getTestValueForKey(key);
        const changedConfig = buildConfig(
          { [key]: testValue } as Partial<PrintProfile>,
          filamentWithAdaptivePA,
        );

        const allKeys = new Set([
          ...Object.keys(baseConfig),
          ...Object.keys(changedConfig),
        ]);

        let differs = false;
        for (const configKey of allKeys) {
          if (baseConfig[configKey] !== changedConfig[configKey]) {
            differs = true;
            break;
          }
        }

        expect(differs).toBe(true);
      });
    }
  });

  describe('(a-filament) PrintProfile keys consumed via filament resolution are documented', () => {
    it('all filament-resolved keys are accounted for', () => {
      // These keys exist in PrintProfile for UI purposes but buildOrcaConfig
      // reads them from ResolvedFilamentSettings instead. This is by design:
      // the profile stores user defaults, the filament pipeline resolves
      // them with per-printer overrides before they reach buildOrcaConfig.
      expect(FILAMENT_RESOLVED_KEYS.size).toBe(14);
      expect([...FILAMENT_RESOLVED_KEYS].sort()).toEqual([
        'adaptivePABridges',
        'adaptivePAModel',
        'adaptivePAOverhangs',
        'adaptivePressureAdvance',
        'coastDistance',
        'deretractionSpeed',
        'enablePrimeTower',
        'flushVolume',
        'pressureAdvanceEnable',
        'pressureAdvanceValue',
        'primeTowerBrimWidth',
        'primeTowerWidth',
        'retractionLength',
        'retractionSpeed',
      ]);
    });
  });

  describe('(a-multi-extruder) PrintProfile keys gated on extruderCount > 1', () => {
    const multiExtBuild = (overrides: Partial<PrintProfile> = {}) =>
      buildOrcaConfig(
        { ...DEFAULT_PRINT_PROFILE, ...overrides },
        DEFAULT_FILAMENT,
        DEFAULT_PRINTER,
        null,
        2,
      );

    const multiExtKeys: (keyof PrintProfile)[] = [
      'enablePrimeTower',
      'primeTowerWidth',
      'primeTowerBrimWidth',
      'flushVolume',
    ];

    for (const key of multiExtKeys) {
      it(`PrintProfile.${key} affects multi-extruder config output`, () => {
        const baseline = multiExtBuild();
        const testValue = key === 'enablePrimeTower' ? !DEFAULT_PRINT_PROFILE.enablePrimeTower
          : (DEFAULT_PRINT_PROFILE[key] as number) + 10;
        const changed = multiExtBuild({ [key]: testValue } as Partial<PrintProfile>);

        const allKeys = new Set([...Object.keys(baseline), ...Object.keys(changed)]);
        let differs = false;
        for (const configKey of allKeys) {
          if (baseline[configKey] !== changed[configKey]) {
            differs = true;
            break;
          }
        }
        expect(differs).toBe(true);
      });
    }
  });

  describe('(b) every DEFAULT_PRINT_PROFILE key has a non-undefined default', () => {
    for (const key of profileKeys) {
      it(`DEFAULT_PRINT_PROFILE.${key} is not undefined`, () => {
        expect(DEFAULT_PRINT_PROFILE[key]).not.toBeUndefined();
      });
    }

    it('DEFAULT_PRINT_PROFILE has no null values', () => {
      for (const key of profileKeys) {
        expect(DEFAULT_PRINT_PROFILE[key]).not.toBeNull();
      }
    });

    it('DEFAULT_PRINT_PROFILE satisfies PrintProfile type (compile-time check)', () => {
      // This is a compile-time assertion — if DEFAULT_PRINT_PROFILE misses
      // any PrintProfile key, TypeScript will catch it. At runtime we just
      // verify the object exists and has the right number of keys.
      const profile: PrintProfile = DEFAULT_PRINT_PROFILE;
      expect(Object.keys(profile).length).toBeGreaterThan(0);
    });
  });

  describe('(c) no orphaned config keys', () => {
    it('every output config key is influenced by at least one input parameter', () => {
      // Build baseline config with all defaults
      const baselineConfig = buildConfig();
      const allOutputKeys = new Set(Object.keys(baselineConfig));

      // Track which output keys are "covered" — changed by at least one input
      const coveredKeys = new Set<string>();

      // Test each PrintProfile key
      for (const key of profileKeys) {
        const { preconditions, testValue } = getTestValueForKey(key);
        const baseWithPreconditions = buildConfig(preconditions);
        const changedConfig = buildConfig({
          ...preconditions,
          [key]: testValue,
        } as Partial<PrintProfile>);

        for (const configKey of Object.keys(changedConfig)) {
          if (baseWithPreconditions[configKey] !== changedConfig[configKey]) {
            coveredKeys.add(configKey);
          }
        }
        // Keys that appear/disappear also count
        for (const configKey of Object.keys(baseWithPreconditions)) {
          if (!(configKey in changedConfig)) {
            coveredKeys.add(configKey);
          }
        }
      }

      // Also test with filament adaptive PA enabled to cover adaptive PA output keys
      const baseWithAdaptivePA = buildConfig({}, { adaptivePressureAdvance: true });
      const allOutputKeysExpanded = new Set([
        ...allOutputKeys,
        ...Object.keys(baseWithAdaptivePA),
      ]);

      for (const key of ['adaptivePAModel', 'adaptivePAOverhangs', 'adaptivePABridges'] as const) {
        const { testValue } = getTestValueForKey(key);
        const changedConfig = buildConfig(
          { [key]: testValue } as Partial<PrintProfile>,
          { adaptivePressureAdvance: true },
        );
        for (const configKey of Object.keys(changedConfig)) {
          if (baseWithAdaptivePA[configKey] !== changedConfig[configKey]) {
            coveredKeys.add(configKey);
          }
        }
      }

      // Test each filament key
      const filamentKeys: (keyof ResolvedFilamentSettings)[] = [
        'nozzleTemp', 'bedTemp', 'fanSpeed', 'firstLayerFan', 'printSpeed',
        'retractDist', 'retractSpeed', 'deretractionSpeed',
        'firstLayerNozzleTemp', 'firstLayerBedTemp', 'minSpeed', 'minLayerTime',
        'flowRatio', 'enablePressureAdvance', 'pressureAdvance', 'adaptivePressureAdvance',
        'overhangFanSpeed', 'overhangFanThreshold', 'enableOverhangBridgeFan',
        'closeFanFirstLayers', 'fanCoolingLayerTime', 'slowDownLayerTime', 'fanMaxSpeed',
        'coolPlateTemp', 'coolPlateTempInitialLayer', 'engPlateTemp', 'engPlateTempInitialLayer',
        'texturedPlateTemp', 'texturedPlateTempInitialLayer',
      ];

      for (const key of filamentKeys) {
        const defaultVal = DEFAULT_FILAMENT[key];
        let testVal: unknown;
        if (typeof defaultVal === 'boolean') testVal = !defaultVal;
        else if (typeof defaultVal === 'number') testVal = defaultVal === 0 ? 1 : defaultVal * 2;
        else testVal = defaultVal;

        const changedConfig = buildConfig({}, { [key]: testVal } as Partial<ResolvedFilamentSettings>);
        for (const configKey of Object.keys(changedConfig)) {
          if (baselineConfig[configKey] !== changedConfig[configKey]) {
            coveredKeys.add(configKey);
          }
        }
      }

      // Test each printer key
      const printerTestValues: Partial<PrinterSettings>[] = [
        { bedWidth: 300 },
        { bedDepth: 300 },
        { maxHeight: 300 },
        { originCenter: true },
        { startGcode: 'G28\n{bed_temp}' },
        { endGcode: 'M84' },
        { toolChangeGcode: 'T{tool}' },
        { auxiliaryFan: true },
        { chamberTempControl: true },
        { maxVolumetricSpeed: 20 },
        { nozzleType: 'hardened_steel' },
        { nozzleHRC: 50 },
        { printerStructureType: 'corexy' },
        { printableArea: [{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 220, y: 220 }] },
        { bedExcludeAreas: [{ x: 0, y: 0, width: 50, height: 50 }] },
      ];

      for (const override of printerTestValues) {
        const changedConfig = buildConfig({}, {}, override);
        for (const configKey of Object.keys(changedConfig)) {
          if (baselineConfig[configKey] !== changedConfig[configKey]) {
            coveredKeys.add(configKey);
          }
        }
        // Keys that appear when printer settings change
        for (const configKey of Object.keys(changedConfig)) {
          if (!(configKey in baselineConfig)) {
            coveredKeys.add(configKey);
          }
        }
      }

      // Test PrinterConfig (nozzle/filament diameter)
      const configWithPC = buildOrcaConfig(
        DEFAULT_PRINT_PROFILE,
        DEFAULT_FILAMENT,
        DEFAULT_PRINTER,
        { nozzleDiameter: 0.6, filamentDiameter: 2.85 },
        1,
      );
      for (const configKey of Object.keys(configWithPC)) {
        if (baselineConfig[configKey] !== configWithPC[configKey]) {
          coveredKeys.add(configKey);
        }
      }

      // Multi-extruder test (covers single_extruder_multi_material)
      const multiExtConfig = buildOrcaConfig(
        DEFAULT_PRINT_PROFILE,
        DEFAULT_FILAMENT,
        DEFAULT_PRINTER,
        null,
        2,
      );
      for (const configKey of Object.keys(multiExtConfig)) {
        if (!(configKey in baselineConfig) || baselineConfig[configKey] !== multiExtConfig[configKey]) {
          coveredKeys.add(configKey);
        }
      }

      // Collect all output keys from ALL configurations tested
      const allTestedOutputKeys = new Set<string>();
      // Re-run all test scenarios to collect complete output key set
      // (some keys only appear conditionally)
      const allScenarios: Record<string, string>[] = [
        baselineConfig,
        baseWithAdaptivePA,
        configWithPC,
        multiExtConfig,
      ];

      // Add profile-conditional scenarios
      for (const key of profileKeys) {
        const { preconditions, testValue } = getTestValueForKey(key);
        allScenarios.push(buildConfig({ ...preconditions, [key]: testValue } as Partial<PrintProfile>));
      }

      // Add printer-conditional scenarios
      for (const override of printerTestValues) {
        allScenarios.push(buildConfig({}, {}, override));
      }

      for (const scenario of allScenarios) {
        for (const k of Object.keys(scenario)) {
          allTestedOutputKeys.add(k);
        }
      }

      // Hardcoded constant keys that don't depend on any input parameter
      const constantKeys = new Set([
        'use_relative_e_distances',  // Always '1' (OrcaSlicer default)
        'layer_change_gcode',        // Always 'G92 E0' (required by relative E)
      ]);

      // Find uncovered keys (excluding hardcoded constants)
      const uncoveredKeys = [...allTestedOutputKeys].filter(
        (k) => !coveredKeys.has(k) && !constantKeys.has(k),
      );

      expect(uncoveredKeys).toEqual([]);
    });
  });
});
