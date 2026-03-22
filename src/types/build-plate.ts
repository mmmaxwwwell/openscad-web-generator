// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Build Plate types — multi-object build plate for placing, configuring,
 * and slicing multiple objects in a single print job.
 */

import type { PrintProfile } from './print-profile';
import type { ScadParam, ScadValue } from './index';

// ============================================================
// Object source types
// ============================================================

/** How the object was added to the plate */
export type BuildPlateObjectType = 'scad' | 'stl' | '3mf';

/** Format of the stored mesh data */
export type MeshFormat = 'stl' | '3mf';

// ============================================================
// BuildPlateObject
// ============================================================

/**
 * A single object on the build plate.
 *
 * Position/rotation/scale are in model space (X right, Y back, Z up, mm).
 * The 3D canvas converts to Three.js coordinates for display.
 */
export interface BuildPlateObject {
  /** Unique identifier (crypto.randomUUID or similar) */
  id: string;

  /** Display name (auto-generated from filename, user-editable) */
  name: string;

  /** How this object was created/imported */
  type: BuildPlateObjectType;

  /** Raw mesh data (STL binary or 3MF ZIP) */
  meshData: ArrayBuffer;

  /** Format of meshData — determines which loader/slicer method to use */
  meshFormat: MeshFormat;

  /**
   * Color groups extracted from 3MF metadata (for multicolor objects).
   * Maps volume/triangle-group index to hex color string.
   * Undefined for single-color objects.
   */
  colorGroups?: Array<{ color: string; name?: string }>;

  // -- Transform (model space) --

  /** Position on the bed in mm (X right, Y back from origin) */
  position: { x: number; y: number };

  /** Rotation around Z axis in degrees */
  rotation: number;

  /** Scale factors per axis (1.0 = original size) */
  scale: { x: number; y: number; z: number };

  // -- SCAD source (only for type === 'scad') --

  /** Storage ID of the original .scad file */
  scadFileId?: string;

  /** Full .scad source code (for re-rendering) */
  scadSource?: string;

  /** Current parameter values (for re-rendering) */
  scadParams?: Record<string, ScadValue>;

  /** Parsed parameter definitions (for the parameter editor UI) */
  scadParamDefs?: ScadParam[];

  // -- Per-object print settings --

  /**
   * Per-object print setting overrides.
   * Only fields explicitly set by the user are present.
   * At slice time, merged with plate profile: `{ ...plateProfile, ...printOverrides }`.
   * Undefined or empty = inherit all settings from plate profile.
   */
  printOverrides?: Partial<PrintProfile>;

  /**
   * Extruder assignment for multicolor objects.
   * Index into the printer's extruder list (0-based).
   * For single-extruder printers, always 0.
   * For multicolor 3MF objects, each volume has its own extruder
   * (stored in the 3MF metadata, not here).
   */
  extruderAssignment?: number;

  /**
   * Number of copies of this object to place.
   * 1 = single instance (default). >1 = multiple instances arranged automatically.
   * Each copy shares the same mesh data and settings but gets its own position.
   */
  copies?: number;
}

// ============================================================
// Prime Tower Config
// ============================================================

/** Configuration for the prime/wipe tower used in multi-material prints */
export interface PrimeTowerConfig {
  /** Whether the prime tower is enabled */
  enabled: boolean;

  /** Position of the tower center on the bed (mm) */
  position: { x: number; y: number };

  /** Tower width in mm (square footprint: width × width) */
  width: number;

  /** Brim width around the tower in mm */
  brimWidth: number;
}

// ============================================================
// Flush Volume Config
// ============================================================

/**
 * Flush (purge) volume configuration for multi-material prints.
 * Controls how much filament is purged when switching between extruders.
 */
export interface FlushVolumeConfig {
  /**
   * NxN flush volume matrix, stored as a flat row-major array.
   * Index `from * N + to` = purge volume (mm³) when switching from
   * extruder `from` to extruder `to`. Diagonal entries (same extruder) = 0.
   * Length must be N*N where N = extruder count.
   * When undefined, defaults are generated from `plateProfile.flushVolume`.
   */
  matrix: number[];

  /**
   * Global multiplier applied to all matrix values before sending to slicer.
   * 1.0 = use matrix values as-is. Range: 0.0–3.0.
   * Default: 1.0.
   */
  multiplier: number;

  /** Number of extruders this matrix was sized for */
  extruderCount: number;
}

// ============================================================
// BuildPlate
// ============================================================

/** Print sequence mode — how multiple objects are printed */
export type PrintSequence = 'by_layer' | 'by_object';

/**
 * The build plate — contains all objects, plate-level settings,
 * and printer bed configuration.
 */
export interface BuildPlate {
  /** All objects on the plate, in print order (for by-object mode) */
  objects: BuildPlateObject[];

  /** Plate-level print profile (applies to all objects unless overridden) */
  plateProfile: PrintProfile;

  /** Prime tower configuration */
  primeTower: PrimeTowerConfig;

  /** Flush volume configuration for multi-extruder prints */
  flushVolumeConfig?: FlushVolumeConfig;

  /** Print sequence mode */
  printSequence: PrintSequence;

  // -- Bed dimensions (from printer profile) --

  /** Bed width in mm (X axis) */
  bedWidth: number;

  /** Bed depth in mm (Y axis) */
  bedDepth: number;

  /** Maximum print height in mm (Z axis) */
  maxHeight: number;

  /**
   * Whether the bed origin is at the center (true) or front-left corner (false).
   * Affects how object positions map to slicer coordinates.
   */
  originCenter: boolean;
}

// ============================================================
// PlateSliceJob — structured data sent to the slicer worker
// ============================================================

/** A single object in a slice job, with resolved config */
export interface PlateSliceJobObject {
  /** Raw mesh data */
  data: ArrayBuffer;

  /** Mesh format */
  format: MeshFormat;

  /** Absolute position on bed (mm) */
  posX: number;
  posY: number;

  /** Rotation around Z in degrees */
  rotZ: number;

  /** Scale factors */
  scaleX: number;
  scaleY: number;
  scaleZ: number;

  /**
   * Per-object config overrides (OrcaSlicer .ini key/value pairs).
   * Only contains keys that differ from the global config.
   */
  config?: Record<string, string>;
}

/** Complete slice job for the slicer worker */
export interface PlateSliceJob {
  /** Objects to slice, in order */
  objects: PlateSliceJobObject[];

  /** Global config (OrcaSlicer .ini key/value pairs) */
  globalConfig: Record<string, string>;

  /** Print sequence mode */
  printSequence: PrintSequence;
}
