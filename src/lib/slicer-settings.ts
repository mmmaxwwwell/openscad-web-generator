// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Slicer settings builders — extracted from PrintDialog for testability.
 *
 * Converts our PrintProfile + ResolvedFilamentSettings + PrinterSettings
 * into PrusaSlicer config key/value pairs (Record<string, string>).
 */

import type { PrintProfile } from '../types/print-profile';
import type { ResolvedFilamentSettings } from '../hooks/usePrinterFilamentOverrides';
import type { PrinterConfig } from './moonraker-api';

/**
 * Map of Klipper-style G-code macro variables to PrusaSlicer placeholder names.
 * Klipper macros use `{var}` syntax; PrusaSlicer uses `[var]` for substitution
 * and `{expr}` for Perl expressions — so raw Klipper braces cause parse errors.
 *
 * This mapping converts common Klipper variables so PrusaSlicer substitutes the
 * correct values, producing G-code that Klipper can execute directly.
 */
const KLIPPER_TO_PRUSASLICER: Record<string, string> = {
  // Bed temperature
  'bed_temp': '[first_layer_bed_temperature]',
  'BED_TEMP': '[first_layer_bed_temperature]',
  'bed_temperature': '[first_layer_bed_temperature]',
  'BED_TEMPERATURE': '[first_layer_bed_temperature]',
  // Extruder/nozzle temperature
  'temp': '[first_layer_temperature]',
  'TEMP': '[first_layer_temperature]',
  'extruder_temp': '[first_layer_temperature]',
  'EXTRUDER_TEMP': '[first_layer_temperature]',
  'hotend_temp': '[first_layer_temperature]',
  'HOTEND_TEMP': '[first_layer_temperature]',
  'nozzle_temp': '[first_layer_temperature]',
  'NOZZLE_TEMP': '[first_layer_temperature]',
  // Tool change — Klipper macros use {tool} for the target extruder index
  'tool': '[next_extruder]',
  'TOOL': '[next_extruder]',
  'tool_nr': '[next_extruder]',
  'TOOL_NR': '[next_extruder]',
};

/**
 * Convert Klipper-style `{variable}` placeholders in G-code to PrusaSlicer
 * `[variable]` syntax. Unknown `{...}` expressions are left as-is, wrapped
 * in a PrusaSlicer comment to prevent parse errors.
 */
export function convertKlipperGcode(gcode: string): string {
  return gcode.replace(/\{([^}]+)\}/g, (match, varName: string) => {
    const trimmed = varName.trim();
    // Only convert known Klipper shorthand variables.
    // Everything else (PrusaSlicer-native expressions like
    // {first_layer_temperature[0]}, {next_extruder}, etc.) passes through
    // unchanged — PrusaSlicer's template engine handles them natively.
    const mapped = KLIPPER_TO_PRUSASLICER[trimmed];
    if (mapped) return mapped;
    return match;
  });
}

/** Printer-owned settings (from Moonraker, overridable in dialog) */
export interface PrinterSettings {
  bedWidth: number;
  bedDepth: number;
  maxHeight: number;
  originCenter: boolean;
  startGcode: string;
  endGcode: string;
  toolChangeGcode: string;
}

/**
 * Compute model height from binary STL data by scanning Z coordinates.
 * Returns the max Z value (assumes model sits on the bed at Z=0).
 */
export function getModelHeightFromSTL(stlData: ArrayBuffer): number {
  if (stlData.byteLength < 84) return 0;
  const view = new DataView(stlData);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  if (stlData.byteLength < expectedSize) return 0;
  let maxZ = 0;
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50;
    for (const vOff of [12, 24, 36]) {
      const z = view.getFloat32(base + vOff + 8, true);
      if (z > maxZ) maxZ = z;
    }
  }
  return maxZ;
}

/**
 * Build PrusaSlicer config entries from our settings.
 *
 * Returns Record<string, string> matching PrusaSlicer .ini config keys.
 * These are passed to the libslic3r WASM module via DynamicPrintConfig::set_deserialize_strict().
 *
 */
export function buildPrusaConfig(
  p: PrintProfile,
  f: ResolvedFilamentSettings,
  ps: PrinterSettings,
  pc: PrinterConfig | null,
  extruderCount: number,
): Record<string, string> {
  const config: Record<string, string> = {};

  // --- Print profile settings ---
  config['layer_height'] = String(p.layerHeight);
  config['first_layer_height'] = String(p.firstLayerHeight);
  config['extrusion_width'] = String(p.lineWidth);
  config['perimeters'] = String(p.shellCount);
  config['top_solid_layers'] = String(p.topLayers);
  config['bottom_solid_layers'] = String(p.bottomLayers);
  config['external_perimeters_first'] = p.shellOrder === 'out-in' ? '1' : '0';
  config['fill_density'] = `${Math.round(p.infillDensity * 100)}%`;
  config['fill_pattern'] = p.infillPattern;
  config['fill_angle'] = String(p.infillAngle);
  config['infill_overlap'] = `${Math.round(p.infillOverlap * 100)}%`;
  config['travel_speed'] = String(p.travelSpeed);
  config['first_layer_speed'] = String(p.firstLayerSpeed);
  config['first_layer_infill_speed'] = String(p.firstLayerFillSpeed);
  config['external_perimeter_speed'] = p.outerWallSpeed > 0 ? String(p.outerWallSpeed) : '50%';

  // Support
  config['support_material'] = p.supportEnabled ? '1' : '0';
  config['support_material_threshold'] = String(p.supportAngle);
  // PrusaSlicer uses spacing (mm) not density — convert: spacing ≈ lineWidth / density
  config['support_material_spacing'] = p.supportDensity > 0
    ? String(Math.round(p.lineWidth / p.supportDensity * 10) / 10)
    : '2';
  config['support_material_xy_spacing'] = String(p.supportXYOffset);
  config['support_material_contact_distance'] = String(p.supportZGap * p.layerHeight);

  // Adhesion
  if (p.adhesionType === 'skirt') {
    config['skirts'] = String(p.skirtCount);
    config['brim_width'] = '0';
    config['raft_layers'] = '0';
  } else if (p.adhesionType === 'brim') {
    config['skirts'] = '0';
    config['brim_width'] = String(p.brimWidth);
    config['raft_layers'] = '0';
  } else if (p.adhesionType === 'raft') {
    config['skirts'] = '0';
    config['brim_width'] = '0';
    config['raft_layers'] = '2';
  } else {
    config['skirts'] = '0';
    config['brim_width'] = '0';
    config['raft_layers'] = '0';
  }

  // Helper: replicate a value for each extruder (PrusaSlicer per-extruder settings)
  const perExt = (v: string): string => Array(extruderCount).fill(v).join(',');

  // Retraction (per-extruder in PrusaSlicer)
  config['retract_length'] = perExt(String(f.retractDist));
  config['retract_speed'] = perExt(String(f.retractSpeed));
  config['retract_layer_change'] = perExt(p.retractOnLayerChange ? '1' : '0');
  config['retract_lift'] = perExt(String(p.zHopHeight));
  config['wipe'] = perExt(p.wipeDistance > 0 ? '1' : '0');

  // --- Filament settings (per-extruder in PrusaSlicer) ---
  config['temperature'] = perExt(String(f.nozzleTemp));
  config['bed_temperature'] = perExt(String(f.bedTemp));
  config['first_layer_temperature'] = perExt(String(f.firstLayerNozzleTemp));
  config['first_layer_bed_temperature'] = perExt(String(f.firstLayerBedTemp));
  config['max_fan_speed'] = perExt(String(f.fanSpeed));
  config['min_fan_speed'] = perExt(String(f.fanSpeed));
  config['disable_fan_first_layers'] = perExt(f.firstLayerFan === 0 ? '1' : '0');
  config['perimeter_speed'] = String(f.printSpeed);
  config['infill_speed'] = String(f.printSpeed);
  config['solid_infill_speed'] = String(f.printSpeed);
  config['top_solid_infill_speed'] = String(Math.round(f.printSpeed * 0.5));
  config['support_material_speed'] = String(f.printSpeed);
  config['gap_fill_speed'] = String(f.printSpeed);
  config['bridge_speed'] = String(Math.round(f.printSpeed * 0.5));
  config['min_print_speed'] = String(f.minSpeed);
  config['slowdown_below_layer_time'] = String(f.minLayerTime);

  // --- Printer settings ---
  const w = ps.bedWidth;
  const d = ps.bedDepth;
  if (ps.originCenter) {
    config['bed_shape'] = `${-w / 2}x${-d / 2},${w / 2}x${-d / 2},${w / 2}x${d / 2},${-w / 2}x${d / 2}`;
  } else {
    config['bed_shape'] = `0x0,${w}x0,${w}x${d},0x${d}`;
  }
  config['max_print_height'] = String(ps.maxHeight);
  if (ps.startGcode) config['start_gcode'] = convertKlipperGcode(ps.startGcode);
  if (ps.endGcode) config['end_gcode'] = convertKlipperGcode(ps.endGcode);
  if (ps.toolChangeGcode) config['toolchange_gcode'] = convertKlipperGcode(ps.toolChangeGcode);

  const nozzle = pc?.nozzleDiameter ?? 0.4;
  const filamentDia = pc?.filamentDiameter ?? 1.75;
  config['nozzle_diameter'] = Array(extruderCount).fill(String(nozzle)).join(',');
  config['filament_diameter'] = Array(extruderCount).fill(String(filamentDia)).join(',');

  // Multi-material mode: PrusaSlicer needs this flag to generate tool changes
  // when a 3MF has per-volume extruder assignments.
  if (extruderCount > 1) {
    config['single_extruder_multi_material'] = '1';
    config['retract_length_toolchange'] = perExt('10');
    config['retract_restart_extra_toolchange'] = perExt('0');
  }

  // Arc fitting → gcode_resolution (lower = more arcs)
  if (p.arcEnabled) {
    config['gcode_resolution'] = '0.0125';
  }

  return config;
}
