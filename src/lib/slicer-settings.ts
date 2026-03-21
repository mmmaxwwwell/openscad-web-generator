// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shared slicer utilities — Klipper GCode conversion, printer settings type,
 * and STL height extraction.
 *
 * The OrcaSlicer config builder lives in orca-slicer-settings.ts.
 */

/**
 * Map of Klipper-style G-code macro variables to PrusaSlicer/OrcaSlicer placeholder names.
 * Klipper macros use `{var}` syntax; the slicer uses `[var]` for substitution
 * and `{expr}` for expressions — so raw Klipper braces cause parse errors.
 *
 * This mapping converts common Klipper variables so the slicer substitutes the
 * correct values, producing G-code that Klipper can execute directly.
 */
const KLIPPER_TO_SLICER: Record<string, string> = {
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
 * Convert Klipper-style `{variable}` placeholders in G-code to slicer
 * `[variable]` syntax. Unknown `{...}` expressions are left as-is
 * (assumed to be slicer-native expressions).
 */
export function convertKlipperGcode(gcode: string): string {
  return gcode.replace(/\{([^}]+)\}/g, (match, varName: string) => {
    const trimmed = varName.trim();
    const mapped = KLIPPER_TO_SLICER[trimmed];
    if (mapped) return mapped;
    return match;
  });
}

/** A rectangle defined by min/max corners, used for bed exclude areas */
export interface BedExcludeArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Printer structure types supported by OrcaSlicer */
export type PrinterStructureType = 'corexy' | 'i3' | 'hbot' | 'delta' | 'cartesian';

/** Nozzle material types */
export type NozzleType = 'undefine' | 'brass' | 'hardened_steel' | 'stainless_steel';

/** Printer-owned settings (from Moonraker, overridable in dialog) */
export interface PrinterSettings {
  bedWidth: number;
  bedDepth: number;
  maxHeight: number;
  originCenter: boolean;
  startGcode: string;
  endGcode: string;
  toolChangeGcode: string;
  /** Printable area as polygon vertices (for non-rectangular beds).
   * When empty, uses bedWidth x bedDepth rectangle.
   * Each point is {x, y} in mm. */
  printableArea: Array<{ x: number; y: number }>;
  /** Bed exclude areas — rectangles the nozzle should not enter */
  bedExcludeAreas: BedExcludeArea[];
  /** Printer structure/kinematics type */
  printerStructureType: PrinterStructureType;
  /** Nozzle material type */
  nozzleType: NozzleType;
  /** Nozzle HRC (Rockwell hardness), 0 = not specified */
  nozzleHRC: number;
  /** Whether the printer has an auxiliary part cooling fan */
  auxiliaryFan: boolean;
  /** Whether the printer supports active chamber temperature control */
  chamberTempControl: boolean;
  /** Max volumetric speed for the printer (mm³/s), 0 = unlimited */
  maxVolumetricSpeed: number;
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
