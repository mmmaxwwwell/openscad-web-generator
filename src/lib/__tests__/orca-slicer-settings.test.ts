// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Exhaustive tests for buildOrcaConfig() — OrcaSlicer config key mapping.
 *
 * One describe block per category (Quality, Walls, Infill, Speed, Support,
 * Adhesion, Retraction, Cooling/Filament, Advanced, Printer).
 * One it() per config key mapping.
 * Tests default values, edge cases, enum values, multi-extruder replication,
 * and Klipper GCode conversion.
 */

import { describe, it, expect } from 'vitest';
import { buildOrcaConfig, convertKlipperToOrcaGcode } from '../orca-slicer-settings';
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

/** Helper: build config with defaults, overriding profile fields */
function buildWithProfile(overrides: Partial<PrintProfile> = {}): Record<string, string> {
  return buildOrcaConfig(
    { ...DEFAULT_PRINT_PROFILE, ...overrides },
    DEFAULT_FILAMENT,
    DEFAULT_PRINTER,
    null,
    1,
  );
}

/** Helper: build config with filament overrides */
function buildWithFilament(overrides: Partial<ResolvedFilamentSettings> = {}): Record<string, string> {
  return buildOrcaConfig(
    DEFAULT_PRINT_PROFILE,
    { ...DEFAULT_FILAMENT, ...overrides },
    DEFAULT_PRINTER,
    null,
    1,
  );
}

/** Helper: build config with printer overrides */
function buildWithPrinter(overrides: Partial<PrinterSettings> = {}): Record<string, string> {
  return buildOrcaConfig(
    DEFAULT_PRINT_PROFILE,
    DEFAULT_FILAMENT,
    { ...DEFAULT_PRINTER, ...overrides },
    null,
    1,
  );
}

// ================================================================
// QUALITY — Layer Heights & Line Widths
// ================================================================

describe('Quality — Layer Height', () => {
  it('maps layerHeight to layer_height', () => {
    const c = buildWithProfile({ layerHeight: 0.2 });
    expect(c['layer_height']).toBe('0.2');
  });

  it('maps initialLayerPrintHeight to initial_layer_print_height', () => {
    const c = buildWithProfile({ initialLayerPrintHeight: 0.3 });
    expect(c['initial_layer_print_height']).toBe('0.3');
  });

  it('maps adaptiveLayerHeight to adaptive_layer_height', () => {
    expect(buildWithProfile({ adaptiveLayerHeight: true })['adaptive_layer_height']).toBe('1');
    expect(buildWithProfile({ adaptiveLayerHeight: false })['adaptive_layer_height']).toBe('0');
  });

  it('maps preciseZHeight to precise_z_height', () => {
    expect(buildWithProfile({ preciseZHeight: true })['precise_z_height']).toBe('1');
    expect(buildWithProfile({ preciseZHeight: false })['precise_z_height']).toBe('0');
  });

  it('handles minimum layer height', () => {
    const c = buildWithProfile({ layerHeight: 0.05 });
    expect(c['layer_height']).toBe('0.05');
  });

  it('handles maximum layer height', () => {
    const c = buildWithProfile({ layerHeight: 0.6 });
    expect(c['layer_height']).toBe('0.6');
  });
});

describe('Quality — Line Widths', () => {
  it('maps lineWidth to line_width', () => {
    expect(buildWithProfile({ lineWidth: 0.4 })['line_width']).toBe('0.4');
  });

  it('maps outerWallLineWidth to outer_wall_line_width', () => {
    expect(buildWithProfile({ outerWallLineWidth: 0.45 })['outer_wall_line_width']).toBe('0.45');
  });

  it('maps innerWallLineWidth to inner_wall_line_width', () => {
    expect(buildWithProfile({ innerWallLineWidth: 0.42 })['inner_wall_line_width']).toBe('0.42');
  });

  it('maps topSurfaceLineWidth to top_surface_line_width', () => {
    expect(buildWithProfile({ topSurfaceLineWidth: 0.38 })['top_surface_line_width']).toBe('0.38');
  });

  it('maps internalSolidInfillLineWidth to internal_solid_infill_line_width', () => {
    expect(buildWithProfile({ internalSolidInfillLineWidth: 0.44 })['internal_solid_infill_line_width']).toBe('0.44');
  });

  it('maps sparseInfillLineWidth to sparse_infill_line_width', () => {
    expect(buildWithProfile({ sparseInfillLineWidth: 0.46 })['sparse_infill_line_width']).toBe('0.46');
  });

  it('maps supportLineWidth to support_line_width', () => {
    expect(buildWithProfile({ supportLineWidth: 0.4 })['support_line_width']).toBe('0.4');
  });

  it('maps initialLayerLineWidth to initial_layer_line_width', () => {
    expect(buildWithProfile({ initialLayerLineWidth: 0.5 })['initial_layer_line_width']).toBe('0.5');
  });

  it('uses 0 for auto line widths', () => {
    const c = buildWithProfile({
      outerWallLineWidth: 0,
      innerWallLineWidth: 0,
      sparseInfillLineWidth: 0,
    });
    expect(c['outer_wall_line_width']).toBe('0');
    expect(c['inner_wall_line_width']).toBe('0');
    expect(c['sparse_infill_line_width']).toBe('0');
  });
});

describe('Quality — Seam', () => {
  it('maps seamPosition nearest', () => {
    expect(buildWithProfile({ seamPosition: 'nearest' })['seam_position']).toBe('nearest');
  });

  it('maps seamPosition aligned', () => {
    expect(buildWithProfile({ seamPosition: 'aligned' })['seam_position']).toBe('aligned');
  });

  it('maps seamPosition back', () => {
    expect(buildWithProfile({ seamPosition: 'back' })['seam_position']).toBe('back');
  });

  it('maps seamPosition random', () => {
    expect(buildWithProfile({ seamPosition: 'random' })['seam_position']).toBe('random');
  });

  it('maps seamGap to seam_gap', () => {
    expect(buildWithProfile({ seamGap: 0.15 })['seam_gap']).toBe('0.15');
  });

  it('maps staggeredInnerSeams to staggered_inner_seams', () => {
    expect(buildWithProfile({ staggeredInnerSeams: true })['staggered_inner_seams']).toBe('1');
    expect(buildWithProfile({ staggeredInnerSeams: false })['staggered_inner_seams']).toBe('0');
  });
});

describe('Quality — Scarf Joint Seam', () => {
  it('maps seamScarfType none', () => {
    expect(buildWithProfile({ seamScarfType: 'none' })['seam_slope_type']).toBe('none');
  });

  it('maps seamScarfType external', () => {
    expect(buildWithProfile({ seamScarfType: 'external' })['seam_slope_type']).toBe('external');
  });

  it('maps seamScarfType all', () => {
    expect(buildWithProfile({ seamScarfType: 'all' })['seam_slope_type']).toBe('all');
  });

  it('maps scarfSlopeConditional to seam_slope_conditional', () => {
    expect(buildWithProfile({ scarfSlopeConditional: true })['seam_slope_conditional']).toBe('1');
  });

  it('maps scarfAngleThreshold to scarf_angle_threshold', () => {
    expect(buildWithProfile({ scarfAngleThreshold: 155 })['scarf_angle_threshold']).toBe('155');
  });

  it('maps scarfOverhangThreshold to scarf_overhang_threshold with % suffix', () => {
    expect(buildWithProfile({ scarfOverhangThreshold: 40 })['scarf_overhang_threshold']).toBe('40%');
  });

  it('maps scarfJointSpeed to scarf_joint_speed', () => {
    expect(buildWithProfile({ scarfJointSpeed: 50 })['scarf_joint_speed']).toBe('50');
  });

  it('maps scarfJointFlowRatio to scarf_joint_flow_ratio', () => {
    expect(buildWithProfile({ scarfJointFlowRatio: 0.95 })['scarf_joint_flow_ratio']).toBe('0.95');
  });

  it('maps scarfStartHeight to seam_slope_start_height', () => {
    expect(buildWithProfile({ scarfStartHeight: 0.5 })['seam_slope_start_height']).toBe('0.5');
  });

  it('maps scarfEntireLoop to seam_slope_entire_loop', () => {
    expect(buildWithProfile({ scarfEntireLoop: true })['seam_slope_entire_loop']).toBe('1');
  });

  it('maps scarfMinLength to seam_slope_min_length', () => {
    expect(buildWithProfile({ scarfMinLength: 15 })['seam_slope_min_length']).toBe('15');
  });

  it('maps scarfSteps to seam_slope_steps', () => {
    expect(buildWithProfile({ scarfSteps: 10 })['seam_slope_steps']).toBe('10');
  });

  it('maps scarfInnerWalls to seam_slope_inner_walls', () => {
    expect(buildWithProfile({ scarfInnerWalls: true })['seam_slope_inner_walls']).toBe('1');
  });

  it('maps scarfHasScarf to has_scarf_joint_seam', () => {
    expect(buildWithProfile({ scarfHasScarf: true })['has_scarf_joint_seam']).toBe('1');
    expect(buildWithProfile({ scarfHasScarf: false })['has_scarf_joint_seam']).toBe('0');
  });
});

// ================================================================
// WALLS
// ================================================================

describe('Walls', () => {
  it('maps wallLoops to wall_loops', () => {
    expect(buildWithProfile({ wallLoops: 3 })['wall_loops']).toBe('3');
  });

  it('maps wallLoops edge: 1', () => {
    expect(buildWithProfile({ wallLoops: 1 })['wall_loops']).toBe('1');
  });

  it('maps wallLoops edge: 20', () => {
    expect(buildWithProfile({ wallLoops: 20 })['wall_loops']).toBe('20');
  });

  it('maps wallSequence inner_outer', () => {
    expect(buildWithProfile({ wallSequence: 'inner_outer' })['wall_sequence']).toBe('inner wall/outer wall');
  });

  it('maps wallSequence outer_inner', () => {
    expect(buildWithProfile({ wallSequence: 'outer_inner' })['wall_sequence']).toBe('outer wall/inner wall');
  });

  it('maps wallSequence inner_outer_inner', () => {
    expect(buildWithProfile({ wallSequence: 'inner_outer_inner' })['wall_sequence']).toBe('inner-outer-inner wall');
  });

  it('maps wallGenerator classic', () => {
    expect(buildWithProfile({ wallGenerator: 'classic' })['wall_generator']).toBe('classic');
  });

  it('maps wallGenerator arachne', () => {
    expect(buildWithProfile({ wallGenerator: 'arachne' })['wall_generator']).toBe('arachne');
  });

  it('maps preciseOuterWall to precise_outer_wall', () => {
    expect(buildWithProfile({ preciseOuterWall: true })['precise_outer_wall']).toBe('1');
    expect(buildWithProfile({ preciseOuterWall: false })['precise_outer_wall']).toBe('0');
  });

  it('maps detectThinWall to detect_thin_wall', () => {
    expect(buildWithProfile({ detectThinWall: true })['detect_thin_wall']).toBe('1');
  });

  it('maps detectOverhangWall to detect_overhang_wall', () => {
    expect(buildWithProfile({ detectOverhangWall: true })['detect_overhang_wall']).toBe('1');
  });

  it('maps onlyOneWallFirstLayer to only_one_wall_first_layer', () => {
    expect(buildWithProfile({ onlyOneWallFirstLayer: true })['only_one_wall_first_layer']).toBe('1');
  });

  it('maps onlyOneWallTop to only_one_wall_top', () => {
    expect(buildWithProfile({ onlyOneWallTop: true })['only_one_wall_top']).toBe('1');
  });

  it('maps extraPerimetersOnOverhangs to extra_perimeters_on_overhangs', () => {
    expect(buildWithProfile({ extraPerimetersOnOverhangs: true })['extra_perimeters_on_overhangs']).toBe('1');
  });

  it('maps slowdownForCurledPerimeters to slowdown_for_curled_perimeters', () => {
    expect(buildWithProfile({ slowdownForCurledPerimeters: true })['slowdown_for_curled_perimeters']).toBe('1');
    expect(buildWithProfile({ slowdownForCurledPerimeters: false })['slowdown_for_curled_perimeters']).toBe('0');
  });

  it('maps topLayers to top_shell_layers', () => {
    expect(buildWithProfile({ topLayers: 4 })['top_shell_layers']).toBe('4');
  });

  it('maps bottomLayers to bottom_shell_layers', () => {
    expect(buildWithProfile({ bottomLayers: 4 })['bottom_shell_layers']).toBe('4');
  });

  it('maps topLayers edge: 0', () => {
    expect(buildWithProfile({ topLayers: 0 })['top_shell_layers']).toBe('0');
  });

  it('maps wallDirection auto', () => {
    expect(buildWithProfile({ wallDirection: 'auto' })['wall_direction']).toBe('auto');
  });

  it('maps wallDirection ccw', () => {
    expect(buildWithProfile({ wallDirection: 'ccw' })['wall_direction']).toBe('ccw');
  });

  it('maps wallDirection cw', () => {
    expect(buildWithProfile({ wallDirection: 'cw' })['wall_direction']).toBe('cw');
  });

  it('maps isInfillFirst to is_infill_first', () => {
    expect(buildWithProfile({ isInfillFirst: true })['is_infill_first']).toBe('1');
    expect(buildWithProfile({ isInfillFirst: false })['is_infill_first']).toBe('0');
  });

  it('maps ensureVerticalShellThickness none', () => {
    expect(buildWithProfile({ ensureVerticalShellThickness: 'none' })['ensure_vertical_shell_thickness']).toBe('none');
  });

  it('maps ensureVerticalShellThickness ensure_critical_only', () => {
    expect(buildWithProfile({ ensureVerticalShellThickness: 'ensure_critical_only' })['ensure_vertical_shell_thickness']).toBe('ensure_critical_only');
  });

  it('maps ensureVerticalShellThickness ensure_moderate', () => {
    expect(buildWithProfile({ ensureVerticalShellThickness: 'ensure_moderate' })['ensure_vertical_shell_thickness']).toBe('ensure_moderate');
  });

  it('maps ensureVerticalShellThickness ensure_all', () => {
    expect(buildWithProfile({ ensureVerticalShellThickness: 'ensure_all' })['ensure_vertical_shell_thickness']).toBe('ensure_all');
  });
});

describe('Walls — Arachne Settings', () => {
  it('maps minBeadWidth with % suffix', () => {
    expect(buildWithProfile({ minBeadWidth: 85 })['min_bead_width']).toBe('85%');
  });

  it('maps minFeatureSize with % suffix', () => {
    expect(buildWithProfile({ minFeatureSize: 25 })['min_feature_size']).toBe('25%');
  });

  it('maps wallTransitionAngle to wall_transition_angle', () => {
    expect(buildWithProfile({ wallTransitionAngle: 10 })['wall_transition_angle']).toBe('10');
  });

  it('maps wallTransitionFilterDeviation with % suffix', () => {
    expect(buildWithProfile({ wallTransitionFilterDeviation: 25 })['wall_transition_filter_deviation']).toBe('25%');
  });

  it('maps wallTransitionLength with % suffix', () => {
    expect(buildWithProfile({ wallTransitionLength: 100 })['wall_transition_length']).toBe('100%');
  });

  it('maps wallDistributionCount to wall_distribution_count', () => {
    expect(buildWithProfile({ wallDistributionCount: 1 })['wall_distribution_count']).toBe('1');
  });
});

// ================================================================
// INFILL
// ================================================================

describe('Infill', () => {
  it('maps sparseInfillPattern to sparse_infill_pattern', () => {
    expect(buildWithProfile({ sparseInfillPattern: 'gyroid' })['sparse_infill_pattern']).toBe('gyroid');
  });

  it('maps all 28 infill patterns', () => {
    const patterns = [
      'monotonic', 'monotonicline', 'rectilinear', 'alignedrectilinear',
      'zigzag', 'crosszag', 'lockedzag',
      'line', 'grid', 'triangles', 'tri-hexagon', 'cubic',
      'adaptivecubic', 'quartercubic', 'supportcubic', 'lightning',
      'honeycomb', '3dhoneycomb', 'lateral-honeycomb', 'lateral-lattice',
      'crosshatch', 'tpmsd', 'tpmsfk',
      'gyroid', 'concentric',
      'hilbertcurve', 'archimedeanchords', 'octagramspiral',
    ] as const;
    for (const pattern of patterns) {
      const c = buildWithProfile({ sparseInfillPattern: pattern });
      expect(c['sparse_infill_pattern']).toBe(pattern);
    }
  });

  it('maps sparseInfillDensity with % suffix', () => {
    expect(buildWithProfile({ sparseInfillDensity: 15 })['sparse_infill_density']).toBe('15%');
  });

  it('maps 0% infill density', () => {
    expect(buildWithProfile({ sparseInfillDensity: 0 })['sparse_infill_density']).toBe('0%');
  });

  it('maps 100% infill density', () => {
    expect(buildWithProfile({ sparseInfillDensity: 100 })['sparse_infill_density']).toBe('100%');
  });

  it('maps infillAngle to infill_direction', () => {
    expect(buildWithProfile({ infillAngle: 45 })['infill_direction']).toBe('45');
  });

  it('maps infillOverlap with % suffix', () => {
    expect(buildWithProfile({ infillOverlap: 25 })['infill_wall_overlap']).toBe('25%');
  });

  it('maps infillOverlap 0%', () => {
    expect(buildWithProfile({ infillOverlap: 0 })['infill_wall_overlap']).toBe('0%');
  });

  it('maps infillCombination to infill_combination', () => {
    expect(buildWithProfile({ infillCombination: true })['infill_combination']).toBe('1');
    expect(buildWithProfile({ infillCombination: false })['infill_combination']).toBe('0');
  });

  it('maps topSurfacePattern to top_surface_pattern', () => {
    expect(buildWithProfile({ topSurfacePattern: 'monotonicline' })['top_surface_pattern']).toBe('monotonicline');
    expect(buildWithProfile({ topSurfacePattern: 'concentric' })['top_surface_pattern']).toBe('concentric');
  });

  it('maps bottomSurfacePattern to bottom_surface_pattern', () => {
    expect(buildWithProfile({ bottomSurfacePattern: 'monotonic' })['bottom_surface_pattern']).toBe('monotonic');
    expect(buildWithProfile({ bottomSurfacePattern: 'rectilinear' })['bottom_surface_pattern']).toBe('rectilinear');
  });

  it('maps internalSolidInfillPattern to internal_solid_infill_pattern', () => {
    expect(buildWithProfile({ internalSolidInfillPattern: 'monotonic' })['internal_solid_infill_pattern']).toBe('monotonic');
    expect(buildWithProfile({ internalSolidInfillPattern: 'grid' })['internal_solid_infill_pattern']).toBe('grid');
  });

  it('maps bridgeFlow to bridge_flow', () => {
    expect(buildWithProfile({ bridgeFlow: 1.0 })['bridge_flow']).toBe('1');
    expect(buildWithProfile({ bridgeFlow: 0.8 })['bridge_flow']).toBe('0.8');
  });

  it('maps internalBridgeFlow to internal_bridge_flow', () => {
    expect(buildWithProfile({ internalBridgeFlow: 1.0 })['internal_bridge_flow']).toBe('1');
    expect(buildWithProfile({ internalBridgeFlow: 1.1 })['internal_bridge_flow']).toBe('1.1');
  });

  it('maps bridgeDensity with % suffix', () => {
    expect(buildWithProfile({ bridgeDensity: 100 })['bridge_density']).toBe('100%');
    expect(buildWithProfile({ bridgeDensity: 50 })['bridge_density']).toBe('50%');
  });

  it('maps internalBridgeDensity with % suffix', () => {
    expect(buildWithProfile({ internalBridgeDensity: 100 })['internal_bridge_density']).toBe('100%');
    expect(buildWithProfile({ internalBridgeDensity: 75 })['internal_bridge_density']).toBe('75%');
  });

  it('maps bridgeAngle to bridge_angle', () => {
    expect(buildWithProfile({ bridgeAngle: 0 })['bridge_angle']).toBe('0');
    expect(buildWithProfile({ bridgeAngle: 45 })['bridge_angle']).toBe('45');
  });

  it('maps internalBridgeAngle to internal_bridge_angle', () => {
    expect(buildWithProfile({ internalBridgeAngle: 0 })['internal_bridge_angle']).toBe('0');
    expect(buildWithProfile({ internalBridgeAngle: 90 })['internal_bridge_angle']).toBe('90');
  });
});

// ================================================================
// SPEED
// ================================================================

describe('Speed — Per-feature speeds', () => {
  it('maps outerWallSpeed to outer_wall_speed', () => {
    expect(buildWithProfile({ outerWallSpeed: 120 })['outer_wall_speed']).toBe('120');
  });

  it('maps innerWallSpeed to inner_wall_speed', () => {
    expect(buildWithProfile({ innerWallSpeed: 180 })['inner_wall_speed']).toBe('180');
  });

  it('maps topSurfaceSpeed to top_surface_speed', () => {
    expect(buildWithProfile({ topSurfaceSpeed: 100 })['top_surface_speed']).toBe('100');
  });

  it('maps internalSolidInfillSpeed to internal_solid_infill_speed', () => {
    expect(buildWithProfile({ internalSolidInfillSpeed: 200 })['internal_solid_infill_speed']).toBe('200');
  });

  it('maps sparseInfillSpeed to sparse_infill_speed', () => {
    expect(buildWithProfile({ sparseInfillSpeed: 200 })['sparse_infill_speed']).toBe('200');
  });

  it('maps gapFillSpeed to gap_infill_speed', () => {
    expect(buildWithProfile({ gapFillSpeed: 50 })['gap_infill_speed']).toBe('50');
  });

  it('maps supportSpeed to support_speed', () => {
    expect(buildWithProfile({ supportSpeed: 150 })['support_speed']).toBe('150');
  });

  it('maps bridgeSpeed to bridge_speed', () => {
    expect(buildWithProfile({ bridgeSpeed: 30 })['bridge_speed']).toBe('30');
  });

  it('maps internalBridgeSpeed to internal_bridge_speed', () => {
    expect(buildWithProfile({ internalBridgeSpeed: 100 })['internal_bridge_speed']).toBe('100');
  });

  it('maps smallPerimeterSpeed to small_perimeter_speed', () => {
    expect(buildWithProfile({ smallPerimeterSpeed: 50 })['small_perimeter_speed']).toBe('50');
  });

  it('maps smallPerimeterThreshold to small_perimeter_threshold', () => {
    expect(buildWithProfile({ smallPerimeterThreshold: 6.5 })['small_perimeter_threshold']).toBe('6.5');
  });

  it('maps initialLayerSpeed to initial_layer_speed', () => {
    expect(buildWithProfile({ initialLayerSpeed: 30 })['initial_layer_speed']).toBe('30');
  });

  it('maps initialLayerInfillSpeed to initial_layer_infill_speed', () => {
    expect(buildWithProfile({ initialLayerInfillSpeed: 80 })['initial_layer_infill_speed']).toBe('80');
  });

  it('maps initialLayerTravelSpeed to initial_layer_travel_speed', () => {
    expect(buildWithProfile({ initialLayerTravelSpeed: 100 })['initial_layer_travel_speed']).toBe('100');
  });

  it('maps skirtSpeed to skirt_speed', () => {
    expect(buildWithProfile({ skirtSpeed: 30 })['skirt_speed']).toBe('30');
  });

  it('maps travelSpeed to travel_speed', () => {
    expect(buildWithProfile({ travelSpeed: 300 })['travel_speed']).toBe('300');
  });
});

describe('Speed — Overhang Speed', () => {
  it('maps enableOverhangSpeed to enable_overhang_speed', () => {
    expect(buildWithProfile({ enableOverhangSpeed: true })['enable_overhang_speed']).toBe('1');
    expect(buildWithProfile({ enableOverhangSpeed: false })['enable_overhang_speed']).toBe('0');
  });

  it('maps overhang1_4Speed to overhang_1_4_speed', () => {
    expect(buildWithProfile({ overhang1_4Speed: 0 })['overhang_1_4_speed']).toBe('0');
    expect(buildWithProfile({ overhang1_4Speed: 30 })['overhang_1_4_speed']).toBe('30');
  });

  it('maps overhang2_4Speed to overhang_2_4_speed', () => {
    expect(buildWithProfile({ overhang2_4Speed: 0 })['overhang_2_4_speed']).toBe('0');
    expect(buildWithProfile({ overhang2_4Speed: 25 })['overhang_2_4_speed']).toBe('25');
  });

  it('maps overhang3_4Speed to overhang_3_4_speed', () => {
    expect(buildWithProfile({ overhang3_4Speed: 0 })['overhang_3_4_speed']).toBe('0');
    expect(buildWithProfile({ overhang3_4Speed: 15 })['overhang_3_4_speed']).toBe('15');
  });

  it('maps overhang4_4Speed to overhang_4_4_speed', () => {
    expect(buildWithProfile({ overhang4_4Speed: 0 })['overhang_4_4_speed']).toBe('0');
    expect(buildWithProfile({ overhang4_4Speed: 10 })['overhang_4_4_speed']).toBe('10');
  });
});

describe('Speed — Accelerations', () => {
  it('maps defaultAcceleration to default_acceleration', () => {
    expect(buildWithProfile({ defaultAcceleration: 5000 })['default_acceleration']).toBe('5000');
  });

  it('maps outerWallAcceleration to outer_wall_acceleration', () => {
    expect(buildWithProfile({ outerWallAcceleration: 2000 })['outer_wall_acceleration']).toBe('2000');
  });

  it('maps innerWallAcceleration to inner_wall_acceleration', () => {
    expect(buildWithProfile({ innerWallAcceleration: 5000 })['inner_wall_acceleration']).toBe('5000');
  });

  it('maps topSurfaceAcceleration to top_surface_acceleration', () => {
    expect(buildWithProfile({ topSurfaceAcceleration: 2000 })['top_surface_acceleration']).toBe('2000');
  });

  it('maps bridgeAcceleration to bridge_acceleration', () => {
    expect(buildWithProfile({ bridgeAcceleration: 1000 })['bridge_acceleration']).toBe('1000');
  });

  it('maps sparseInfillAcceleration to sparse_infill_acceleration', () => {
    expect(buildWithProfile({ sparseInfillAcceleration: 5000 })['sparse_infill_acceleration']).toBe('5000');
  });

  it('maps internalSolidInfillAcceleration to internal_solid_infill_acceleration', () => {
    expect(buildWithProfile({ internalSolidInfillAcceleration: 5000 })['internal_solid_infill_acceleration']).toBe('5000');
  });

  it('maps initialLayerAcceleration to initial_layer_acceleration', () => {
    expect(buildWithProfile({ initialLayerAcceleration: 1000 })['initial_layer_acceleration']).toBe('1000');
  });

  it('maps travelAcceleration to travel_acceleration', () => {
    expect(buildWithProfile({ travelAcceleration: 5000 })['travel_acceleration']).toBe('5000');
  });

  it('maps 0 acceleration (printer default)', () => {
    expect(buildWithProfile({ defaultAcceleration: 0 })['default_acceleration']).toBe('0');
  });
});

describe('Speed — Jerk', () => {
  it('maps defaultJerk to default_jerk', () => {
    expect(buildWithProfile({ defaultJerk: 8 })['default_jerk']).toBe('8');
  });

  it('maps outerWallJerk to outer_wall_jerk', () => {
    expect(buildWithProfile({ outerWallJerk: 5 })['outer_wall_jerk']).toBe('5');
  });

  it('maps innerWallJerk to inner_wall_jerk', () => {
    expect(buildWithProfile({ innerWallJerk: 8 })['inner_wall_jerk']).toBe('8');
  });

  it('maps topSurfaceJerk to top_surface_jerk', () => {
    expect(buildWithProfile({ topSurfaceJerk: 5 })['top_surface_jerk']).toBe('5');
  });

  it('maps infillJerk to infill_jerk', () => {
    expect(buildWithProfile({ infillJerk: 10 })['infill_jerk']).toBe('10');
  });

  it('maps travelJerk to travel_jerk', () => {
    expect(buildWithProfile({ travelJerk: 15 })['travel_jerk']).toBe('15');
  });

  it('maps initialLayerJerk to initial_layer_jerk', () => {
    expect(buildWithProfile({ initialLayerJerk: 5 })['initial_layer_jerk']).toBe('5');
  });

  it('maps 0 jerk (printer default)', () => {
    expect(buildWithProfile({ defaultJerk: 0 })['default_jerk']).toBe('0');
    expect(buildWithProfile({ outerWallJerk: 0 })['outer_wall_jerk']).toBe('0');
  });
});

describe('Speed — Accel-to-Decel', () => {
  it('maps accelToDecelEnable to accel_to_decel_enable', () => {
    expect(buildWithProfile({ accelToDecelEnable: true })['accel_to_decel_enable']).toBe('1');
    expect(buildWithProfile({ accelToDecelEnable: false })['accel_to_decel_enable']).toBe('0');
  });

  it('maps accelToDecelFactor with % suffix', () => {
    expect(buildWithProfile({ accelToDecelFactor: 50 })['accel_to_decel_factor']).toBe('50%');
  });

  it('maps accelToDecelFactor edge: 0%', () => {
    expect(buildWithProfile({ accelToDecelFactor: 0 })['accel_to_decel_factor']).toBe('0%');
  });

  it('maps accelToDecelFactor edge: 100%', () => {
    expect(buildWithProfile({ accelToDecelFactor: 100 })['accel_to_decel_factor']).toBe('100%');
  });
});

// ================================================================
// SUPPORT
// ================================================================

describe('Support', () => {
  it('maps supportEnabled to enable_support', () => {
    expect(buildWithProfile({ supportEnabled: true })['enable_support']).toBe('1');
    expect(buildWithProfile({ supportEnabled: false })['enable_support']).toBe('0');
  });

  it('maps supportType normal_auto', () => {
    expect(buildWithProfile({ supportType: 'normal_auto' })['support_type']).toBe('normal(auto)');
  });

  it('maps supportType tree_auto', () => {
    expect(buildWithProfile({ supportType: 'tree_auto' })['support_type']).toBe('tree(auto)');
  });

  it('maps supportType normal_manual', () => {
    expect(buildWithProfile({ supportType: 'normal_manual' })['support_type']).toBe('normal(manual)');
  });

  it('maps supportType tree_manual', () => {
    expect(buildWithProfile({ supportType: 'tree_manual' })['support_type']).toBe('tree(manual)');
  });

  it('maps supportThresholdAngle to support_threshold_angle', () => {
    expect(buildWithProfile({ supportThresholdAngle: 45 })['support_threshold_angle']).toBe('45');
  });

  it('maps supportThresholdAngle edge: 0', () => {
    expect(buildWithProfile({ supportThresholdAngle: 0 })['support_threshold_angle']).toBe('0');
  });

  it('maps supportThresholdAngle edge: 90', () => {
    expect(buildWithProfile({ supportThresholdAngle: 90 })['support_threshold_angle']).toBe('90');
  });

  it('maps supportXYOffset to support_object_xy_distance', () => {
    expect(buildWithProfile({ supportXYOffset: 0.3 })['support_object_xy_distance']).toBe('0.3');
  });

  it('maps supportZGap multiplied by layerHeight to support_top_z_distance', () => {
    const c = buildWithProfile({ supportZGap: 2, layerHeight: 0.2 });
    expect(c['support_top_z_distance']).toBe(String(2 * 0.2));
  });

  it('maps supportOnBuildPlateOnly to support_on_build_plate_only', () => {
    expect(buildWithProfile({ supportOnBuildPlateOnly: true })['support_on_build_plate_only']).toBe('1');
    expect(buildWithProfile({ supportOnBuildPlateOnly: false })['support_on_build_plate_only']).toBe('0');
  });

  it('maps supportInterfaceLayers to support_interface_top_layers', () => {
    expect(buildWithProfile({ supportInterfaceLayers: 3 })['support_interface_top_layers']).toBe('3');
  });

  it('computes support_base_pattern_spacing from density > 0', () => {
    const c = buildWithProfile({
      supportDensity: 50,
      supportLineWidth: 0.4,
      lineWidth: 0.4,
    });
    // spacing = 0.4 / (50/100) = 0.8
    expect(c['support_base_pattern_spacing']).toBe('0.8');
  });

  it('uses lineWidth for spacing when supportLineWidth is 0', () => {
    const c = buildWithProfile({
      supportDensity: 25,
      supportLineWidth: 0,
      lineWidth: 0.4,
    });
    // spacing = 0.4 / (25/100) = 1.6
    expect(c['support_base_pattern_spacing']).toBe('1.6');
  });

  it('does not set support_base_pattern_spacing when density is 0', () => {
    const c = buildWithProfile({ supportDensity: 0 });
    expect(c['support_base_pattern_spacing']).toBeUndefined();
  });

  it('maps supportStyle default', () => {
    expect(buildWithProfile({ supportStyle: 'default' })['support_style']).toBe('default');
  });

  it('maps supportStyle grid', () => {
    expect(buildWithProfile({ supportStyle: 'grid' })['support_style']).toBe('grid');
  });

  it('maps supportStyle snug', () => {
    expect(buildWithProfile({ supportStyle: 'snug' })['support_style']).toBe('snug');
  });

  it('maps supportStyle tree_slim', () => {
    expect(buildWithProfile({ supportStyle: 'tree_slim' })['support_style']).toBe('tree_slim');
  });

  it('maps supportStyle tree_strong', () => {
    expect(buildWithProfile({ supportStyle: 'tree_strong' })['support_style']).toBe('tree_strong');
  });

  it('maps supportStyle tree_hybrid', () => {
    expect(buildWithProfile({ supportStyle: 'tree_hybrid' })['support_style']).toBe('tree_hybrid');
  });

  it('maps supportStyle organic', () => {
    expect(buildWithProfile({ supportStyle: 'organic' })['support_style']).toBe('organic');
  });

  it('maps supportBasePattern default', () => {
    expect(buildWithProfile({ supportBasePattern: 'default' })['support_base_pattern']).toBe('default');
  });

  it('maps supportBasePattern rectilinear', () => {
    expect(buildWithProfile({ supportBasePattern: 'rectilinear' })['support_base_pattern']).toBe('rectilinear');
  });

  it('maps supportBasePattern rectilinear-grid', () => {
    expect(buildWithProfile({ supportBasePattern: 'rectilinear-grid' })['support_base_pattern']).toBe('rectilinear-grid');
  });

  it('maps supportBasePattern honeycomb', () => {
    expect(buildWithProfile({ supportBasePattern: 'honeycomb' })['support_base_pattern']).toBe('honeycomb');
  });

  it('maps supportBasePattern lightning', () => {
    expect(buildWithProfile({ supportBasePattern: 'lightning' })['support_base_pattern']).toBe('lightning');
  });

  it('maps supportBasePattern hollow', () => {
    expect(buildWithProfile({ supportBasePattern: 'hollow' })['support_base_pattern']).toBe('hollow');
  });

  it('maps supportInterfacePattern auto', () => {
    expect(buildWithProfile({ supportInterfacePattern: 'auto' })['support_interface_pattern']).toBe('auto');
  });

  it('maps supportInterfacePattern rectilinear', () => {
    expect(buildWithProfile({ supportInterfacePattern: 'rectilinear' })['support_interface_pattern']).toBe('rectilinear');
  });

  it('maps supportInterfacePattern concentric', () => {
    expect(buildWithProfile({ supportInterfacePattern: 'concentric' })['support_interface_pattern']).toBe('concentric');
  });

  it('maps supportInterfacePattern rectilinear_interlaced', () => {
    expect(buildWithProfile({ supportInterfacePattern: 'rectilinear_interlaced' })['support_interface_pattern']).toBe('rectilinear_interlaced');
  });

  it('maps supportInterfacePattern grid', () => {
    expect(buildWithProfile({ supportInterfacePattern: 'grid' })['support_interface_pattern']).toBe('grid');
  });

  it('maps supportInterfaceSpacing to support_interface_spacing', () => {
    expect(buildWithProfile({ supportInterfaceSpacing: 0 })['support_interface_spacing']).toBe('0');
    expect(buildWithProfile({ supportInterfaceSpacing: 0.5 })['support_interface_spacing']).toBe('0.5');
  });

  it('maps supportInterfaceSpeed to support_interface_speed', () => {
    expect(buildWithProfile({ supportInterfaceSpeed: 0 })['support_interface_speed']).toBe('0');
    expect(buildWithProfile({ supportInterfaceSpeed: 80 })['support_interface_speed']).toBe('80');
  });

  it('maps supportInterfaceBottomLayers to support_interface_bottom_layers as integer', () => {
    expect(buildWithProfile({ supportInterfaceBottomLayers: 0 })['support_interface_bottom_layers']).toBe('0');
    expect(buildWithProfile({ supportInterfaceBottomLayers: 3 })['support_interface_bottom_layers']).toBe('3');
  });
});

// ================================================================
// ADHESION
// ================================================================

describe('Adhesion', () => {
  it('sets skirt config for adhesionType skirt', () => {
    const c = buildWithProfile({
      adhesionType: 'skirt',
      skirtCount: 3,
      skirtDistance: 2,
    });
    expect(c['skirt_loops']).toBe('3');
    expect(c['skirt_distance']).toBe('2');
    expect(c['brim_type']).toBe('no_brim');
    expect(c['brim_width']).toBe('0');
    expect(c['raft_layers']).toBe('0');
  });

  it('sets brim config for adhesionType brim with auto_brim', () => {
    const c = buildWithProfile({
      adhesionType: 'brim',
      brimWidth: 8,
      brimType: 'auto_brim',
    });
    expect(c['skirt_loops']).toBe('0');
    expect(c['brim_type']).toBe('auto_brim');
    expect(c['brim_width']).toBe('8');
    expect(c['raft_layers']).toBe('0');
  });

  it('maps brimType brim_ears', () => {
    const c = buildWithProfile({
      adhesionType: 'brim',
      brimType: 'brim_ears',
      brimEarsDetectionLength: 1.5,
      brimEarsMaxAngle: 130,
    });
    expect(c['brim_type']).toBe('brim_ears');
    expect(c['brim_ears_detection_length']).toBe('1.5');
    expect(c['brim_ears_max_angle']).toBe('130');
  });

  it('maps brimType painted', () => {
    const c = buildWithProfile({
      adhesionType: 'brim',
      brimType: 'painted',
    });
    expect(c['brim_type']).toBe('painted');
  });

  it('sets raft config for adhesionType raft', () => {
    const c = buildWithProfile({
      adhesionType: 'raft',
      raftLayers: 3,
    });
    expect(c['skirt_loops']).toBe('0');
    expect(c['brim_type']).toBe('no_brim');
    expect(c['brim_width']).toBe('0');
    expect(c['raft_layers']).toBe('3');
  });

  it('defaults raft to 2 layers when raftLayers is 0', () => {
    const c = buildWithProfile({
      adhesionType: 'raft',
      raftLayers: 0,
    });
    expect(c['raft_layers']).toBe('2');
  });

  it('sets no adhesion for adhesionType none', () => {
    const c = buildWithProfile({ adhesionType: 'none' });
    expect(c['skirt_loops']).toBe('0');
    expect(c['brim_type']).toBe('no_brim');
    expect(c['brim_width']).toBe('0');
    expect(c['raft_layers']).toBe('0');
  });
});

// ================================================================
// RETRACTION
// ================================================================

describe('Retraction', () => {
  it('maps retractDist from filament to retraction_length (per-extruder)', () => {
    const c = buildWithFilament({ retractDist: 0.8 });
    expect(c['retraction_length']).toBe('0.8');
  });

  it('maps retractSpeed from filament to retraction_speed', () => {
    const c = buildWithFilament({ retractSpeed: 30 });
    expect(c['retraction_speed']).toBe('30');
  });

  it('maps deretractionSpeed from filament to deretraction_speed', () => {
    const c = buildWithFilament({ deretractionSpeed: 25 });
    expect(c['deretraction_speed']).toBe('25');
  });

  it('maps deretractionSpeed 0 (same as retraction)', () => {
    const c = buildWithFilament({ deretractionSpeed: 0 });
    expect(c['deretraction_speed']).toBe('0');
  });

  it('maps retractOnLayerChange to retract_when_changing_layer', () => {
    expect(buildWithProfile({ retractOnLayerChange: true })['retract_when_changing_layer']).toBe('1');
    expect(buildWithProfile({ retractOnLayerChange: false })['retract_when_changing_layer']).toBe('0');
  });

  it('maps zHopHeight to z_hop', () => {
    expect(buildWithProfile({ zHopHeight: 0.3 })['z_hop']).toBe('0.3');
  });

  it('maps zHopHeight 0 (disabled)', () => {
    expect(buildWithProfile({ zHopHeight: 0 })['z_hop']).toBe('0');
  });

  it('maps zHopType normal to Normal Lift', () => {
    expect(buildWithProfile({ zHopType: 'normal' })['z_hop_types']).toBe('Normal Lift');
  });

  it('maps zHopType spiral to Spiral Lift', () => {
    expect(buildWithProfile({ zHopType: 'spiral' })['z_hop_types']).toBe('Spiral Lift');
  });

  it('maps wipeDistance to wipe_distance and enables wipe', () => {
    const c = buildWithProfile({ wipeDistance: 2 });
    expect(c['wipe']).toBe('1');
    expect(c['wipe_distance']).toBe('2');
  });

  it('disables wipe when wipeDistance is 0', () => {
    const c = buildWithProfile({ wipeDistance: 0 });
    expect(c['wipe']).toBe('0');
    expect(c['wipe_distance']).toBe('0');
  });

  it('maps retractLengthToolchange to retraction_length_toolchange', () => {
    expect(buildWithProfile({ retractLengthToolchange: 10 })['retraction_length_toolchange']).toBe('10');
  });

  it('sets retract_lift_above to 0', () => {
    expect(buildWithProfile({})['retract_lift_above']).toBe('0');
  });
});

// ================================================================
// COOLING / FILAMENT SETTINGS
// ================================================================

describe('Cooling & Filament Settings', () => {
  it('maps nozzleTemp to nozzle_temperature', () => {
    expect(buildWithFilament({ nozzleTemp: 210 })['nozzle_temperature']).toBe('210');
  });

  it('maps firstLayerNozzleTemp to nozzle_temperature_initial_layer', () => {
    expect(buildWithFilament({ firstLayerNozzleTemp: 215 })['nozzle_temperature_initial_layer']).toBe('215');
  });

  it('maps bedTemp to hot_plate_temp', () => {
    expect(buildWithFilament({ bedTemp: 60 })['hot_plate_temp']).toBe('60');
  });

  it('maps firstLayerBedTemp to hot_plate_temp_initial_layer', () => {
    expect(buildWithFilament({ firstLayerBedTemp: 65 })['hot_plate_temp_initial_layer']).toBe('65');
  });

  it('maps coolPlateTemp to cool_plate_temp', () => {
    expect(buildWithFilament({ coolPlateTemp: 55 })['cool_plate_temp']).toBe('55');
  });

  it('maps coolPlateTempInitialLayer to cool_plate_temp_initial_layer', () => {
    expect(buildWithFilament({ coolPlateTempInitialLayer: 60 })['cool_plate_temp_initial_layer']).toBe('60');
  });

  it('maps engPlateTemp to eng_plate_temp', () => {
    expect(buildWithFilament({ engPlateTemp: 80 })['eng_plate_temp']).toBe('80');
  });

  it('maps engPlateTempInitialLayer to eng_plate_temp_initial_layer', () => {
    expect(buildWithFilament({ engPlateTempInitialLayer: 85 })['eng_plate_temp_initial_layer']).toBe('85');
  });

  it('maps texturedPlateTemp to textured_plate_temp', () => {
    expect(buildWithFilament({ texturedPlateTemp: 65 })['textured_plate_temp']).toBe('65');
  });

  it('maps texturedPlateTempInitialLayer to textured_plate_temp_initial_layer', () => {
    expect(buildWithFilament({ texturedPlateTempInitialLayer: 70 })['textured_plate_temp_initial_layer']).toBe('70');
  });

  it('maps fanSpeed to fan_min_speed', () => {
    expect(buildWithFilament({ fanSpeed: 100 })['fan_min_speed']).toBe('100');
  });

  it('maps fanMaxSpeed to fan_max_speed', () => {
    expect(buildWithFilament({ fanMaxSpeed: 100 })['fan_max_speed']).toBe('100');
  });

  it('maps closeFanFirstLayers to close_fan_the_first_x_layers', () => {
    expect(buildWithFilament({ closeFanFirstLayers: 1 })['close_fan_the_first_x_layers']).toBe('1');
  });

  it('maps fanCoolingLayerTime to fan_cooling_layer_time', () => {
    expect(buildWithFilament({ fanCoolingLayerTime: 60 })['fan_cooling_layer_time']).toBe('60');
  });

  it('maps minSpeed to slow_down_min_speed', () => {
    expect(buildWithFilament({ minSpeed: 20 })['slow_down_min_speed']).toBe('20');
  });

  it('maps slowDownLayerTime to slow_down_layer_time', () => {
    expect(buildWithFilament({ slowDownLayerTime: 4 })['slow_down_layer_time']).toBe('4');
  });

  it('maps flowRatio to filament_flow_ratio', () => {
    expect(buildWithFilament({ flowRatio: 0.95 })['filament_flow_ratio']).toBe('0.95');
  });

  it('maps enablePressureAdvance to enable_pressure_advance', () => {
    expect(buildWithFilament({ enablePressureAdvance: true })['enable_pressure_advance']).toBe('1');
    expect(buildWithFilament({ enablePressureAdvance: false })['enable_pressure_advance']).toBe('0');
  });

  it('maps pressureAdvance to pressure_advance', () => {
    expect(buildWithFilament({ pressureAdvance: 0.04 })['pressure_advance']).toBe('0.04');
  });

  it('maps adaptivePressureAdvance to adaptive_pressure_advance', () => {
    expect(buildWithFilament({ adaptivePressureAdvance: true })['adaptive_pressure_advance']).toBe('1');
  });

  it('maps overhangFanSpeed to overhang_fan_speed', () => {
    expect(buildWithFilament({ overhangFanSpeed: 100 })['overhang_fan_speed']).toBe('100');
  });

  it('maps overhangFanThreshold to overhang_fan_threshold', () => {
    expect(buildWithFilament({ overhangFanThreshold: 50 })['overhang_fan_threshold']).toBe('50%');
  });

  it('maps enableOverhangBridgeFan to enable_overhang_bridge_fan', () => {
    expect(buildWithFilament({ enableOverhangBridgeFan: true })['enable_overhang_bridge_fan']).toBe('1');
    expect(buildWithFilament({ enableOverhangBridgeFan: false })['enable_overhang_bridge_fan']).toBe('0');
  });
});

// ================================================================
// ADVANCED
// ================================================================

describe('Advanced — Pressure Advance (profile-level)', () => {
  it('emits adaptive_pressure_advance_model when adaptive PA enabled', () => {
    const c = buildOrcaConfig(
      { ...DEFAULT_PRINT_PROFILE, adaptivePAModel: 0.5 },
      { ...DEFAULT_FILAMENT, adaptivePressureAdvance: true },
      DEFAULT_PRINTER,
      null,
      1,
    );
    expect(c['adaptive_pressure_advance_model']).toBe('0.5');
  });

  it('emits adaptive_pressure_advance_overhangs when adaptive PA enabled', () => {
    const c = buildOrcaConfig(
      { ...DEFAULT_PRINT_PROFILE, adaptivePAOverhangs: true },
      { ...DEFAULT_FILAMENT, adaptivePressureAdvance: true },
      DEFAULT_PRINTER,
      null,
      1,
    );
    expect(c['adaptive_pressure_advance_overhangs']).toBe('1');
  });

  it('emits adaptive_pressure_advance_bridges when adaptive PA enabled', () => {
    const c = buildOrcaConfig(
      { ...DEFAULT_PRINT_PROFILE, adaptivePABridges: 0.02 },
      { ...DEFAULT_FILAMENT, adaptivePressureAdvance: true },
      DEFAULT_PRINTER,
      null,
      1,
    );
    expect(c['adaptive_pressure_advance_bridges']).toBe('0.02');
  });

  it('does not emit adaptive PA extras when adaptive PA disabled', () => {
    const c = buildOrcaConfig(
      { ...DEFAULT_PRINT_PROFILE, adaptivePAModel: 0.5 },
      { ...DEFAULT_FILAMENT, adaptivePressureAdvance: false },
      DEFAULT_PRINTER,
      null,
      1,
    );
    expect(c['adaptive_pressure_advance_model']).toBeUndefined();
  });
});

describe('Advanced — Arc Fitting', () => {
  it('emits gcode_resolution when arc fitting enabled', () => {
    const c = buildWithProfile({ arcFittingEnable: true, gcodeResolution: 0.012 });
    expect(c['gcode_resolution']).toBe('0.012');
  });

  it('does not emit gcode_resolution when arc fitting disabled', () => {
    const c = buildWithProfile({ arcFittingEnable: false });
    expect(c['gcode_resolution']).toBeUndefined();
  });

  it('maps arcFittingEnable to enable_arc_fitting', () => {
    expect(buildWithProfile({ arcFittingEnable: true })['enable_arc_fitting']).toBe('1');
    expect(buildWithProfile({ arcFittingEnable: false })['enable_arc_fitting']).toBe('0');
  });
});

describe('Advanced — Fuzzy Skin', () => {
  it('maps fuzzySkinType none to fuzzy_skin', () => {
    expect(buildWithProfile({ fuzzySkinType: 'none' })['fuzzy_skin']).toBe('none');
  });

  it('maps fuzzySkinType external to fuzzy_skin', () => {
    expect(buildWithProfile({ fuzzySkinType: 'external' })['fuzzy_skin']).toBe('external');
  });

  it('maps fuzzySkinType all to fuzzy_skin', () => {
    expect(buildWithProfile({ fuzzySkinType: 'all' })['fuzzy_skin']).toBe('all');
  });

  it('maps fuzzySkinType allwalls to fuzzy_skin', () => {
    expect(buildWithProfile({ fuzzySkinType: 'allwalls' })['fuzzy_skin']).toBe('allwalls');
  });

  it('maps fuzzySkinMode displacement to fuzzy_skin_mode', () => {
    expect(buildWithProfile({ fuzzySkinMode: 'displacement' })['fuzzy_skin_mode']).toBe('displacement');
  });

  it('maps fuzzySkinMode extrusion to fuzzy_skin_mode', () => {
    expect(buildWithProfile({ fuzzySkinMode: 'extrusion' })['fuzzy_skin_mode']).toBe('extrusion');
  });

  it('maps fuzzySkinMode combined to fuzzy_skin_mode', () => {
    expect(buildWithProfile({ fuzzySkinMode: 'combined' })['fuzzy_skin_mode']).toBe('combined');
  });

  it('emits fuzzy_skin_noise_type when fuzzy skin type is active', () => {
    expect(buildWithProfile({
      fuzzySkinType: 'external',
      fuzzySkinNoiseType: 'perlin',
    })['fuzzy_skin_noise_type']).toBe('perlin');
  });

  it('maps noise type billow', () => {
    expect(buildWithProfile({
      fuzzySkinType: 'all',
      fuzzySkinNoiseType: 'billow',
    })['fuzzy_skin_noise_type']).toBe('billow');
  });

  it('maps noise type ridged_multi to ridgedmulti', () => {
    expect(buildWithProfile({
      fuzzySkinType: 'allwalls',
      fuzzySkinNoiseType: 'ridged_multi',
    })['fuzzy_skin_noise_type']).toBe('ridgedmulti');
  });

  it('maps noise type voronoi', () => {
    expect(buildWithProfile({
      fuzzySkinType: 'external',
      fuzzySkinNoiseType: 'voronoi',
    })['fuzzy_skin_noise_type']).toBe('voronoi');
  });

  it('maps noise type classic', () => {
    expect(buildWithProfile({
      fuzzySkinType: 'external',
      fuzzySkinNoiseType: 'classic',
    })['fuzzy_skin_noise_type']).toBe('classic');
  });

  it('does not emit noise type when fuzzy skin type is none', () => {
    const c = buildWithProfile({ fuzzySkinType: 'none' });
    expect(c['fuzzy_skin_noise_type']).toBeUndefined();
  });

  it('maps fuzzySkinThickness to fuzzy_skin_thickness', () => {
    expect(buildWithProfile({ fuzzySkinThickness: 0.3 })['fuzzy_skin_thickness']).toBe('0.3');
    expect(buildWithProfile({ fuzzySkinThickness: 0.5 })['fuzzy_skin_thickness']).toBe('0.5');
  });

  it('maps fuzzySkinPointDistance to fuzzy_skin_point_distance', () => {
    expect(buildWithProfile({ fuzzySkinPointDistance: 0.8 })['fuzzy_skin_point_distance']).toBe('0.8');
    expect(buildWithProfile({ fuzzySkinPointDistance: 1.5 })['fuzzy_skin_point_distance']).toBe('1.5');
  });

  it('maps fuzzySkinFirstLayer to fuzzy_skin_first_layer', () => {
    expect(buildWithProfile({ fuzzySkinFirstLayer: true })['fuzzy_skin_first_layer']).toBe('1');
    expect(buildWithProfile({ fuzzySkinFirstLayer: false })['fuzzy_skin_first_layer']).toBe('0');
  });

  it('maps fuzzySkinScale to fuzzy_skin_scale', () => {
    expect(buildWithProfile({ fuzzySkinScale: 1.0 })['fuzzy_skin_scale']).toBe('1');
    expect(buildWithProfile({ fuzzySkinScale: 2.5 })['fuzzy_skin_scale']).toBe('2.5');
  });

  it('maps fuzzySkinOctaves to fuzzy_skin_octaves as integer', () => {
    expect(buildWithProfile({ fuzzySkinOctaves: 4 })['fuzzy_skin_octaves']).toBe('4');
    expect(buildWithProfile({ fuzzySkinOctaves: 3.7 })['fuzzy_skin_octaves']).toBe('4');
  });

  it('maps fuzzySkinPersistence to fuzzy_skin_persistence', () => {
    expect(buildWithProfile({ fuzzySkinPersistence: 0.5 })['fuzzy_skin_persistence']).toBe('0.5');
    expect(buildWithProfile({ fuzzySkinPersistence: 0.8 })['fuzzy_skin_persistence']).toBe('0.8');
  });
});

describe('Advanced — Ironing', () => {
  it('maps ironingType no ironing', () => {
    expect(buildWithProfile({ ironingType: 'no ironing' })['ironing_type']).toBe('no ironing');
  });

  it('maps ironingType top', () => {
    expect(buildWithProfile({ ironingType: 'top' })['ironing_type']).toBe('top');
  });

  it('maps ironingType topmost', () => {
    expect(buildWithProfile({ ironingType: 'topmost' })['ironing_type']).toBe('topmost');
  });

  it('maps ironingType solid', () => {
    expect(buildWithProfile({ ironingType: 'solid' })['ironing_type']).toBe('solid');
  });

  it('maps ironingFlow with % suffix', () => {
    expect(buildWithProfile({ ironingFlow: 15 })['ironing_flow']).toBe('15%');
    expect(buildWithProfile({ ironingFlow: 10 })['ironing_flow']).toBe('10%');
  });

  it('maps ironingSpacing to ironing_spacing', () => {
    expect(buildWithProfile({ ironingSpacing: 0.1 })['ironing_spacing']).toBe('0.1');
  });

  it('maps ironingSpeed to ironing_speed', () => {
    expect(buildWithProfile({ ironingSpeed: 15 })['ironing_speed']).toBe('15');
    expect(buildWithProfile({ ironingSpeed: 30 })['ironing_speed']).toBe('30');
  });

  it('maps ironingAngle to ironing_angle', () => {
    expect(buildWithProfile({ ironingAngle: 45 })['ironing_angle']).toBe('45');
    expect(buildWithProfile({ ironingAngle: 0 })['ironing_angle']).toBe('0');
  });
});

describe('Advanced — Hole-to-Polyhole', () => {
  it('maps holeToPolyhole to hole_to_polyhole', () => {
    expect(buildWithProfile({ holeToPolyhole: true })['hole_to_polyhole']).toBe('1');
    expect(buildWithProfile({ holeToPolyhole: false })['hole_to_polyhole']).toBe('0');
  });

  it('emits threshold and twisted when enabled', () => {
    const c = buildWithProfile({
      holeToPolyhole: true,
      holeToPolyholeThreshold: 40,
      holeToPoleholeTwisted: true,
    });
    expect(c['hole_to_polyhole_threshold']).toBe('40');
    expect(c['hole_to_polyhole_twisted']).toBe('1');
  });

  it('does not emit threshold when disabled', () => {
    const c = buildWithProfile({ holeToPolyhole: false });
    expect(c['hole_to_polyhole_threshold']).toBeUndefined();
    expect(c['hole_to_polyhole_twisted']).toBeUndefined();
  });
});

describe('Advanced — Other', () => {
  it('maps excludeObject to exclude_object', () => {
    expect(buildWithProfile({ excludeObject: true })['exclude_object']).toBe('1');
    expect(buildWithProfile({ excludeObject: false })['exclude_object']).toBe('0');
  });

  it('maps makeOverhangPrintable to make_overhang_printable', () => {
    expect(buildWithProfile({ makeOverhangPrintable: true })['make_overhang_printable']).toBe('1');
    expect(buildWithProfile({ makeOverhangPrintable: false })['make_overhang_printable']).toBe('0');
  });

  it('emits overhang printable angle/hole size when enabled', () => {
    const c = buildWithProfile({
      makeOverhangPrintable: true,
      makeOverhangPrintableAngle: 55,
      makeOverhangPrintableHoleSize: 2,
    });
    expect(c['make_overhang_printable_angle']).toBe('55');
    expect(c['make_overhang_printable_hole_size']).toBe('2');
  });

  it('does not emit overhang printable sub-fields when disabled', () => {
    const c = buildWithProfile({ makeOverhangPrintable: false });
    expect(c['make_overhang_printable_angle']).toBeUndefined();
    expect(c['make_overhang_printable_hole_size']).toBeUndefined();
  });

  it('maps maxVolumetricFlowSmoothingRate > 0 to max_volumetric_extrusion_rate_slope', () => {
    const c = buildWithProfile({
      maxVolumetricFlowSmoothingRate: 12,
      maxVolumetricFlowSmoothingSegment: 3,
    });
    expect(c['max_volumetric_extrusion_rate_slope']).toBe('12');
    expect(c['max_volumetric_extrusion_rate_slope_segment_length']).toBe('3');
  });

  it('does not set volumetric segment when rate is 0', () => {
    const c = buildWithProfile({ maxVolumetricFlowSmoothingRate: 0 });
    expect(c['max_volumetric_extrusion_rate_slope_segment_length']).toBeUndefined();
  });

  it('maps printFlowRatio to print_flow_ratio', () => {
    expect(buildWithProfile({ printFlowRatio: 1.0 })['print_flow_ratio']).toBe('1');
    expect(buildWithProfile({ printFlowRatio: 0.95 })['print_flow_ratio']).toBe('0.95');
  });

  it('maps timelapseType none to 0', () => {
    expect(buildWithProfile({ timelapseType: 'none' })['timelapse_type']).toBe('0');
  });

  it('maps timelapseType smooth to 1', () => {
    expect(buildWithProfile({ timelapseType: 'smooth' })['timelapse_type']).toBe('1');
  });

  it('maps spiralMode to spiral_mode', () => {
    expect(buildWithProfile({ spiralMode: true })['spiral_mode']).toBe('1');
    expect(buildWithProfile({ spiralMode: false })['spiral_mode']).toBe('0');
  });

  it('maps overhangReverse to overhang_reverse', () => {
    expect(buildWithProfile({ overhangReverse: true })['overhang_reverse']).toBe('1');
    expect(buildWithProfile({ overhangReverse: false })['overhang_reverse']).toBe('0');
  });

  it('emits overhang_reverse_threshold with % when enabled', () => {
    const c = buildWithProfile({
      overhangReverse: true,
      overhangReverseThreshold: 50,
    });
    expect(c['overhang_reverse_threshold']).toBe('50%');
  });

  it('does not emit overhang_reverse_threshold when disabled', () => {
    const c = buildWithProfile({ overhangReverse: false });
    expect(c['overhang_reverse_threshold']).toBeUndefined();
  });

  it('maps slowDownLayers to slow_down_layers', () => {
    expect(buildWithProfile({ slowDownLayers: 5 })['slow_down_layers']).toBe('5');
    expect(buildWithProfile({ slowDownLayers: 0 })['slow_down_layers']).toBe('0');
  });

  it('maps topSolidInfillFlowRatio to top_solid_infill_flow_ratio', () => {
    expect(buildWithProfile({ topSolidInfillFlowRatio: 1.0 })['top_solid_infill_flow_ratio']).toBe('1');
    expect(buildWithProfile({ topSolidInfillFlowRatio: 0.9 })['top_solid_infill_flow_ratio']).toBe('0.9');
  });

  it('maps bottomSolidInfillFlowRatio to bottom_solid_infill_flow_ratio', () => {
    expect(buildWithProfile({ bottomSolidInfillFlowRatio: 1.0 })['bottom_solid_infill_flow_ratio']).toBe('1');
    expect(buildWithProfile({ bottomSolidInfillFlowRatio: 1.1 })['bottom_solid_infill_flow_ratio']).toBe('1.1');
  });

  it('maps gapFillTarget everywhere', () => {
    expect(buildWithProfile({ gapFillTarget: 'everywhere' })['gap_fill_target']).toBe('everywhere');
  });

  it('maps gapFillTarget topbottom', () => {
    expect(buildWithProfile({ gapFillTarget: 'topbottom' })['gap_fill_target']).toBe('topbottom');
  });

  it('maps gapFillTarget nowhere', () => {
    expect(buildWithProfile({ gapFillTarget: 'nowhere' })['gap_fill_target']).toBe('nowhere');
  });

  it('maps reduceInfillRetraction to reduce_infill_retraction', () => {
    expect(buildWithProfile({ reduceInfillRetraction: true })['reduce_infill_retraction']).toBe('1');
    expect(buildWithProfile({ reduceInfillRetraction: false })['reduce_infill_retraction']).toBe('0');
  });

  it('maps useFirmwareRetraction to use_firmware_retraction', () => {
    expect(buildWithProfile({ useFirmwareRetraction: true })['use_firmware_retraction']).toBe('1');
    expect(buildWithProfile({ useFirmwareRetraction: false })['use_firmware_retraction']).toBe('0');
  });

  it('maps overhangReverseInternalOnly to overhang_reverse_internal_only', () => {
    expect(buildWithProfile({ overhangReverseInternalOnly: true })['overhang_reverse_internal_only']).toBe('1');
    expect(buildWithProfile({ overhangReverseInternalOnly: false })['overhang_reverse_internal_only']).toBe('0');
  });
});

// ================================================================
// PRINTER SETTINGS
// ================================================================

describe('Printer Settings', () => {
  it('generates printable_area from bedWidth x bedDepth (origin corner)', () => {
    const c = buildWithPrinter({ bedWidth: 220, bedDepth: 220, originCenter: false });
    expect(c['printable_area']).toBe('0x0;220x0;220x220;0x220');
  });

  it('generates printable_area with origin center', () => {
    const c = buildWithPrinter({ bedWidth: 200, bedDepth: 200, originCenter: true });
    expect(c['printable_area']).toBe('-100x-100;100x-100;100x100;-100x100');
  });

  it('uses explicit printableArea polygon when provided', () => {
    const c = buildWithPrinter({
      printableArea: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 180, y: 200 },
        { x: 20, y: 200 },
      ],
    });
    expect(c['printable_area']).toBe('0x0;200x0;180x200;20x200');
  });

  it('maps maxHeight to printable_height', () => {
    expect(buildWithPrinter({ maxHeight: 250 })['printable_height']).toBe('250');
  });

  it('converts start gcode with Klipper variables', () => {
    const c = buildWithPrinter({ startGcode: 'M190 S{bed_temp}' });
    expect(c['machine_start_gcode']).toBe('M190 S[hot_plate_temp_initial_layer]');
  });

  it('converts end gcode', () => {
    const c = buildWithPrinter({ endGcode: 'M104 S0\nM140 S0' });
    expect(c['machine_end_gcode']).toBe('M104 S0\nM140 S0');
  });

  it('converts tool change gcode', () => {
    const c = buildWithPrinter({ toolChangeGcode: 'T{tool}' });
    expect(c['change_filament_gcode']).toBe('T[next_extruder]');
  });

  it('omits gcode keys when empty', () => {
    const c = buildWithPrinter({ startGcode: '', endGcode: '', toolChangeGcode: '' });
    expect(c['machine_start_gcode']).toBeUndefined();
    expect(c['machine_end_gcode']).toBeUndefined();
    expect(c['change_filament_gcode']).toBeUndefined();
  });

  it('maps bed exclude areas', () => {
    const c = buildWithPrinter({
      bedExcludeAreas: [
        { x: 0, y: 0, width: 30, height: 30 },
        { x: 190, y: 190, width: 30, height: 30 },
      ],
    });
    expect(c['bed_exclude_area']).toBe('0x0;30x30\n190x190;220x220');
  });

  it('omits bed_exclude_area when empty', () => {
    const c = buildWithPrinter({ bedExcludeAreas: [] });
    expect(c['bed_exclude_area']).toBeUndefined();
  });

  it('maps printerStructureType to printer_structure', () => {
    expect(buildWithPrinter({ printerStructureType: 'corexy' })['printer_structure']).toBe('corexy');
    expect(buildWithPrinter({ printerStructureType: 'delta' })['printer_structure']).toBe('delta');
  });

  it('maps nozzleType brass', () => {
    expect(buildWithPrinter({ nozzleType: 'brass' })['nozzle_type']).toBe('brass');
  });

  it('maps nozzleType hardened_steel', () => {
    expect(buildWithPrinter({ nozzleType: 'hardened_steel' })['nozzle_type']).toBe('hardened_steel');
  });

  it('maps nozzleType undefine', () => {
    expect(buildWithPrinter({ nozzleType: 'undefine' })['nozzle_type']).toBe('undefine');
  });

  it('maps nozzleHRC > 0', () => {
    expect(buildWithPrinter({ nozzleHRC: 52 })['nozzle_hrc']).toBe('52');
  });

  it('omits nozzleHRC when 0', () => {
    expect(buildWithPrinter({ nozzleHRC: 0 })['nozzle_hrc']).toBeUndefined();
  });

  it('maps auxiliaryFan to auxiliary_fan', () => {
    expect(buildWithPrinter({ auxiliaryFan: true })['auxiliary_fan']).toBe('1');
    expect(buildWithPrinter({ auxiliaryFan: false })['auxiliary_fan']).toBe('0');
  });

  it('maps chamberTempControl to chamber_temperature', () => {
    expect(buildWithPrinter({ chamberTempControl: true })['chamber_temperature']).toBe('1');
  });

  it('omits chamber_temperature when disabled', () => {
    expect(buildWithPrinter({ chamberTempControl: false })['chamber_temperature']).toBeUndefined();
  });

  it('maps maxVolumetricSpeed > 0', () => {
    expect(buildWithPrinter({ maxVolumetricSpeed: 15 })['max_volumetric_speed']).toBe('15');
  });

  it('omits maxVolumetricSpeed when 0', () => {
    // Note: max_volumetric_speed may be set from profile's maxVolumetricFlowSmoothingRate
    // but when both are 0, it should not be set by printer
    const c = buildOrcaConfig(
      { ...DEFAULT_PRINT_PROFILE, maxVolumetricFlowSmoothingRate: 0 },
      DEFAULT_FILAMENT,
      { ...DEFAULT_PRINTER, maxVolumetricSpeed: 0 },
      null,
      1,
    );
    expect(c['max_volumetric_speed']).toBeUndefined();
  });
});

describe('Printer Settings — Nozzle & Filament Diameter', () => {
  it('uses printer config nozzle diameter when available', () => {
    const c = buildOrcaConfig(
      DEFAULT_PRINT_PROFILE,
      DEFAULT_FILAMENT,
      DEFAULT_PRINTER,
      { nozzleDiameter: 0.6, filamentDiameter: 1.75, maxVelocity: 300 },
      1,
    );
    expect(c['nozzle_diameter']).toBe('0.6');
    expect(c['filament_diameter']).toBe('1.75');
  });

  it('defaults nozzle diameter to 0.4 when printer config is null', () => {
    const c = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(c['nozzle_diameter']).toBe('0.4');
    expect(c['filament_diameter']).toBe('1.75');
  });
});

// ================================================================
// MULTI-EXTRUDER REPLICATION
// ================================================================

describe('Multi-extruder replication', () => {
  it('replicates retraction values for 2 extruders with commas', () => {
    const c = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 2);
    expect(c['retraction_length']).toBe('0.8,0.8');
    expect(c['retraction_speed']).toBe('30,30');
    expect(c['deretraction_speed']).toBe('0,0');
  });

  it('replicates nozzle_diameter for 4 extruders', () => {
    const c = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 4);
    expect(c['nozzle_diameter']).toBe('0.4,0.4,0.4,0.4');
  });

  it('replicates filament temperatures for 3 extruders', () => {
    const c = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 3);
    expect(c['nozzle_temperature']).toBe('210,210,210');
    expect(c['hot_plate_temp']).toBe('60,60,60');
    expect(c['fan_min_speed']).toBe('100,100,100');
  });

  it('replicates z_hop_types for 2 extruders', () => {
    const c = buildOrcaConfig(
      { ...DEFAULT_PRINT_PROFILE, zHopType: 'spiral' },
      DEFAULT_FILAMENT,
      DEFAULT_PRINTER,
      null,
      2,
    );
    expect(c['z_hop_types']).toBe('Spiral Lift,Spiral Lift');
  });

  it('enables single_extruder_multi_material for > 1 extruder', () => {
    const c2 = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 2);
    expect(c2['single_extruder_multi_material']).toBe('1');

    const c1 = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);
    expect(c1['single_extruder_multi_material']).toBeUndefined();
  });

  it('replicates filament_flow_ratio for multiple extruders', () => {
    const c = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 3);
    expect(c['filament_flow_ratio']).toBe('1,1,1');
  });

  it('replicates pressure advance fields for multiple extruders', () => {
    const c = buildOrcaConfig(
      DEFAULT_PRINT_PROFILE,
      { ...DEFAULT_FILAMENT, enablePressureAdvance: true, pressureAdvance: 0.05 },
      DEFAULT_PRINTER,
      null,
      2,
    );
    expect(c['enable_pressure_advance']).toBe('1,1');
    expect(c['pressure_advance']).toBe('0.05,0.05');
  });
});

// ================================================================
// KLIPPER GCODE CONVERSION
// ================================================================

describe('convertKlipperToOrcaGcode', () => {
  it('converts {bed_temp} to [hot_plate_temp_initial_layer]', () => {
    expect(convertKlipperToOrcaGcode('M190 S{bed_temp}')).toBe('M190 S[hot_plate_temp_initial_layer]');
  });

  it('converts {BED_TEMP} (uppercase)', () => {
    expect(convertKlipperToOrcaGcode('M190 S{BED_TEMP}')).toBe('M190 S[hot_plate_temp_initial_layer]');
  });

  it('converts {bed_temperature}', () => {
    expect(convertKlipperToOrcaGcode('{bed_temperature}')).toBe('[hot_plate_temp_initial_layer]');
  });

  it('converts {BED_TEMPERATURE}', () => {
    expect(convertKlipperToOrcaGcode('{BED_TEMPERATURE}')).toBe('[hot_plate_temp_initial_layer]');
  });

  it('converts {temp} to [nozzle_temperature_initial_layer]', () => {
    expect(convertKlipperToOrcaGcode('M104 S{temp}')).toBe('M104 S[nozzle_temperature_initial_layer]');
  });

  it('converts {TEMP} (uppercase)', () => {
    expect(convertKlipperToOrcaGcode('M104 S{TEMP}')).toBe('M104 S[nozzle_temperature_initial_layer]');
  });

  it('converts {extruder_temp}', () => {
    expect(convertKlipperToOrcaGcode('{extruder_temp}')).toBe('[nozzle_temperature_initial_layer]');
  });

  it('converts {EXTRUDER_TEMP}', () => {
    expect(convertKlipperToOrcaGcode('{EXTRUDER_TEMP}')).toBe('[nozzle_temperature_initial_layer]');
  });

  it('converts {hotend_temp}', () => {
    expect(convertKlipperToOrcaGcode('{hotend_temp}')).toBe('[nozzle_temperature_initial_layer]');
  });

  it('converts {HOTEND_TEMP}', () => {
    expect(convertKlipperToOrcaGcode('{HOTEND_TEMP}')).toBe('[nozzle_temperature_initial_layer]');
  });

  it('converts {nozzle_temp}', () => {
    expect(convertKlipperToOrcaGcode('{nozzle_temp}')).toBe('[nozzle_temperature_initial_layer]');
  });

  it('converts {NOZZLE_TEMP}', () => {
    expect(convertKlipperToOrcaGcode('{NOZZLE_TEMP}')).toBe('[nozzle_temperature_initial_layer]');
  });

  it('converts {tool} to [next_extruder]', () => {
    expect(convertKlipperToOrcaGcode('T{tool}')).toBe('T[next_extruder]');
  });

  it('converts {TOOL}', () => {
    expect(convertKlipperToOrcaGcode('T{TOOL}')).toBe('T[next_extruder]');
  });

  it('converts {tool_nr}', () => {
    expect(convertKlipperToOrcaGcode('T{tool_nr}')).toBe('T[next_extruder]');
  });

  it('converts {TOOL_NR}', () => {
    expect(convertKlipperToOrcaGcode('T{TOOL_NR}')).toBe('T[next_extruder]');
  });

  it('leaves unknown {variables} unchanged', () => {
    expect(convertKlipperToOrcaGcode('{unknown_var}')).toBe('{unknown_var}');
  });

  it('leaves OrcaSlicer native expressions unchanged', () => {
    expect(convertKlipperToOrcaGcode('{first_layer_temperature[0]}')).toBe('{first_layer_temperature[0]}');
  });

  it('handles multiple variables in one string', () => {
    const input = 'START_PRINT BED={BED_TEMP} TOOL={EXTRUDER_TEMP} T={TOOL}';
    const expected = 'START_PRINT BED=[hot_plate_temp_initial_layer] TOOL=[nozzle_temperature_initial_layer] T=[next_extruder]';
    expect(convertKlipperToOrcaGcode(input)).toBe(expected);
  });

  it('handles empty string', () => {
    expect(convertKlipperToOrcaGcode('')).toBe('');
  });

  it('handles string with no variables', () => {
    expect(convertKlipperToOrcaGcode('G28 X Y Z')).toBe('G28 X Y Z');
  });
});

// ================================================================
// DEFAULT PROFILE PRODUCES VALID CONFIG
// ================================================================

describe('Default profile config', () => {
  it('produces config with all expected keys from defaults', () => {
    const c = buildOrcaConfig(DEFAULT_PRINT_PROFILE, DEFAULT_FILAMENT, DEFAULT_PRINTER, null, 1);

    // Spot-check essential keys exist
    expect(c['layer_height']).toBeDefined();
    expect(c['wall_loops']).toBeDefined();
    expect(c['sparse_infill_density']).toBeDefined();
    expect(c['outer_wall_speed']).toBeDefined();
    expect(c['travel_speed']).toBeDefined();
    expect(c['enable_support']).toBeDefined();
    expect(c['nozzle_temperature']).toBeDefined();
    expect(c['hot_plate_temp']).toBeDefined();
    expect(c['retraction_length']).toBeDefined();
    expect(c['printable_area']).toBeDefined();
    expect(c['nozzle_diameter']).toBeDefined();
    expect(c['filament_diameter']).toBeDefined();
  });

  it('produces correct default layer height', () => {
    const c = buildWithProfile({});
    expect(c['layer_height']).toBe('0.2');
    expect(c['initial_layer_print_height']).toBe('0.3');
  });

  it('produces correct default wall settings', () => {
    const c = buildWithProfile({});
    expect(c['wall_loops']).toBe('3');
    expect(c['wall_sequence']).toBe('inner wall/outer wall');
    expect(c['wall_generator']).toBe('arachne');
    expect(c['top_shell_layers']).toBe('4');
    expect(c['bottom_shell_layers']).toBe('4');
  });

  it('produces correct default infill settings', () => {
    const c = buildWithProfile({});
    expect(c['sparse_infill_pattern']).toBe('gyroid');
    expect(c['sparse_infill_density']).toBe('15%');
    expect(c['infill_direction']).toBe('45');
  });

  it('produces correct default support settings', () => {
    const c = buildWithProfile({});
    expect(c['enable_support']).toBe('0');
    expect(c['support_type']).toBe('normal(auto)');
    expect(c['support_threshold_angle']).toBe('45');
  });

  it('produces correct default adhesion (skirt)', () => {
    const c = buildWithProfile({});
    expect(c['skirt_loops']).toBe('3');
    expect(c['skirt_distance']).toBe('2');
    expect(c['brim_type']).toBe('no_brim');
  });

  it('produces correct default fuzzy skin (none)', () => {
    const c = buildWithProfile({});
    expect(c['fuzzy_skin']).toBe('none');
    expect(c['fuzzy_skin_noise_type']).toBeUndefined();
  });

  it('produces correct default spiral mode (off)', () => {
    const c = buildWithProfile({});
    expect(c['spiral_mode']).toBe('0');
  });

  it('produces correct default exclude object (on)', () => {
    const c = buildWithProfile({});
    expect(c['exclude_object']).toBe('1');
  });
});
