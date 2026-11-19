// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Build plate slicer utilities.
 *
 * Handles settings merging, config generation, validation, and auto-arrange
 * for multi-object build plates.
 */

import type { PrintProfile } from '../types/print-profile';
import type {
  BuildPlate,
  BuildPlateObject,
  PrimeTowerConfig,
  PlateSliceJob,
  PlateSliceJobObject,
} from '../types/build-plate';
import type { ResolvedFilamentSettings } from '../hooks/usePrinterFilamentOverrides';
import type { PrinterSettings } from './slicer-settings';
import type { PrinterConfig } from './moonraker-api';
import { buildOrcaConfig } from './orca-slicer-settings';
import { unzipSync, zipSync } from 'fflate';

/**
 * Merge plate-level profile with per-object overrides.
 * Only fields explicitly present in `overrides` win; everything else
 * comes from the plate profile.
 */
export function mergeObjectSettings(
  plateProfile: PrintProfile,
  overrides?: Partial<PrintProfile>,
): PrintProfile {
  if (!overrides) return { ...plateProfile };
  // Shallow merge — override fields win. We iterate own enumerable keys
  // so that `undefined` values in overrides do NOT replace plate defaults.
  const merged = { ...plateProfile };
  for (const key of Object.keys(overrides) as Array<keyof PrintProfile>) {
    const val = overrides[key];
    if (val !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[key] = val;
    }
  }
  return merged;
}

/**
 * Compute the per-object OrcaSlicer config diff — only keys that differ
 * from the global (plate-level) config.
 */
function objectConfigDiff(
  globalConfig: Record<string, string>,
  objectConfig: Record<string, string>,
): Record<string, string> | undefined {
  const diff: Record<string, string> = {};
  let hasDiff = false;
  for (const [key, val] of Object.entries(objectConfig)) {
    if (globalConfig[key] !== val) {
      diff[key] = val;
      hasDiff = true;
    }
  }
  return hasDiff ? diff : undefined;
}

/**
 * Build a complete PlateSliceJob from a BuildPlate and slicer settings.
 *
 * For each object, merges plate profile + per-object overrides, generates
 * OrcaSlicer config, and diffs against the global config so the slicer
 * worker only receives per-object overrides.
 */
export function buildPlateSliceConfig(
  plate: BuildPlate,
  filamentSettings: ResolvedFilamentSettings,
  printerSettings: PrinterSettings,
  printerConfig: PrinterConfig | null,
  extruderCount: number,
): PlateSliceJob {
  // Global config from the plate-level profile
  const globalConfig = buildOrcaConfig(
    plate.plateProfile,
    filamentSettings,
    printerSettings,
    printerConfig,
    extruderCount,
  );

  // Override prime tower position from plate config
  if (plate.primeTower.enabled && extruderCount > 1) {
    globalConfig['wipe_tower_x'] = String(plate.primeTower.position.x);
    globalConfig['wipe_tower_y'] = String(plate.primeTower.position.y);
  }

  // Override flush volumes if custom matrix is configured
  if (plate.flushVolumeConfig && extruderCount > 1) {
    const fvc = plate.flushVolumeConfig;
    const n = fvc.extruderCount;
    const mult = fvc.multiplier;
    // Apply multiplier and flatten to comma-separated string
    const scaledMatrix = fvc.matrix.map((v, i) => {
      const from = Math.floor(i / n);
      const to = i % n;
      return from === to ? 0 : Math.round(v * mult);
    });
    globalConfig['flush_volumes_matrix'] = scaledMatrix.join(',');
  }

  const objects: PlateSliceJobObject[] = plate.objects.map((obj) => {
    // Per-object config diff (only if object has overrides)
    let config: Record<string, string> | undefined;
    if (obj.printOverrides && Object.keys(obj.printOverrides).length > 0) {
      const mergedProfile = mergeObjectSettings(plate.plateProfile, obj.printOverrides);
      const fullObjectConfig = buildOrcaConfig(
        mergedProfile,
        filamentSettings,
        printerSettings,
        printerConfig,
        extruderCount,
      );
      config = objectConfigDiff(globalConfig, fullObjectConfig);
    }

    // Per-volume extruder assignments (convert 0-based UI → 1-based OrcaSlicer)
    let volumeExtruders: Record<number, number> | undefined;
    if (obj.volumeExtruders && obj.colorGroups && obj.colorGroups.length > 1) {
      volumeExtruders = {};
      for (const [volIdx, extruder] of Object.entries(obj.volumeExtruders)) {
        // OrcaSlicer uses 1-based extruder indices
        volumeExtruders[Number(volIdx)] = extruder + 1;
      }
    }

    return {
      data: obj.meshData,
      format: obj.meshFormat,
      posX: obj.position.x,
      posY: obj.position.y,
      rotZ: obj.rotation,
      scaleX: obj.scale.x,
      scaleY: obj.scale.y,
      scaleZ: obj.scale.z,
      config,
      volumeExtruders,
    };
  });

  return {
    objects,
    globalConfig,
    printSequence: plate.printSequence,
  };
}

/**
 * Validate a build plate before slicing.
 * Returns an array of human-readable error strings (empty = valid).
 */
export function validatePlateForSlicing(plate: BuildPlate): string[] {
  const errors: string[] = [];

  if (plate.objects.length === 0) {
    errors.push('No objects on the build plate.');
    return errors;
  }

  const { bedWidth, bedDepth, originCenter } = plate;

  // Compute bed bounds
  const minX = originCenter ? -bedWidth / 2 : 0;
  const maxX = originCenter ? bedWidth / 2 : bedWidth;
  const minY = originCenter ? -bedDepth / 2 : 0;
  const maxY = originCenter ? bedDepth / 2 : bedDepth;

  for (const obj of plate.objects) {
    const { x, y } = obj.position;
    if (x < minX || x > maxX) {
      errors.push(`Object "${obj.name}" is outside bed bounds on X axis (${x}mm).`);
    }
    if (y < minY || y > maxY) {
      errors.push(`Object "${obj.name}" is outside bed bounds on Y axis (${y}mm).`);
    }
  }

  if (plate.printSequence === 'by_object' && plate.objects.length > 1) {
    // Warn about by-object mode clearance — we do a simple check that
    // objects don't share the same position (full collision detection
    // requires mesh bounding boxes which we don't have here).
    const positions = plate.objects.map((o) => `${o.position.x},${o.position.y}`);
    const unique = new Set(positions);
    if (unique.size < positions.length) {
      errors.push(
        'By-object print sequence: multiple objects share the same position. ' +
        'Ensure sufficient clearance between objects for the printhead.',
      );
    }
  }

  return errors;
}

// ─── Prime tower sizing from flush volumes ───────────────

/**
 * Convert flush volume (mm³) to extrusion length (mm).
 * Matches OrcaSlicer WipeTower2.cpp `volume_to_length()`.
 *
 * Cross-section area of a "squished" line = h * (w - h * (1 - π/4))
 * where h = layer height, w = line width.
 */
function volumeToLength(volume: number, lineWidth: number, layerHeight: number): number {
  const area = layerHeight * (lineWidth - layerHeight * (1 - Math.PI / 4));
  return area > 0 ? Math.max(0, volume / area) : 0;
}

/**
 * Compute the tower depth (mm) consumed by a single purge operation.
 * Matches OrcaSlicer WipeTower2.cpp `get_wipe_depth()`.
 *
 * @param volume     - flush volume in mm³
 * @param layerHeight - layer height in mm
 * @param lineWidth   - perimeter width in mm
 * @param towerWidth  - tower width in mm (X dimension)
 * @param extraFlow   - wipe tower extra flow multiplier (default 1.0)
 * @param extraSpacing - wipe tower extra spacing multiplier (default 1.0)
 */
function getWipeDepth(
  volume: number,
  layerHeight: number,
  lineWidth: number,
  towerWidth: number,
  extraFlow = 1.0,
  extraSpacing = 1.0,
): number {
  const effectiveWidth = towerWidth - 3 * lineWidth;
  if (effectiveWidth <= 0) return 0;
  const lengthToExtrude = Math.max(0, volumeToLength(volume, lineWidth, layerHeight) / extraFlow);
  const passes = Math.floor(lengthToExtrude / effectiveWidth) + 1;
  return passes * lineWidth * extraSpacing;
}

/**
 * Compute the estimated prime tower depth for given flush volumes and tower width.
 * This is the depth the slicer will actually generate — useful for UI display
 * and for computing a recommended tower width.
 *
 * Returns the worst-case depth across all possible tool changes (the tower
 * must accommodate the single largest purge on any layer).
 */
export function computePrimeTowerDepth(
  maxFlushVolume: number,
  towerWidth: number,
  layerHeight: number,
  lineWidth: number,
): number {
  return getWipeDepth(maxFlushVolume, layerHeight, lineWidth, towerWidth);
}

/**
 * Compute a recommended prime tower width that produces a roughly square
 * footprint for the given maximum flush volume.
 *
 * Uses OrcaSlicer's formula to find the width where depth ≈ width,
 * via binary search. Falls back to 35mm minimum, 150mm maximum.
 */
export function computeRecommendedPrimeTowerWidth(
  maxFlushVolume: number,
  layerHeight: number,
  lineWidth: number,
): number {
  if (maxFlushVolume <= 0) return 35;

  const MIN_WIDTH = 35;
  const MAX_WIDTH = 150;

  // Binary search for width where depth ≈ width (square footprint)
  let lo = MIN_WIDTH;
  let hi = MAX_WIDTH;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const depth = getWipeDepth(maxFlushVolume, layerHeight, lineWidth, mid);
    if (depth > mid) {
      lo = mid; // tower too narrow, depth exceeds width → make wider
    } else {
      hi = mid; // tower is wide enough
    }
  }

  // Round to nearest integer
  return Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, (lo + hi) / 2)));
}

/**
 * Get the maximum flush volume from a flush volume matrix (applying multiplier).
 * Returns the largest off-diagonal value × multiplier.
 */
export function getMaxFlushVolume(
  matrix: number[],
  extruderCount: number,
  multiplier: number,
): number {
  let max = 0;
  for (let from = 0; from < extruderCount; from++) {
    for (let to = 0; to < extruderCount; to++) {
      if (from === to) continue;
      const vol = matrix[from * extruderCount + to] * multiplier;
      if (vol > max) max = vol;
    }
  }
  return max;
}

// ─── Bounding box utilities ──────────────────────────────

/** Axis-aligned bounding box dimensions in model space (mm) */
export interface MeshBounds {
  width: number;  // X extent
  depth: number;  // Y extent
  height: number; // Z extent
}

/**
 * Parse a binary STL and compute axis-aligned bounding box dimensions.
 * Returns null if the buffer is too small or malformed.
 */
export function computeSTLBoundingBox(data: ArrayBuffer): MeshBounds | null {
  if (data.byteLength < 84) return null;
  const view = new DataView(data);
  const triangleCount = view.getUint32(80, true);
  const expectedSize = 84 + triangleCount * 50;
  if (data.byteLength < expectedSize || triangleCount === 0) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < triangleCount; i++) {
    const base = 84 + i * 50 + 12; // skip header(80) + count(4) + normal(12)
    for (let v = 0; v < 3; v++) {
      const off = base + v * 12;
      const x = view.getFloat32(off, true);
      const y = view.getFloat32(off + 4, true);
      const z = view.getFloat32(off + 8, true);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  if (!isFinite(minX)) return null;
  return { width: maxX - minX, depth: maxY - minY, height: maxZ - minZ };
}

/**
 * Parse a 3MF (ZIP of XML) and compute axis-aligned bounding box dimensions.
 * Extracts vertex data from the 3dmodel.model XML file.
 * Returns null if the 3MF can't be parsed.
 */
export function compute3MFBoundingBox(data: ArrayBuffer): MeshBounds | null {
  try {
    const unzipped = unzipSync(new Uint8Array(data));

    let modelXml: string | undefined;
    for (const [path, bytes] of Object.entries(unzipped)) {
      if (path.toLowerCase().endsWith('3dmodel.model')) {
        modelXml = new TextDecoder().decode(bytes);
        break;
      }
    }
    if (!modelXml) return null;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    // Match <vertex x="..." y="..." z="..." /> elements
    const vertexRe = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = vertexRe.exec(modelXml)) !== null) {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      const z = parseFloat(match[3]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    if (!isFinite(minX)) return null;
    return { width: maxX - minX, depth: maxY - minY, height: maxZ - minZ };
  } catch {
    return null;
  }
}

/**
 * Compute bounding box for a mesh, dispatching by format.
 * Applies scale factors to the result. Rotation is handled separately
 * by the arrange algorithm (swapping width/depth for 90° rotation).
 */
export function computeMeshBoundingBox(
  data: ArrayBuffer,
  format: 'stl' | '3mf',
  scale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 },
): MeshBounds | null {
  const bounds = format === 'stl'
    ? computeSTLBoundingBox(data)
    : compute3MFBoundingBox(data);
  if (!bounds) return null;
  return {
    width: bounds.width * Math.abs(scale.x),
    depth: bounds.depth * Math.abs(scale.y),
    height: bounds.height * Math.abs(scale.z),
  };
}

// ─── Auto-arrange ────────────────────────────────────────

/** Footprint rectangle used for placement collision detection */
interface PlacedRect {
  x: number;     // center X
  y: number;     // center Y
  halfW: number; // half-width of object (not including spacing)
  halfD: number; // half-depth of object (not including spacing)
}

/**
 * Check if two rectangles overlap, accounting for required spacing gap.
 * Each rect stores pure object half-extents; spacing is checked separately.
 */
function rectsOverlap(a: PlacedRect, b: PlacedRect, spacing: number): boolean {
  return Math.abs(a.x - b.x) < (a.halfW + b.halfW + spacing)
      && Math.abs(a.y - b.y) < (a.halfD + b.halfD + spacing);
}

/** Options for auto-arrange */
export interface AutoArrangeOptions {
  /** Spacing between objects in mm (default 10) */
  spacing?: number;
  /** Fallback size when bounding box can't be computed (default 30mm) */
  fallbackSize?: number;
  /** Prime tower to reserve space for */
  primeTower?: PrimeTowerConfig;
  /** Whether to try 90° rotation for better fit (default true) */
  tryRotation?: boolean;
}

/**
 * Auto-arrange objects on the build plate using bottom-left bin-packing
 * with actual mesh bounding boxes.
 *
 * Algorithm:
 * 1. Compute bounding box for each object from mesh data
 * 2. Sort by footprint area (largest first) for better packing
 * 3. Place each object at the lowest-Y, leftmost-X position that doesn't
 *    overlap placed objects or the prime tower
 * 4. Optionally try 90° rotation and pick the better fit
 * 5. Returns new objects with updated positions (and possibly rotation)
 *    without mutating inputs
 */
export function autoArrangeObjects(
  objects: BuildPlateObject[],
  bedWidth: number,
  bedDepth: number,
  originCenter: boolean,
  spacingOrOptions?: number | AutoArrangeOptions,
  estimatedObjectSize?: number,
): BuildPlateObject[] {
  if (objects.length === 0) return [];

  // Parse options — backward compatible with old (spacing, estimatedObjectSize) signature
  let spacing = 10;
  let fallbackSize = estimatedObjectSize ?? 30;
  let primeTower: PrimeTowerConfig | undefined;
  let tryRotation = true;

  if (typeof spacingOrOptions === 'number') {
    spacing = spacingOrOptions;
  } else if (spacingOrOptions) {
    spacing = spacingOrOptions.spacing ?? 10;
    fallbackSize = spacingOrOptions.fallbackSize ?? fallbackSize;
    primeTower = spacingOrOptions.primeTower;
    tryRotation = spacingOrOptions.tryRotation ?? true;
  }

  // Bed bounds
  const bedMinX = originCenter ? -bedWidth / 2 : 0;
  const bedMinY = originCenter ? -bedDepth / 2 : 0;
  const bedMaxX = originCenter ? bedWidth / 2 : bedWidth;
  const bedMaxY = originCenter ? bedDepth / 2 : bedDepth;

  // Compute bounding boxes for each object
  const objBounds: Array<{ obj: BuildPlateObject; w: number; d: number; index: number }> = [];
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const bounds = computeMeshBoundingBox(obj.meshData, obj.meshFormat, obj.scale);

    let w: number, d: number;
    if (bounds) {
      // Apply existing rotation to get rotated bounding box
      const rotRad = (obj.rotation % 180) * Math.PI / 180;
      const cosR = Math.abs(Math.cos(rotRad));
      const sinR = Math.abs(Math.sin(rotRad));
      w = bounds.width * cosR + bounds.depth * sinR;
      d = bounds.width * sinR + bounds.depth * cosR;
    } else {
      w = fallbackSize;
      d = fallbackSize;
    }
    objBounds.push({ obj, w, d, index: i });
  }

  // Sort by footprint area (largest first) for better packing
  const sorted = [...objBounds].sort((a, b) => (b.w * b.d) - (a.w * a.d));

  // Initialize placed rectangles with prime tower if enabled
  const placed: PlacedRect[] = [];
  if (primeTower?.enabled) {
    const towerHalfSize = (primeTower.width + primeTower.brimWidth * 2) / 2;
    placed.push({
      x: primeTower.position.x,
      y: primeTower.position.y,
      halfW: towerHalfSize,
      halfD: towerHalfSize,
    });
  }

  // Placement step size (1mm grid for reasonable precision vs speed)
  const step = 1;

  // Result array — fill in original order
  const result: BuildPlateObject[] = new Array(objects.length);

  for (const item of sorted) {
    const halfW = item.w / 2;
    const halfD = item.d / 2;

    let bestX = bedMinX + spacing + halfW;
    let bestY = bedMinY + spacing + halfD;
    let bestRot = item.obj.rotation;
    let foundFit = false;

    // Try both original dimensions and 90° rotated
    const orientations: Array<{ hw: number; hd: number; rotDelta: number }> = [
      { hw: halfW, hd: halfD, rotDelta: 0 },
    ];
    if (tryRotation && Math.abs(item.w - item.d) > 1) {
      orientations.push({
        hw: item.d / 2,
        hd: item.w / 2,
        rotDelta: 90,
      });
    }

    let bestScore = Infinity; // lower Y, then lower X = better

    for (const orient of orientations) {
      // spacing from bed edge + object half-extent
      const startX = bedMinX + spacing + orient.hw;
      const endX = bedMaxX - spacing - orient.hw;
      const startY = bedMinY + spacing + orient.hd;
      const endY = bedMaxY - spacing - orient.hd;

      if (startX > endX || startY > endY) continue;

      for (let cy = startY; cy <= endY; cy += step) {
        for (let cx = startX; cx <= endX; cx += step) {
          const candidate: PlacedRect = { x: cx, y: cy, halfW: orient.hw, halfD: orient.hd };
          let overlaps = false;
          for (const p of placed) {
            if (rectsOverlap(candidate, p, spacing)) {
              overlaps = true;
              break;
            }
          }
          if (!overlaps) {
            const score = cy * 100000 + cx; // prioritize lower Y, then lower X
            if (score < bestScore) {
              bestScore = score;
              bestX = cx;
              bestY = cy;
              bestRot = item.obj.rotation + orient.rotDelta;
              foundFit = true;
            }
            // Found best X for this Y row, move to next Y
            break;
          }
        }
        if (foundFit && orientations.length === 1) break;
        if (foundFit && cy > bestY) break;
      }
    }

    // Overflow fallback: place beyond existing objects in Y direction
    if (!foundFit) {
      let maxPlacedBottom = bedMinY;
      for (const p of placed) {
        const bottom = p.y + p.halfD;
        if (bottom > maxPlacedBottom) maxPlacedBottom = bottom;
      }
      bestX = bedMinX + spacing + halfW;
      bestY = maxPlacedBottom + spacing + halfD;
    }

    // Record placed rect (using actual half-extent for the chosen orientation)
    const finalHalfW = bestRot !== item.obj.rotation ? item.d / 2 : halfW;
    const finalHalfD = bestRot !== item.obj.rotation ? item.w / 2 : halfD;
    placed.push({ x: bestX, y: bestY, halfW: finalHalfW, halfD: finalHalfD });

    result[item.index] = {
      ...item.obj,
      position: { x: bestX, y: bestY },
      rotation: bestRot,
    };
  }

  return result;
}

// ─── Lay Flat utilities ──────────────────────────────────

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < 1e-10) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Rotate a vector by angle (radians) around a normalized axis (Rodrigues' formula) */
function rotateVec3(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = vec3Dot(axis, v);
  const cross = vec3Cross(axis, v);
  return {
    x: v.x * cos + cross.x * sin + axis.x * dot * (1 - cos),
    y: v.y * cos + cross.y * sin + axis.y * dot * (1 - cos),
    z: v.z * cos + cross.z * sin + axis.z * dot * (1 - cos),
  };
}

/**
 * Analyze face normals and areas to find the best rotation that places
 * the largest flat surface on the bed (facing -Z).
 *
 * Works with a list of (normal, area) pairs extracted from any mesh format.
 * Returns rotation axis + angle, or null if the mesh is already well-oriented.
 */
export function findLayFlatRotation(
  faces: Array<{ normal: Vec3; area: number }>,
): { axis: Vec3; angle: number } | null {
  if (faces.length === 0) return null;

  // Cluster normals by quantizing to ~10° bins in spherical coordinates
  const binSize = Math.PI / 18; // 10 degrees
  const clusters = new Map<string, { totalArea: number; wx: number; wy: number; wz: number }>();

  for (const { normal, area } of faces) {
    const theta = Math.atan2(normal.y, normal.x);
    const phi = Math.acos(Math.max(-1, Math.min(1, normal.z)));
    const thetaBin = Math.round(theta / binSize);
    const phiBin = Math.round(phi / binSize);
    const key = `${thetaBin},${phiBin}`;

    const existing = clusters.get(key);
    if (existing) {
      existing.totalArea += area;
      existing.wx += normal.x * area;
      existing.wy += normal.y * area;
      existing.wz += normal.z * area;
    } else {
      clusters.set(key, {
        totalArea: area,
        wx: normal.x * area,
        wy: normal.y * area,
        wz: normal.z * area,
      });
    }
  }

  // Find cluster with largest total area
  let bestArea = 0;
  let bestWx = 0, bestWy = 0, bestWz = 0;
  for (const c of clusters.values()) {
    if (c.totalArea > bestArea) {
      bestArea = c.totalArea;
      bestWx = c.wx;
      bestWy = c.wy;
      bestWz = c.wz;
    }
  }
  if (bestArea === 0) return null;

  // Area-weighted average normal of the best cluster
  const avgNormal = vec3Normalize({ x: bestWx, y: bestWy, z: bestWz });

  // Target: rotate this normal to point DOWN (-Z)
  const down: Vec3 = { x: 0, y: 0, z: -1 };
  const dot = vec3Dot(avgNormal, down);

  // Already pointing down (within ~5°)
  if (dot > 0.996) return null;

  // Pointing straight up — rotate 180° around X
  if (dot < -0.996) {
    return { axis: { x: 1, y: 0, z: 0 }, angle: Math.PI };
  }

  // General case: rotation axis = cross(normal, down), angle = acos(dot)
  const axis = vec3Normalize(vec3Cross(avgNormal, down));
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return { axis, angle };
}

/**
 * Extract face normals and areas from a binary STL.
 * Computes normals from vertices (more reliable than stored normals).
 */
export function extractSTLFaces(data: ArrayBuffer): Array<{ normal: Vec3; area: number }> | null {
  if (data.byteLength < 84) return null;
  const view = new DataView(data);
  const triangleCount = view.getUint32(80, true);
  if (data.byteLength < 84 + triangleCount * 50 || triangleCount === 0) return null;

  const faces: Array<{ normal: Vec3; area: number }> = [];
  for (let i = 0; i < triangleCount; i++) {
    const base = 84 + i * 50 + 12; // skip header + count + stored normal
    const v0x = view.getFloat32(base, true);
    const v0y = view.getFloat32(base + 4, true);
    const v0z = view.getFloat32(base + 8, true);
    const v1x = view.getFloat32(base + 12, true);
    const v1y = view.getFloat32(base + 16, true);
    const v1z = view.getFloat32(base + 20, true);
    const v2x = view.getFloat32(base + 24, true);
    const v2y = view.getFloat32(base + 28, true);
    const v2z = view.getFloat32(base + 32, true);

    const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
    const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const crossLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (crossLen < 1e-10) continue;

    faces.push({
      normal: { x: cx / crossLen, y: cy / crossLen, z: cz / crossLen },
      area: crossLen * 0.5,
    });
  }
  return faces.length > 0 ? faces : null;
}

/**
 * Apply a rotation to all vertices and normals in a binary STL.
 * Shifts the result so minimum Z = 0 (on bed).
 * Returns a new ArrayBuffer (does not mutate input).
 */
export function applyRotationToSTL(
  data: ArrayBuffer,
  axis: Vec3,
  angle: number,
): ArrayBuffer {
  const view = new DataView(data);
  const triangleCount = view.getUint32(80, true);

  const result = new ArrayBuffer(data.byteLength);
  new Uint8Array(result).set(new Uint8Array(data));
  const out = new DataView(result);

  let minZ = Infinity;

  for (let i = 0; i < triangleCount; i++) {
    const base = 84 + i * 50;

    // Rotate stored normal
    const nx = view.getFloat32(base, true);
    const ny = view.getFloat32(base + 4, true);
    const nz = view.getFloat32(base + 8, true);
    const rn = rotateVec3({ x: nx, y: ny, z: nz }, axis, angle);
    out.setFloat32(base, rn.x, true);
    out.setFloat32(base + 4, rn.y, true);
    out.setFloat32(base + 8, rn.z, true);

    // Rotate 3 vertices
    for (let v = 0; v < 3; v++) {
      const off = base + 12 + v * 12;
      const vx = view.getFloat32(off, true);
      const vy = view.getFloat32(off + 4, true);
      const vz = view.getFloat32(off + 8, true);
      const rv = rotateVec3({ x: vx, y: vy, z: vz }, axis, angle);
      out.setFloat32(off, rv.x, true);
      out.setFloat32(off + 4, rv.y, true);
      out.setFloat32(off + 8, rv.z, true);
      if (rv.z < minZ) minZ = rv.z;
    }
  }

  // Shift Z so minimum sits on bed (Z=0)
  if (isFinite(minZ) && Math.abs(minZ) > 0.001) {
    for (let i = 0; i < triangleCount; i++) {
      const base = 84 + i * 50;
      for (let v = 0; v < 3; v++) {
        const off = base + 12 + v * 12 + 8;
        out.setFloat32(off, out.getFloat32(off, true) - minZ, true);
      }
    }
  }

  return result;
}

/**
 * Extract face normals and areas from a 3MF file.
 * Parses vertex and triangle data from the 3D model XML.
 */
export function extract3MFFaces(data: ArrayBuffer): Array<{ normal: Vec3; area: number }> | null {
  try {
    const unzipped = unzipSync(new Uint8Array(data));
    let modelXml: string | undefined;
    for (const [path, bytes] of Object.entries(unzipped)) {
      if (path.toLowerCase().endsWith('3dmodel.model')) {
        modelXml = new TextDecoder().decode(bytes);
        break;
      }
    }
    if (!modelXml) return null;

    // Parse vertices
    const vertices: Vec3[] = [];
    const vertexRe = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;
    let vm: RegExpExecArray | null;
    while ((vm = vertexRe.exec(modelXml)) !== null) {
      vertices.push({ x: parseFloat(vm[1]), y: parseFloat(vm[2]), z: parseFloat(vm[3]) });
    }
    if (vertices.length < 3) return null;

    // Parse triangles
    const faces: Array<{ normal: Vec3; area: number }> = [];
    const triRe = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
    let tm: RegExpExecArray | null;
    while ((tm = triRe.exec(modelXml)) !== null) {
      const i0 = parseInt(tm[1], 10);
      const i1 = parseInt(tm[2], 10);
      const i2 = parseInt(tm[3], 10);
      if (i0 >= vertices.length || i1 >= vertices.length || i2 >= vertices.length) continue;

      const v0 = vertices[i0], v1 = vertices[i1], v2 = vertices[i2];
      const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
      const e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;
      const cx = e1y * e2z - e1z * e2y;
      const cy = e1z * e2x - e1x * e2z;
      const cz = e1x * e2y - e1y * e2x;
      const crossLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (crossLen < 1e-10) continue;

      faces.push({
        normal: { x: cx / crossLen, y: cy / crossLen, z: cz / crossLen },
        area: crossLen * 0.5,
      });
    }
    return faces.length > 0 ? faces : null;
  } catch {
    return null;
  }
}

/**
 * Apply a rotation to all vertices in a 3MF file.
 * Parses the model XML, transforms vertex coordinates, re-zips.
 * Shifts result so minimum Z = 0.
 * Returns a new ArrayBuffer, or null if the 3MF can't be processed.
 */
export function applyRotationTo3MF(
  data: ArrayBuffer,
  axis: Vec3,
  angle: number,
): ArrayBuffer | null {
  try {
    const unzipped = unzipSync(new Uint8Array(data));

    let modelPath: string | undefined;
    let modelXml: string | undefined;
    for (const [path, bytes] of Object.entries(unzipped)) {
      if (path.toLowerCase().endsWith('3dmodel.model')) {
        modelPath = path;
        modelXml = new TextDecoder().decode(bytes);
        break;
      }
    }
    if (!modelPath || !modelXml) return null;

    // Rotate all vertex coordinates
    let minZ = Infinity;
    const rotatedXml = modelXml.replace(
      /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g,
      (_match, xs: string, ys: string, zs: string) => {
        const rv = rotateVec3(
          { x: parseFloat(xs), y: parseFloat(ys), z: parseFloat(zs) },
          axis,
          angle,
        );
        if (rv.z < minZ) minZ = rv.z;
        return `<vertex x="${rv.x}" y="${rv.y}" z="${rv.z}"`;
      },
    );

    // Shift Z so minimum sits on bed
    let finalXml = rotatedXml;
    if (isFinite(minZ) && Math.abs(minZ) > 0.001) {
      finalXml = rotatedXml.replace(
        /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g,
        (_match, xs: string, ys: string, zs: string) => {
          const z = parseFloat(zs) - minZ;
          return `<vertex x="${xs}" y="${ys}" z="${z}"`;
        },
      );
    }

    // Re-zip with modified model XML
    const newEntries: Record<string, Uint8Array> = {};
    for (const [path, bytes] of Object.entries(unzipped)) {
      if (path === modelPath) {
        newEntries[path] = new TextEncoder().encode(finalXml);
      } else {
        newEntries[path] = bytes;
      }
    }
    const zipped = zipSync(newEntries);
    return zipped.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

/**
 * "Lay flat" a mesh — find the largest flat face cluster and rotate
 * the mesh so that surface faces down on the bed.
 *
 * Returns new mesh data as ArrayBuffer, or null if already flat
 * or the mesh can't be analyzed.
 */
export function layFlatMesh(
  data: ArrayBuffer,
  format: 'stl' | '3mf',
): ArrayBuffer | null {
  const faces = format === 'stl' ? extractSTLFaces(data) : extract3MFFaces(data);
  if (!faces) return null;

  const rotation = findLayFlatRotation(faces);
  if (!rotation) return null;

  if (format === 'stl') {
    return applyRotationToSTL(data, rotation.axis, rotation.angle);
  } else {
    return applyRotationTo3MF(data, rotation.axis, rotation.angle);
  }
}
