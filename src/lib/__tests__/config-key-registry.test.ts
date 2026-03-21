// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Config key registry test — maintains a known-good list of all OrcaSlicer
 * config keys that buildOrcaConfig() can produce.
 *
 * Purpose:
 * - Catches key name typos (misspelled OrcaSlicer keys)
 * - Ensures we don't accidentally send PrusaSlicer keys
 * - Documents the complete set of config keys we support
 * - Detects unintentional additions or removals of keys
 */

import { describe, it, expect } from 'vitest';
import { buildOrcaConfig } from '../orca-slicer-settings';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';
import type { PrinterSettings } from '../slicer-settings';

// ─── Known-good OrcaSlicer config key registry ──────────────────────
// Every key that buildOrcaConfig() can ever produce must be listed here.
// If you add a new key to buildOrcaConfig(), add it here too.
// If a key appears in the output but not in this set, the test fails.

const ORCASLICER_CONFIG_KEY_REGISTRY = new Set([
  // Quality — Layer & Line Width
  'layer_height',
  'initial_layer_print_height',
  'adaptive_layer_height',
  'precise_z_height',
  'line_width',
  'outer_wall_line_width',
  'inner_wall_line_width',
  'top_surface_line_width',
  'internal_solid_infill_line_width',
  'sparse_infill_line_width',
  'support_line_width',
  'initial_layer_line_width',

  // Seam
  'seam_position',
  'seam_gap',
  'staggered_inner_seams',

  // Scarf joint seam
  'seam_slope_type',
  'seam_slope_conditional',
  'scarf_angle_threshold',
  'scarf_overhang_threshold',
  'scarf_joint_speed',
  'scarf_joint_flow_ratio',
  'seam_slope_start_height',
  'seam_slope_entire_loop',
  'seam_slope_min_length',
  'seam_slope_steps',
  'seam_slope_inner_walls',
  'has_scarf_joint_seam',

  // Walls
  'wall_loops',
  'wall_sequence',
  'wall_generator',
  'wall_direction',
  'is_infill_first',
  'ensure_vertical_shell_thickness',
  'precise_outer_wall',
  'detect_thin_wall',
  'detect_overhang_wall',
  'only_one_wall_first_layer',
  'only_one_wall_top',
  'extra_perimeters_on_overhangs',
  'slowdown_for_curled_perimeters',
  'top_shell_layers',
  'bottom_shell_layers',

  // Arachne settings
  'min_bead_width',
  'min_feature_size',
  'wall_transition_angle',
  'wall_transition_filter_deviation',
  'wall_transition_length',
  'wall_distribution_count',

  // Infill
  'sparse_infill_pattern',
  'top_surface_pattern',
  'bottom_surface_pattern',
  'internal_solid_infill_pattern',
  'sparse_infill_density',
  'infill_direction',
  'infill_wall_overlap',
  'infill_combination',
  'bridge_flow',
  'internal_bridge_flow',
  'bridge_density',
  'internal_bridge_density',
  'bridge_angle',
  'internal_bridge_angle',

  // Speed — overhang speed
  'enable_overhang_speed',
  'overhang_1_4_speed',
  'overhang_2_4_speed',
  'overhang_3_4_speed',
  'overhang_4_4_speed',

  // Speed — per-feature speeds
  'outer_wall_speed',
  'inner_wall_speed',
  'top_surface_speed',
  'internal_solid_infill_speed',
  'sparse_infill_speed',
  'gap_infill_speed',
  'support_speed',
  'bridge_speed',
  'internal_bridge_speed',
  'small_perimeter_speed',
  'small_perimeter_threshold',
  'initial_layer_speed',
  'initial_layer_infill_speed',
  'initial_layer_travel_speed',
  'skirt_speed',
  'travel_speed',

  // Speed — per-feature accelerations
  'default_acceleration',
  'outer_wall_acceleration',
  'inner_wall_acceleration',
  'top_surface_acceleration',
  'bridge_acceleration',
  'sparse_infill_acceleration',
  'internal_solid_infill_acceleration',
  'initial_layer_acceleration',
  'travel_acceleration',

  // Speed — per-feature jerk
  'default_jerk',
  'outer_wall_jerk',
  'inner_wall_jerk',
  'top_surface_jerk',
  'infill_jerk',
  'travel_jerk',
  'initial_layer_jerk',

  // Speed — Klipper accel-to-decel
  'accel_to_decel_enable',
  'accel_to_decel_factor',

  // Support
  'enable_support',
  'support_type',
  'support_style',
  'support_threshold_angle',
  'support_object_xy_distance',
  'support_top_z_distance',
  'support_on_build_plate_only',
  'support_interface_top_layers',
  'support_interface_bottom_layers',
  'support_base_pattern',
  'support_interface_pattern',
  'support_interface_spacing',
  'support_interface_speed',
  'support_base_pattern_spacing',

  // Adhesion
  'skirt_loops',
  'skirt_distance',
  'brim_type',
  'brim_width',
  'brim_ears_detection_length',
  'brim_ears_max_angle',
  'raft_layers',

  // Retraction (per-extruder)
  'retraction_length',
  'retraction_speed',
  'deretraction_speed',
  'retract_when_changing_layer',
  'retract_lift_above',
  'z_hop',
  'z_hop_types',
  'wipe',
  'wipe_distance',
  'retraction_length_toolchange',

  // Filament settings (per-extruder)
  'nozzle_temperature',
  'nozzle_temperature_initial_layer',
  'hot_plate_temp',
  'hot_plate_temp_initial_layer',
  'cool_plate_temp',
  'cool_plate_temp_initial_layer',
  'eng_plate_temp',
  'eng_plate_temp_initial_layer',
  'textured_plate_temp',
  'textured_plate_temp_initial_layer',
  'fan_max_speed',
  'fan_min_speed',
  'close_fan_the_first_x_layers',
  'fan_cooling_layer_time',
  'slow_down_min_speed',
  'slow_down_layer_time',
  'filament_flow_ratio',
  'enable_pressure_advance',
  'pressure_advance',
  'adaptive_pressure_advance',
  'overhang_fan_speed',
  'overhang_fan_threshold',
  'enable_overhang_bridge_fan',

  // Printer settings
  'printable_area',
  'printable_height',
  'use_relative_e_distances',
  'layer_change_gcode',
  'machine_start_gcode',
  'machine_end_gcode',
  'change_filament_gcode',
  'bed_exclude_area',
  'printer_structure',
  'nozzle_type',
  'nozzle_hrc',
  'auxiliary_fan',
  'chamber_temperature',
  'max_volumetric_speed',
  'nozzle_diameter',
  'filament_diameter',

  // Multi-material
  'single_extruder_multi_material',
  'enable_prime_tower',
  'prime_tower_width',
  'prime_tower_brim_width',
  'flush_volumes_matrix',
  'flush_volumes_vector',
  'filament_colour',

  // Advanced — Adaptive PA extras
  'adaptive_pressure_advance_model',
  'adaptive_pressure_advance_overhangs',
  'adaptive_pressure_advance_bridges',

  // Advanced — Arc fitting
  'enable_arc_fitting',
  'gcode_resolution',

  // Advanced — Fuzzy skin
  'fuzzy_skin',
  'fuzzy_skin_mode',
  'fuzzy_skin_noise_type',
  'fuzzy_skin_thickness',
  'fuzzy_skin_point_distance',
  'fuzzy_skin_first_layer',
  'fuzzy_skin_scale',
  'fuzzy_skin_octaves',
  'fuzzy_skin_persistence',

  // Advanced — Ironing
  'ironing_type',
  'ironing_flow',
  'ironing_spacing',
  'ironing_speed',
  'ironing_angle',

  // Advanced — Hole-to-polyhole
  'hole_to_polyhole',
  'hole_to_polyhole_threshold',
  'hole_to_polyhole_twisted',

  // Advanced — Other
  'exclude_object',
  'make_overhang_printable',
  'make_overhang_printable_angle',
  'make_overhang_printable_hole_size',
  'max_volumetric_extrusion_rate_slope',
  'max_volumetric_extrusion_rate_slope_segment_length',
  'top_solid_infill_flow_ratio',
  'bottom_solid_infill_flow_ratio',
  'gap_fill_target',
  'reduce_infill_retraction',
  'use_firmware_retraction',
  'print_flow_ratio',
  'timelapse_type',
  'spiral_mode',
  'overhang_reverse',
  'overhang_reverse_internal_only',
  'overhang_reverse_threshold',
  'slow_down_layers',
]);

// ─── PrusaSlicer keys that must NEVER appear in output ──────────────
// If buildOrcaConfig() accidentally uses a PrusaSlicer key name,
// these tests catch it.

const PRUSASLICER_KEYS_BLOCKLIST = new Set([
  // Key naming differences
  'perimeters',
  'fill_density',
  'fill_pattern',
  'first_layer_height',
  'external_perimeter_speed',
  'perimeter_speed',
  'support_material',
  'bed_temperature',
  'first_layer_bed_temperature',
  'temperature',
  'first_layer_temperature',
  'extrusion_multiplier',
  'retract_length',
  'retract_speed',
  'bed_shape',
  'start_gcode',
  'end_gcode',
  'toolchange_gcode',
  'external_perimeters_first',
  'bridge_fan_speed',
  'top_solid_layers',
  'bottom_solid_layers',
  'infill_every_layers',
  'support_material_threshold',
  'support_material_xy_spacing',
  'support_material_interface_layers',
  'support_material_buildplate_only',
  'skirts',
  'brim_separation',
  'retract_restart_extra',
  'retract_before_travel',
  'retract_layer_change',
  'retract_lift',
  'first_layer_speed',
  'perimeter_acceleration',
  'infill_acceleration',
  'first_layer_acceleration',
  'default_acceleration',  // This IS an OrcaSlicer key too — keep it in both
]);
// Remove keys that are actually valid in both slicers
PRUSASLICER_KEYS_BLOCKLIST.delete('default_acceleration');

// ─── Test fixtures ──────────────────────────────────────────────────

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
  nozzleDiameter: 0.4,
  startGcode: '',
  endGcode: '',
  toolChangeGcode: '',
  printableArea: [],
  bedExcludeAreas: [],
  printerStructureType: 'corexy',
  nozzleType: 'brass',
  nozzleHRC: 0,
  auxiliaryFan: false,
  chamberTempControl: false,
  maxVolumetricSpeed: 0,
};

/**
 * Build config with all conditional features enabled to maximize key coverage.
 */
function buildMaximalConfig(): Record<string, string> {
  const profile: PrintProfile = {
    ...DEFAULT_PRINT_PROFILE,
    // Enable support to get support_base_pattern_spacing
    supportEnabled: true,
    supportDensity: 50,
    // Adhesion: skirt (to get skirt_distance)
    adhesionType: 'skirt',
    // Enable overhang reverse
    overhangReverse: true,
    // Enable hole-to-polyhole
    holeToPolyhole: true,
    // Enable make overhang printable
    makeOverhangPrintable: true,
    // Enable arc fitting
    arcFittingEnable: true,
    // Fuzzy skin on
    fuzzySkinType: 'external',
    // Volumetric flow smoothing
    maxVolumetricFlowSmoothingRate: 10,
  };

  const filament: ResolvedFilamentSettings = {
    ...DEFAULT_FILAMENT,
    adaptivePressureAdvance: true,
  };

  const printer: PrinterSettings = {
    ...DEFAULT_PRINTER,
    startGcode: 'START',
    endGcode: 'END',
    toolChangeGcode: 'TOOL',
    bedExcludeAreas: [{ x: 0, y: 0, width: 10, height: 10 }],
    printerStructureType: 'corexy',
    nozzleType: 'hardened_steel',
    nozzleHRC: 60,
    chamberTempControl: true,
    maxVolumetricSpeed: 15,
  };

  return buildOrcaConfig(profile, filament, printer, null, 1);
}

/**
 * Build config with brim adhesion to get brim-specific keys.
 */
function buildBrimConfig(): Record<string, string> {
  const profile: PrintProfile = {
    ...DEFAULT_PRINT_PROFILE,
    adhesionType: 'brim',
    brimType: 'brim_ears',
  };
  return buildOrcaConfig(profile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
}

/**
 * Build multi-extruder config to get multi-material key.
 */
function buildMultiExtruderConfig(): Record<string, string> {
  return buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 2);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Config Key Registry', () => {
  describe('all output keys are in the registry', () => {
    it('maximal config (all conditional features enabled)', () => {
      const config = buildMaximalConfig();
      const unknownKeys = Object.keys(config).filter(
        (k) => !ORCASLICER_CONFIG_KEY_REGISTRY.has(k)
      );
      expect(unknownKeys).toEqual([]);
    });

    it('brim adhesion config', () => {
      const config = buildBrimConfig();
      const unknownKeys = Object.keys(config).filter(
        (k) => !ORCASLICER_CONFIG_KEY_REGISTRY.has(k)
      );
      expect(unknownKeys).toEqual([]);
    });

    it('raft adhesion config', () => {
      const profile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, adhesionType: 'raft' };
      const config = buildOrcaConfig(profile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      const unknownKeys = Object.keys(config).filter(
        (k) => !ORCASLICER_CONFIG_KEY_REGISTRY.has(k)
      );
      expect(unknownKeys).toEqual([]);
    });

    it('none adhesion config', () => {
      const profile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, adhesionType: 'none' };
      const config = buildOrcaConfig(profile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      const unknownKeys = Object.keys(config).filter(
        (k) => !ORCASLICER_CONFIG_KEY_REGISTRY.has(k)
      );
      expect(unknownKeys).toEqual([]);
    });

    it('multi-extruder config', () => {
      const config = buildMultiExtruderConfig();
      const unknownKeys = Object.keys(config).filter(
        (k) => !ORCASLICER_CONFIG_KEY_REGISTRY.has(k)
      );
      expect(unknownKeys).toEqual([]);
    });

    it('default profile config', () => {
      const config = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      const unknownKeys = Object.keys(config).filter(
        (k) => !ORCASLICER_CONFIG_KEY_REGISTRY.has(k)
      );
      expect(unknownKeys).toEqual([]);
    });

    it('printable area from polygon vertices', () => {
      const printer: PrinterSettings = {
        ...DEFAULT_PRINTER,
        printableArea: [{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 220, y: 220 }, { x: 0, y: 220 }],
      };
      const config = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, printer, null, 1);
      const unknownKeys = Object.keys(config).filter(
        (k) => !ORCASLICER_CONFIG_KEY_REGISTRY.has(k)
      );
      expect(unknownKeys).toEqual([]);
    });

    it('origin-center bed', () => {
      const printer: PrinterSettings = { ...DEFAULT_PRINTER, originCenter: true };
      const config = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, printer, null, 1);
      const unknownKeys = Object.keys(config).filter(
        (k) => !ORCASLICER_CONFIG_KEY_REGISTRY.has(k)
      );
      expect(unknownKeys).toEqual([]);
    });
  });

  describe('no PrusaSlicer keys in output', () => {
    it('maximal config has no PrusaSlicer-only keys', () => {
      const config = buildMaximalConfig();
      const prusaKeys = Object.keys(config).filter(
        (k) => PRUSASLICER_KEYS_BLOCKLIST.has(k)
      );
      expect(prusaKeys).toEqual([]);
    });

    it('default config has no PrusaSlicer-only keys', () => {
      const config = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      const prusaKeys = Object.keys(config).filter(
        (k) => PRUSASLICER_KEYS_BLOCKLIST.has(k)
      );
      expect(prusaKeys).toEqual([]);
    });

    it('multi-extruder config has no PrusaSlicer-only keys', () => {
      const config = buildMultiExtruderConfig();
      const prusaKeys = Object.keys(config).filter(
        (k) => PRUSASLICER_KEYS_BLOCKLIST.has(k)
      );
      expect(prusaKeys).toEqual([]);
    });
  });

  describe('registry completeness — all registry keys are reachable', () => {
    it('every registry key is produced by at least one config variant', () => {
      // Collect all keys from multiple config variants
      const allProducedKeys = new Set<string>();

      // Default config
      const defaultConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      Object.keys(defaultConfig).forEach((k) => allProducedKeys.add(k));

      // Maximal config (most conditionals enabled)
      Object.keys(buildMaximalConfig()).forEach((k) => allProducedKeys.add(k));

      // Brim config (brim-specific keys)
      Object.keys(buildBrimConfig()).forEach((k) => allProducedKeys.add(k));

      // Multi-extruder (single_extruder_multi_material)
      Object.keys(buildMultiExtruderConfig()).forEach((k) => allProducedKeys.add(k));

      // Skirt config (skirt_distance)
      const skirtProfile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, adhesionType: 'skirt' };
      const skirtConfig = buildOrcaConfig(skirtProfile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      Object.keys(skirtConfig).forEach((k) => allProducedKeys.add(k));

      // With GCode (machine_start_gcode, machine_end_gcode, change_filament_gcode)
      const gcPrinter: PrinterSettings = {
        ...DEFAULT_PRINTER,
        startGcode: 'G28',
        endGcode: 'M84',
        toolChangeGcode: 'T{tool}',
      };
      const gcConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, gcPrinter, null, 1);
      Object.keys(gcConfig).forEach((k) => allProducedKeys.add(k));

      // With bed exclude areas
      const exPrinter: PrinterSettings = {
        ...DEFAULT_PRINTER,
        bedExcludeAreas: [{ x: 10, y: 10, width: 20, height: 20 }],
      };
      const exConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, exPrinter, null, 1);
      Object.keys(exConfig).forEach((k) => allProducedKeys.add(k));

      // With nozzle HRC
      const hrcPrinter: PrinterSettings = { ...DEFAULT_PRINTER, nozzleHRC: 55 };
      const hrcConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, hrcPrinter, null, 1);
      Object.keys(hrcConfig).forEach((k) => allProducedKeys.add(k));

      // With chamber temp
      const chamberPrinter: PrinterSettings = { ...DEFAULT_PRINTER, chamberTempControl: true };
      const chamberConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, chamberPrinter, null, 1);
      Object.keys(chamberConfig).forEach((k) => allProducedKeys.add(k));

      // With max volumetric speed
      const volPrinter: PrinterSettings = { ...DEFAULT_PRINTER, maxVolumetricSpeed: 15 };
      const volConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, volPrinter, null, 1);
      Object.keys(volConfig).forEach((k) => allProducedKeys.add(k));

      // With nozzle type
      const ntPrinter: PrinterSettings = { ...DEFAULT_PRINTER, nozzleType: 'brass' };
      const ntConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, ntPrinter, null, 1);
      Object.keys(ntConfig).forEach((k) => allProducedKeys.add(k));

      // With printer structure
      const psPrinter: PrinterSettings = { ...DEFAULT_PRINTER, printerStructureType: 'corexy' };
      const psConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, psPrinter, null, 1);
      Object.keys(psConfig).forEach((k) => allProducedKeys.add(k));

      // Overhang reverse
      const ohProfile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, overhangReverse: true };
      const ohConfig = buildOrcaConfig(ohProfile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      Object.keys(ohConfig).forEach((k) => allProducedKeys.add(k));

      // Fuzzy skin with noise type
      const fsProfile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, fuzzySkinMode: 'displacement' };
      const fsConfig = buildOrcaConfig(fsProfile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      Object.keys(fsConfig).forEach((k) => allProducedKeys.add(k));

      // Hole-to-polyhole
      const htpProfile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, holeToPolyhole: true };
      const htpConfig = buildOrcaConfig(htpProfile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      Object.keys(htpConfig).forEach((k) => allProducedKeys.add(k));

      // Make overhang printable
      const mopProfile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, makeOverhangPrintable: true };
      const mopConfig = buildOrcaConfig(mopProfile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      Object.keys(mopConfig).forEach((k) => allProducedKeys.add(k));

      // Arc fitting
      const afProfile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, arcFittingEnable: true };
      const afConfig = buildOrcaConfig(afProfile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      Object.keys(afConfig).forEach((k) => allProducedKeys.add(k));

      // Adaptive PA extras
      const apFilament: ResolvedFilamentSettings = { ...DEFAULT_FILAMENT, adaptivePressureAdvance: true };
      const apConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, apFilament, DEFAULT_PRINTER, null, 1);
      Object.keys(apConfig).forEach((k) => allProducedKeys.add(k));

      // Volumetric flow smoothing with segment length
      const vfsProfile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, maxVolumetricFlowSmoothingRate: 10 };
      const vfsConfig = buildOrcaConfig(vfsProfile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      Object.keys(vfsConfig).forEach((k) => allProducedKeys.add(k));

      // Support with density (support_base_pattern_spacing)
      const supProfile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, supportEnabled: true, supportDensity: 40 };
      const supConfig = buildOrcaConfig(supProfile, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
      Object.keys(supConfig).forEach((k) => allProducedKeys.add(k));

      // Printable area polygon
      const paPrinter: PrinterSettings = {
        ...DEFAULT_PRINTER,
        printableArea: [{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 220, y: 220 }, { x: 0, y: 220 }],
      };
      const paConfig = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, paPrinter, null, 1);
      Object.keys(paConfig).forEach((k) => allProducedKeys.add(k));

      // Check: every registry key must be reachable
      const unreachableKeys = [...ORCASLICER_CONFIG_KEY_REGISTRY].filter(
        (k) => !allProducedKeys.has(k)
      );
      expect(unreachableKeys).toEqual([]);
    });
  });

  describe('registry size tracking', () => {
    it('registry contains the expected number of keys', () => {
      // Update this count when adding new keys to the registry.
      // This catches accidental additions/removals.
      expect(ORCASLICER_CONFIG_KEY_REGISTRY.size).toBe(218);
    });
  });
});
