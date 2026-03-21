// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * OrcaSlicer settings builder.
 *
 * Converts our PrintProfile + ResolvedFilamentSettings + PrinterSettings
 * into OrcaSlicer config key/value pairs (Record<string, string>).
 *
 * These are passed to the libslic3r WASM module via
 * DynamicPrintConfig::set_deserialize_strict().
 *
 * OrcaSlicer uses BambuStudio key naming which differs fundamentally from
 * PrusaSlicer. This module replaces buildPrusaConfig() entirely.
 */

import type { PrintProfile } from '../types/print-profile';
import type { ResolvedFilamentSettings } from '../hooks/usePrinterFilamentOverrides';
import type { PrinterConfig } from './moonraker-api';

// Re-export shared types and utilities from slicer-settings.ts
export { getModelHeightFromSTL } from './slicer-settings';
export type { PrinterSettings, BedExcludeArea, PrinterStructureType, NozzleType } from './slicer-settings';
import type { PrinterSettings } from './slicer-settings';

/**
 * Map of Klipper-style G-code macro variables to OrcaSlicer placeholder names.
 * Klipper macros use `{var}` syntax; OrcaSlicer uses `[var]` for substitution.
 *
 * OrcaSlicer placeholder naming differs from PrusaSlicer:
 * - bed temp: `[hot_plate_temp_initial_layer]` (not `[first_layer_bed_temperature]`)
 * - nozzle temp: `[nozzle_temperature_initial_layer]` (not `[first_layer_temperature]`)
 * - tool change: `[next_extruder]` (same as PrusaSlicer)
 */
const KLIPPER_TO_ORCASLICER: Record<string, string> = {
  // Bed temperature
  'bed_temp': '[hot_plate_temp_initial_layer]',
  'BED_TEMP': '[hot_plate_temp_initial_layer]',
  'bed_temperature': '[hot_plate_temp_initial_layer]',
  'BED_TEMPERATURE': '[hot_plate_temp_initial_layer]',
  // Extruder/nozzle temperature
  'temp': '[nozzle_temperature_initial_layer]',
  'TEMP': '[nozzle_temperature_initial_layer]',
  'extruder_temp': '[nozzle_temperature_initial_layer]',
  'EXTRUDER_TEMP': '[nozzle_temperature_initial_layer]',
  'hotend_temp': '[nozzle_temperature_initial_layer]',
  'HOTEND_TEMP': '[nozzle_temperature_initial_layer]',
  'nozzle_temp': '[nozzle_temperature_initial_layer]',
  'NOZZLE_TEMP': '[nozzle_temperature_initial_layer]',
  // Tool change
  'tool': '[next_extruder]',
  'TOOL': '[next_extruder]',
  'tool_nr': '[next_extruder]',
  'TOOL_NR': '[next_extruder]',
};

/**
 * Convert Klipper-style `{variable}` placeholders in G-code to OrcaSlicer
 * `[variable]` syntax. Unknown `{...}` expressions are left as-is —
 * OrcaSlicer's template engine handles its own native expressions.
 */
export function convertKlipperToOrcaGcode(gcode: string): string {
  return gcode.replace(/\{([^}]+)\}/g, (match, varName: string) => {
    const trimmed = varName.trim();
    const mapped = KLIPPER_TO_ORCASLICER[trimmed];
    if (mapped) return mapped;
    return match;
  });
}

/**
 * OrcaSlicer wall_sequence enum values.
 * Maps our WallSequence type to OrcaSlicer config string.
 */
const WALL_SEQUENCE_MAP: Record<string, string> = {
  'inner_outer': 'inner wall/outer wall',
  'outer_inner': 'outer wall/inner wall',
  'inner_outer_inner': 'inner-outer-inner wall',
};

/**
 * OrcaSlicer support type values.
 */
const SUPPORT_TYPE_MAP: Record<string, string> = {
  'normal_auto': 'normal(auto)',
  'tree_auto': 'tree(auto)',
  'normal_manual': 'normal(manual)',
  'tree_manual': 'tree(manual)',
};

/**
 * OrcaSlicer seam_position values.
 */
const SEAM_POSITION_MAP: Record<string, string> = {
  'nearest': 'nearest',
  'aligned': 'aligned',
  'aligned_back': 'aligned_back',
  'back': 'back',
  'random': 'random',
};

/**
 * OrcaSlicer seam_slope_type values (SeamScarfType).
 */
const SEAM_SCARF_TYPE_MAP: Record<string, string> = {
  'none': 'none',
  'external': 'external',
  'all': 'all',
};

/**
 * OrcaSlicer fuzzy_skin values (FuzzySkinType — WHERE to apply).
 * Config key: `fuzzy_skin`
 */
const FUZZY_SKIN_TYPE_MAP: Record<string, string> = {
  'none': 'none',
  'external': 'external',
  'all': 'all',
  'allwalls': 'allwalls',
};

/**
 * OrcaSlicer fuzzy_skin_mode values (FuzzySkinMode — HOW to apply).
 * Config key: `fuzzy_skin_mode`
 */
const FUZZY_SKIN_MODE_MAP: Record<string, string> = {
  'displacement': 'displacement',
  'extrusion': 'extrusion',
  'combined': 'combined',
};

/**
 * OrcaSlicer support_style values (SupportMaterialStyle).
 */
const SUPPORT_STYLE_MAP: Record<string, string> = {
  'default': 'default',
  'grid': 'grid',
  'snug': 'snug',
  'tree_slim': 'tree_slim',
  'tree_strong': 'tree_strong',
  'tree_hybrid': 'tree_hybrid',
  'organic': 'organic',
};

/**
 * OrcaSlicer ironing_type values.
 */
const IRONING_TYPE_MAP: Record<string, string> = {
  'no ironing': 'no ironing',
  'top': 'top',
  'topmost': 'topmost',
  'solid': 'solid',
};

/**
 * OrcaSlicer ensure_vertical_shell_thickness values.
 */
const ENSURE_VERTICAL_SHELL_MAP: Record<string, string> = {
  'none': 'none',
  'ensure_critical_only': 'ensure_critical_only',
  'ensure_moderate': 'ensure_moderate',
  'ensure_all': 'ensure_all',
};

/**
 * OrcaSlicer gap_fill_target values.
 */
const GAP_FILL_TARGET_MAP: Record<string, string> = {
  'everywhere': 'everywhere',
  'topbottom': 'topbottom',
  'nowhere': 'nowhere',
};

/**
 * OrcaSlicer wall_direction values.
 */
const WALL_DIRECTION_MAP: Record<string, string> = {
  'auto': 'auto',
  'ccw': 'ccw',
  'cw': 'cw',
};

/**
 * OrcaSlicer support_base_pattern values.
 */
const SUPPORT_BASE_PATTERN_MAP: Record<string, string> = {
  'default': 'default',
  'rectilinear': 'rectilinear',
  'rectilinear-grid': 'rectilinear-grid',
  'honeycomb': 'honeycomb',
  'lightning': 'lightning',
  'hollow': 'hollow',
};

/**
 * OrcaSlicer support_interface_pattern values.
 */
const SUPPORT_INTERFACE_PATTERN_MAP: Record<string, string> = {
  'auto': 'auto',
  'rectilinear': 'rectilinear',
  'concentric': 'concentric',
  'rectilinear_interlaced': 'rectilinear_interlaced',
  'grid': 'grid',
};

/**
 * OrcaSlicer fuzzy_skin_noise_type values.
 */
const FUZZY_SKIN_NOISE_TYPE_MAP: Record<string, string> = {
  'classic': 'classic',
  'perlin': 'perlin',
  'billow': 'billow',
  'ridged_multi': 'ridgedmulti',
  'voronoi': 'voronoi',
};

/**
 * OrcaSlicer z_hop_types values.
 */
const Z_HOP_TYPE_MAP: Record<string, string> = {
  'auto': 'Auto Lift',
  'normal': 'Normal Lift',
  'slope': 'Slope Lift',
  'spiral': 'Spiral Lift',
};

/**
 * OrcaSlicer brim_type values.
 */
const BRIM_TYPE_MAP: Record<string, string> = {
  'no_brim': 'no_brim',
  'outer_only': 'outer_only',
  'inner_only': 'inner_only',
  'outer_and_inner': 'outer_and_inner',
  'auto_brim': 'auto_brim',
  'brim_ears': 'brim_ears',
  'painted': 'painted',
};

/**
 * OrcaSlicer timelapse_type values.
 */
const TIMELAPSE_TYPE_MAP: Record<string, string> = {
  'none': '0',
  'smooth': '1',
};

/**
 * Build OrcaSlicer config entries from our settings.
 *
 * Returns Record<string, string> matching OrcaSlicer .ini config keys.
 * These are passed to the libslic3r WASM module via
 * DynamicPrintConfig::set_deserialize_strict().
 */
export function buildOrcaConfig(
  p: PrintProfile,
  f: ResolvedFilamentSettings,
  ps: PrinterSettings,
  pc: PrinterConfig | null,
  extruderCount: number,
): Record<string, string> {
  const config: Record<string, string> = {};

  // Helper: replicate a value for each extruder.
  // OrcaSlicer uses commas for numeric arrays (ConfigOptionFloats/Ints/Percents),
  // semicolons for string arrays (ConfigOptionStrings like filament_colour).
  const perExt = (v: string): string => Array(extruderCount).fill(v).join(',');
  const perExtStr = (v: string): string => Array(extruderCount).fill(v).join(';');

  // ================================================================
  // QUALITY — Layer & Line Width
  // ================================================================
  config['layer_height'] = String(p.layerHeight);
  config['initial_layer_print_height'] = String(p.initialLayerPrintHeight);
  config['adaptive_layer_height'] = p.adaptiveLayerHeight ? '1' : '0';
  config['precise_z_height'] = p.preciseZHeight ? '1' : '0';

  // Line widths (OrcaSlicer uses mm, 0 = auto from nozzle)
  config['line_width'] = String(p.lineWidth);
  config['outer_wall_line_width'] = String(p.outerWallLineWidth);
  config['inner_wall_line_width'] = String(p.innerWallLineWidth);
  config['top_surface_line_width'] = String(p.topSurfaceLineWidth);
  config['internal_solid_infill_line_width'] = String(p.internalSolidInfillLineWidth);
  config['sparse_infill_line_width'] = String(p.sparseInfillLineWidth);
  config['support_line_width'] = String(p.supportLineWidth);
  config['initial_layer_line_width'] = String(p.initialLayerLineWidth);

  // Seam
  config['seam_position'] = SEAM_POSITION_MAP[p.seamPosition] ?? p.seamPosition;
  config['seam_gap'] = String(p.seamGap);
  config['staggered_inner_seams'] = p.staggeredInnerSeams ? '1' : '0';

  // Scarf joint seam
  config['seam_slope_type'] = SEAM_SCARF_TYPE_MAP[p.seamScarfType] ?? p.seamScarfType;
  config['seam_slope_conditional'] = p.scarfSlopeConditional ? '1' : '0';
  config['scarf_angle_threshold'] = String(Math.round(p.scarfAngleThreshold));
  config['scarf_overhang_threshold'] = String(p.scarfOverhangThreshold) + '%';
  config['scarf_joint_speed'] = String(p.scarfJointSpeed);
  config['scarf_joint_flow_ratio'] = String(p.scarfJointFlowRatio);
  config['seam_slope_start_height'] = String(p.scarfStartHeight);
  config['seam_slope_entire_loop'] = p.scarfEntireLoop ? '1' : '0';
  config['seam_slope_min_length'] = String(p.scarfMinLength);
  config['seam_slope_steps'] = String(Math.round(p.scarfSteps));
  config['seam_slope_inner_walls'] = p.scarfInnerWalls ? '1' : '0';
  config['has_scarf_joint_seam'] = p.scarfHasScarf ? '1' : '0';

  // ================================================================
  // WALLS
  // ================================================================
  config['wall_loops'] = String(Math.round(p.wallLoops));
  config['wall_sequence'] = WALL_SEQUENCE_MAP[p.wallSequence] ?? p.wallSequence;
  config['wall_generator'] = p.wallGenerator === 'arachne' ? 'arachne' : 'classic';
  config['precise_outer_wall'] = p.preciseOuterWall ? '1' : '0';
  config['detect_thin_wall'] = p.detectThinWall ? '1' : '0';
  config['detect_overhang_wall'] = p.detectOverhangWall ? '1' : '0';
  config['only_one_wall_first_layer'] = p.onlyOneWallFirstLayer ? '1' : '0';
  config['only_one_wall_top'] = p.onlyOneWallTop ? '1' : '0';
  config['extra_perimeters_on_overhangs'] = p.extraPerimetersOnOverhangs ? '1' : '0';
  config['slowdown_for_curled_perimeters'] = p.slowdownForCurledPerimeters ? '1' : '0';
  config['top_shell_layers'] = String(Math.round(p.topLayers));
  config['bottom_shell_layers'] = String(Math.round(p.bottomLayers));

  // Arachne settings
  config['min_bead_width'] = String(p.minBeadWidth) + '%';
  config['min_feature_size'] = String(p.minFeatureSize) + '%';
  config['wall_transition_angle'] = String(p.wallTransitionAngle);
  config['wall_transition_filter_deviation'] = String(p.wallTransitionFilterDeviation) + '%';
  config['wall_transition_length'] = String(p.wallTransitionLength) + '%';
  config['wall_distribution_count'] = String(Math.round(p.wallDistributionCount));

  // Wall direction & ordering
  config['wall_direction'] = WALL_DIRECTION_MAP[p.wallDirection] ?? p.wallDirection;
  config['is_infill_first'] = p.isInfillFirst ? '1' : '0';
  config['ensure_vertical_shell_thickness'] = ENSURE_VERTICAL_SHELL_MAP[p.ensureVerticalShellThickness] ?? p.ensureVerticalShellThickness;

  // ================================================================
  // INFILL
  // ================================================================
  config['sparse_infill_pattern'] = p.sparseInfillPattern;
  config['sparse_infill_density'] = String(p.sparseInfillDensity) + '%';
  config['infill_direction'] = String(p.infillAngle);
  config['infill_wall_overlap'] = String(p.infillOverlap) + '%';
  config['infill_combination'] = p.infillCombination ? '1' : '0';

  // Surface patterns
  config['top_surface_pattern'] = p.topSurfacePattern;
  config['bottom_surface_pattern'] = p.bottomSurfacePattern;
  config['internal_solid_infill_pattern'] = p.internalSolidInfillPattern;

  // Bridge settings
  config['bridge_flow'] = String(p.bridgeFlow);
  config['internal_bridge_flow'] = String(p.internalBridgeFlow);
  config['bridge_density'] = String(p.bridgeDensity) + '%';
  config['internal_bridge_density'] = String(p.internalBridgeDensity) + '%';
  config['bridge_angle'] = String(p.bridgeAngle);
  config['internal_bridge_angle'] = String(p.internalBridgeAngle);

  // ================================================================
  // SPEED
  // ================================================================
  // Per-feature speeds (mm/s)
  config['outer_wall_speed'] = String(p.outerWallSpeed);
  config['inner_wall_speed'] = String(p.innerWallSpeed);
  config['top_surface_speed'] = String(p.topSurfaceSpeed);
  config['internal_solid_infill_speed'] = String(p.internalSolidInfillSpeed);
  config['sparse_infill_speed'] = String(p.sparseInfillSpeed);
  config['gap_infill_speed'] = String(p.gapFillSpeed);
  config['support_speed'] = String(p.supportSpeed);
  config['bridge_speed'] = String(p.bridgeSpeed);
  config['internal_bridge_speed'] = String(p.internalBridgeSpeed);
  config['small_perimeter_speed'] = String(p.smallPerimeterSpeed);
  config['small_perimeter_threshold'] = String(p.smallPerimeterThreshold);
  config['initial_layer_speed'] = String(p.initialLayerSpeed);
  config['initial_layer_infill_speed'] = String(p.initialLayerInfillSpeed);
  config['initial_layer_travel_speed'] = String(p.initialLayerTravelSpeed);
  config['skirt_speed'] = String(p.skirtSpeed);
  config['travel_speed'] = String(p.travelSpeed);

  // Overhang speed tiers
  config['enable_overhang_speed'] = p.enableOverhangSpeed ? '1' : '0';
  config['overhang_1_4_speed'] = String(p.overhang1_4Speed);
  config['overhang_2_4_speed'] = String(p.overhang2_4Speed);
  config['overhang_3_4_speed'] = String(p.overhang3_4Speed);
  config['overhang_4_4_speed'] = String(p.overhang4_4Speed);

  // Per-feature accelerations (mm/s²)
  config['default_acceleration'] = String(p.defaultAcceleration);
  config['outer_wall_acceleration'] = String(p.outerWallAcceleration);
  config['inner_wall_acceleration'] = String(p.innerWallAcceleration);
  config['top_surface_acceleration'] = String(p.topSurfaceAcceleration);
  config['bridge_acceleration'] = String(p.bridgeAcceleration);
  config['sparse_infill_acceleration'] = String(p.sparseInfillAcceleration);
  config['internal_solid_infill_acceleration'] = String(p.internalSolidInfillAcceleration);
  config['initial_layer_acceleration'] = String(p.initialLayerAcceleration);
  config['travel_acceleration'] = String(p.travelAcceleration);

  // Per-feature jerk (mm/s)
  config['default_jerk'] = String(p.defaultJerk);
  config['outer_wall_jerk'] = String(p.outerWallJerk);
  config['inner_wall_jerk'] = String(p.innerWallJerk);
  config['top_surface_jerk'] = String(p.topSurfaceJerk);
  config['infill_jerk'] = String(p.infillJerk);
  config['travel_jerk'] = String(p.travelJerk);
  config['initial_layer_jerk'] = String(p.initialLayerJerk);

  // Klipper accel-to-decel
  config['accel_to_decel_enable'] = p.accelToDecelEnable ? '1' : '0';
  config['accel_to_decel_factor'] = String(p.accelToDecelFactor) + '%';

  // ================================================================
  // SUPPORT
  // ================================================================
  config['enable_support'] = p.supportEnabled ? '1' : '0';
  config['support_type'] = SUPPORT_TYPE_MAP[p.supportType] ?? p.supportType;
  config['support_threshold_angle'] = String(Math.round(p.supportThresholdAngle));
  config['support_object_xy_distance'] = String(p.supportXYOffset);
  config['support_top_z_distance'] = String(p.supportZGap * p.layerHeight);
  config['support_on_build_plate_only'] = p.supportOnBuildPlateOnly ? '1' : '0';
  config['support_interface_top_layers'] = String(Math.round(p.supportInterfaceLayers));
  config['support_interface_bottom_layers'] = String(Math.round(p.supportInterfaceBottomLayers));
  config['support_style'] = SUPPORT_STYLE_MAP[p.supportStyle] ?? p.supportStyle;
  config['support_base_pattern'] = SUPPORT_BASE_PATTERN_MAP[p.supportBasePattern] ?? p.supportBasePattern;
  config['support_interface_pattern'] = SUPPORT_INTERFACE_PATTERN_MAP[p.supportInterfacePattern] ?? p.supportInterfacePattern;
  config['support_interface_spacing'] = String(p.supportInterfaceSpacing);
  config['support_interface_speed'] = String(p.supportInterfaceSpeed);
  // Support density: OrcaSlicer uses support_base_pattern_spacing (mm)
  // spacing ≈ lineWidth / (density/100)
  if (p.supportDensity > 0) {
    const effectiveLineWidth = p.supportLineWidth > 0 ? p.supportLineWidth : p.lineWidth;
    config['support_base_pattern_spacing'] = String(
      Math.round(effectiveLineWidth / (p.supportDensity / 100) * 10) / 10
    );
  }

  // ================================================================
  // ADHESION
  // ================================================================
  if (p.adhesionType === 'skirt') {
    config['skirt_loops'] = String(Math.round(p.skirtCount));
    config['skirt_distance'] = String(p.skirtDistance);
    config['brim_type'] = 'no_brim';
    config['brim_width'] = '0';
    config['raft_layers'] = '0';
  } else if (p.adhesionType === 'brim') {
    config['skirt_loops'] = '0';
    config['brim_type'] = BRIM_TYPE_MAP[p.brimType] ?? 'auto_brim';
    config['brim_width'] = String(p.brimWidth);
    config['brim_ears_detection_length'] = String(p.brimEarsDetectionLength);
    config['brim_ears_max_angle'] = String(p.brimEarsMaxAngle);
    config['raft_layers'] = '0';
  } else if (p.adhesionType === 'raft') {
    config['skirt_loops'] = '0';
    config['brim_type'] = 'no_brim';
    config['brim_width'] = '0';
    config['raft_layers'] = String(Math.round(p.raftLayers > 0 ? p.raftLayers : 2));
  } else {
    // none
    config['skirt_loops'] = '0';
    config['brim_type'] = 'no_brim';
    config['brim_width'] = '0';
    config['raft_layers'] = '0';
  }

  // ================================================================
  // RETRACTION (per-extruder in OrcaSlicer, semicolon-separated)
  // ================================================================
  // Use profile retraction values, with filament overrides where available
  config['retraction_length'] = perExt(String(f.retractDist));
  config['retraction_speed'] = perExt(String(f.retractSpeed));
  config['deretraction_speed'] = perExt(String(f.deretractionSpeed));
  config['retract_when_changing_layer'] = perExt(p.retractOnLayerChange ? '1' : '0');
  config['retract_lift_above'] = perExt('0');
  config['z_hop'] = perExt(String(p.zHopHeight));
  config['z_hop_types'] = perExt(Z_HOP_TYPE_MAP[p.zHopType] ?? 'Normal Lift');
  config['wipe'] = perExt(p.wipeDistance > 0 ? '1' : '0');
  config['wipe_distance'] = perExt(String(p.wipeDistance));
  config['retraction_length_toolchange'] = perExt(String(p.retractLengthToolchange));

  // ================================================================
  // FILAMENT SETTINGS (per-extruder, semicolon-separated)
  // ================================================================
  config['nozzle_temperature'] = perExt(String(f.nozzleTemp));
  config['nozzle_temperature_initial_layer'] = perExt(String(f.firstLayerNozzleTemp));
  config['hot_plate_temp'] = perExt(String(f.bedTemp));
  config['hot_plate_temp_initial_layer'] = perExt(String(f.firstLayerBedTemp));
  config['cool_plate_temp'] = perExt(String(f.coolPlateTemp));
  config['cool_plate_temp_initial_layer'] = perExt(String(f.coolPlateTempInitialLayer));
  config['eng_plate_temp'] = perExt(String(f.engPlateTemp));
  config['eng_plate_temp_initial_layer'] = perExt(String(f.engPlateTempInitialLayer));
  config['textured_plate_temp'] = perExt(String(f.texturedPlateTemp));
  config['textured_plate_temp_initial_layer'] = perExt(String(f.texturedPlateTempInitialLayer));
  config['fan_max_speed'] = perExt(String(f.fanMaxSpeed));
  config['fan_min_speed'] = perExt(String(f.fanSpeed));
  config['close_fan_the_first_x_layers'] = perExt(String(f.closeFanFirstLayers));
  config['fan_cooling_layer_time'] = perExt(String(f.fanCoolingLayerTime));
  config['slow_down_min_speed'] = perExt(String(f.minSpeed));
  config['slow_down_layer_time'] = perExt(String(f.slowDownLayerTime));
  config['filament_flow_ratio'] = perExt(String(f.flowRatio));
  config['enable_pressure_advance'] = perExt(f.enablePressureAdvance ? '1' : '0');
  config['pressure_advance'] = perExt(String(f.pressureAdvance));
  config['adaptive_pressure_advance'] = perExt(f.adaptivePressureAdvance ? '1' : '0');
  config['overhang_fan_speed'] = perExt(String(f.overhangFanSpeed));
  config['overhang_fan_threshold'] = perExt(String(f.overhangFanThreshold) + '%');
  config['enable_overhang_bridge_fan'] = perExt(f.enableOverhangBridgeFan ? '1' : '0');

  // ================================================================
  // PRINTER SETTINGS
  // ================================================================
  const w = ps.bedWidth;
  const d = ps.bedDepth;
  // OrcaSlicer uses printable_area (semicolon-separated coordinate pairs)
  if (ps.printableArea && ps.printableArea.length >= 3) {
    // Use explicit polygon vertices
    config['printable_area'] = ps.printableArea
      .map((pt) => `${pt.x}x${pt.y}`)
      .join(';');
  } else if (ps.originCenter) {
    config['printable_area'] = `${-w / 2}x${-d / 2};${w / 2}x${-d / 2};${w / 2}x${d / 2};${-w / 2}x${d / 2}`;
  } else {
    config['printable_area'] = `0x0;${w}x0;${w}x${d};0x${d}`;
  }
  config['printable_height'] = String(ps.maxHeight);

  // OrcaSlicer defaults to relative E distances. The validator requires
  // G92 E0 in layer_gcode to reset the extruder position each layer.
  config['use_relative_e_distances'] = '1';
  config['layer_change_gcode'] = 'G92 E0';

  if (ps.startGcode) config['machine_start_gcode'] = convertKlipperToOrcaGcode(ps.startGcode);
  if (ps.endGcode) config['machine_end_gcode'] = convertKlipperToOrcaGcode(ps.endGcode);
  if (ps.toolChangeGcode) config['change_filament_gcode'] = convertKlipperToOrcaGcode(ps.toolChangeGcode);

  // Bed exclude areas (semicolon-separated rectangles: x1xY1;x2xY2 per area, areas separated by newlines)
  if (ps.bedExcludeAreas && ps.bedExcludeAreas.length > 0) {
    config['bed_exclude_area'] = ps.bedExcludeAreas
      .map((a) => `${a.x}x${a.y};${a.x + a.width}x${a.y + a.height}`)
      .join('\n');
  }

  // Printer structure type
  if (ps.printerStructureType) {
    config['printer_structure'] = ps.printerStructureType;
  }

  // Nozzle type and HRC
  if (ps.nozzleType) {
    config['nozzle_type'] = ps.nozzleType;
  }
  if (ps.nozzleHRC > 0) {
    config['nozzle_hrc'] = String(ps.nozzleHRC);
  }

  // Auxiliary fan
  config['auxiliary_fan'] = ps.auxiliaryFan ? '1' : '0';

  // Chamber temperature control
  if (ps.chamberTempControl) {
    config['chamber_temperature'] = '1';
  }

  // Max volumetric speed (printer-level limit)
  if (ps.maxVolumetricSpeed > 0) {
    config['max_volumetric_speed'] = String(ps.maxVolumetricSpeed);
  }

  const nozzle = pc?.nozzleDiameter ?? 0.4;
  const filamentDia = pc?.filamentDiameter ?? 1.75;
  config['nozzle_diameter'] = Array(extruderCount).fill(String(nozzle)).join(',');
  config['filament_diameter'] = Array(extruderCount).fill(String(filamentDia)).join(',');

  // Multi-material
  if (extruderCount > 1) {
    config['single_extruder_multi_material'] = '1';
    config['retraction_length_toolchange'] = perExt(String(p.retractLengthToolchange));

    // Prime tower (wipe tower) is required for tool changes in SEMM mode.
    // OrcaSlicer uses "enable_prime_tower" (not "wipe_tower").
    config['enable_prime_tower'] = p.enablePrimeTower ? '1' : '0';
    config['prime_tower_width'] = String(p.primeTowerWidth);
    config['prime_tower_brim_width'] = String(p.primeTowerBrimWidth);

    // Flush volumes: NxN matrix (row=from, col=to) of purge volumes in mm³.
    // Diagonal is 0 (same filament). Off-diagonal uses profile flush volume.
    const flushVol = p.flushVolume;
    const flushMatrix: number[] = [];
    for (let from = 0; from < extruderCount; from++) {
      for (let to = 0; to < extruderCount; to++) {
        flushMatrix.push(from === to ? 0 : flushVol);
      }
    }
    config['flush_volumes_matrix'] = flushMatrix.join(',');
    // Per-filament flush multipliers (incoming;outgoing pairs)
    const flushVector: number[] = [];
    for (let i = 0; i < extruderCount; i++) {
      flushVector.push(flushVol, flushVol);
    }
    config['flush_volumes_vector'] = flushVector.join(',');

    // Filament colours help OrcaSlicer distinguish extruders visually
    const defaultColors = ['#FF0000', '#FFFFFF', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF'];
    config['filament_colour'] = Array.from({ length: extruderCount }, (_, i) =>
      defaultColors[i % defaultColors.length]
    ).join(';');
  }

  // ================================================================
  // ADVANCED
  // ================================================================
  // Pressure advance (filament-level PA set above; profile-level adaptive PA extras here)
  if (f.adaptivePressureAdvance) {
    config['adaptive_pressure_advance_model'] = String(p.adaptivePAModel);
    config['adaptive_pressure_advance_overhangs'] = p.adaptivePAOverhangs ? '1' : '0';
    config['adaptive_pressure_advance_bridges'] = String(p.adaptivePABridges);
  }

  // Arc fitting
  config['enable_arc_fitting'] = p.arcFittingEnable ? '1' : '0';
  if (p.arcFittingEnable) {
    config['gcode_resolution'] = String(p.gcodeResolution);
  }

  // Fuzzy skin
  config['fuzzy_skin'] = FUZZY_SKIN_TYPE_MAP[p.fuzzySkinType] ?? 'none';
  config['fuzzy_skin_mode'] = FUZZY_SKIN_MODE_MAP[p.fuzzySkinMode] ?? 'displacement';
  if (p.fuzzySkinType !== 'none') {
    config['fuzzy_skin_noise_type'] = FUZZY_SKIN_NOISE_TYPE_MAP[p.fuzzySkinNoiseType] ?? 'classic';
  }
  config['fuzzy_skin_thickness'] = String(p.fuzzySkinThickness);
  config['fuzzy_skin_point_distance'] = String(p.fuzzySkinPointDistance);
  config['fuzzy_skin_first_layer'] = p.fuzzySkinFirstLayer ? '1' : '0';
  config['fuzzy_skin_scale'] = String(p.fuzzySkinScale);
  config['fuzzy_skin_octaves'] = String(Math.round(p.fuzzySkinOctaves));
  config['fuzzy_skin_persistence'] = String(p.fuzzySkinPersistence);

  // Ironing
  config['ironing_type'] = IRONING_TYPE_MAP[p.ironingType] ?? p.ironingType;
  config['ironing_flow'] = String(p.ironingFlow) + '%';
  config['ironing_spacing'] = String(p.ironingSpacing);
  config['ironing_speed'] = String(p.ironingSpeed);
  config['ironing_angle'] = String(p.ironingAngle);

  // Hole-to-polyhole
  config['hole_to_polyhole'] = p.holeToPolyhole ? '1' : '0';
  if (p.holeToPolyhole) {
    config['hole_to_polyhole_threshold'] = String(p.holeToPolyholeThreshold);
    config['hole_to_polyhole_twisted'] = p.holeToPoleholeTwisted ? '1' : '0';
  }

  // Exclude object (label objects for cancellation)
  config['exclude_object'] = p.excludeObject ? '1' : '0';

  // Make overhang printable
  config['make_overhang_printable'] = p.makeOverhangPrintable ? '1' : '0';
  if (p.makeOverhangPrintable) {
    config['make_overhang_printable_angle'] = String(p.makeOverhangPrintableAngle);
    config['make_overhang_printable_hole_size'] = String(p.makeOverhangPrintableHoleSize);
  }

  // Max volumetric flow smoothing
  if (p.maxVolumetricFlowSmoothingRate > 0) {
    config['max_volumetric_extrusion_rate_slope'] = String(p.maxVolumetricFlowSmoothingRate);
    config['max_volumetric_extrusion_rate_slope_segment_length'] = String(p.maxVolumetricFlowSmoothingSegment);
  }

  // Print flow ratio
  config['print_flow_ratio'] = String(p.printFlowRatio);

  // Flow ratios
  config['top_solid_infill_flow_ratio'] = String(p.topSolidInfillFlowRatio);
  config['bottom_solid_infill_flow_ratio'] = String(p.bottomSolidInfillFlowRatio);

  // Gap fill target
  config['gap_fill_target'] = GAP_FILL_TARGET_MAP[p.gapFillTarget] ?? p.gapFillTarget;

  // Retraction advanced
  config['reduce_infill_retraction'] = p.reduceInfillRetraction ? '1' : '0';
  config['use_firmware_retraction'] = p.useFirmwareRetraction ? '1' : '0';

  // Timelapse
  config['timelapse_type'] = TIMELAPSE_TYPE_MAP[p.timelapseType] ?? '0';

  // Spiral/vase mode
  config['spiral_mode'] = p.spiralMode ? '1' : '0';

  // Overhang reverse
  config['overhang_reverse'] = p.overhangReverse ? '1' : '0';
  config['overhang_reverse_internal_only'] = p.overhangReverseInternalOnly ? '1' : '0';
  if (p.overhangReverse) {
    config['overhang_reverse_threshold'] = String(p.overhangReverseThreshold) + '%';
  }

  // Slow down layers (gradual speed increase)
  config['slow_down_layers'] = String(Math.round(p.slowDownLayers));

  return config;
}
