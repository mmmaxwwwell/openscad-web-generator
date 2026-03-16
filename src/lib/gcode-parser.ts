// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * GCode parser for 3D print preview visualization.
 *
 * Parses GCode text into structured layer data suitable for Three.js rendering.
 * Supports Kiri:Moto (; feature <type>) and PrusaSlicer (;TYPE:<type>, ;LAYER_CHANGE, ;Z:) comment formats.
 * Designed to support multi-extruder in the future via extruder field on each segment.
 */

/** Types of moves in the GCode */
export type MoveType =
  | 'wall'         // shells / perimeters
  | 'solid-fill'   // solid infill / top/bottom
  | 'infill'       // sparse infill
  | 'support'      // support structures
  | 'travel'       // non-extruding travel move
  | 'brim'         // brim adhesion
  | 'skirt'        // skirt
  | 'purge-tower'  // purge/wipe tower
  | 'shield'       // draft shield
  | 'other';       // unknown extrusion

/** A single line segment in the GCode */
export interface GCodeSegment {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  type: MoveType;
  extruder: number;   // 0-based tool index (for future multi-color)
}

/** A single layer of GCode segments */
export interface GCodeLayer {
  z: number;          // layer Z height in mm
  layerIndex: number; // 0-based layer index
  segments: GCodeSegment[];
}

/** Result of parsing GCode */
export interface ParsedGCode {
  layers: GCodeLayer[];
  bounds: {
    minX: number; maxX: number;
    minY: number; maxY: number;
    minZ: number; maxZ: number;
  };
  totalSegments: number;
}

/** Progress callback: 0..1 */
export type ProgressCallback = (progress: number) => void;

/** Map Kiri:Moto-style feature names to our MoveType */
function featureToMoveType(feature: string): MoveType {
  switch (feature) {
    case 'shells':
    case 'thin fill':
      return 'wall';
    case 'solid fill':
      return 'solid-fill';
    case 'sparse infill':
      return 'infill';
    case 'support':
      return 'support';
    case 'brim':
      return 'brim';
    case 'skirt':
      return 'skirt';
    case 'purge tower':
      return 'purge-tower';
    case 'shield':
      return 'shield';
    case 'layer':
      return 'other';  // layer-level marker, not a real feature
    default:
      return 'other';
  }
}

/** Map PrusaSlicer ;TYPE:<type> comments to our MoveType */
function prusaTypeToMoveType(type: string): MoveType {
  switch (type) {
    case 'Perimeter':
    case 'External perimeter':
    case 'Overhang perimeter':
    case 'Gap fill':
      return 'wall';
    case 'Internal infill':
    case 'Bridge infill':
      return 'infill';
    case 'Solid infill':
    case 'Top solid infill':
      return 'solid-fill';
    case 'Support material':
    case 'Support material interface':
      return 'support';
    case 'Skirt':
    case 'Skirt/Brim':
      return 'brim';
    case 'Wipe tower':
      return 'purge-tower';
    default:
      return 'other';
  }
}

/**
 * Convert a G2/G3 arc to a series of line segments.
 * I/J are offsets from the start point to the arc center.
 * Returns array of [x1, y1, x2, y2] segments.
 */
function arcToSegments(
  x1: number, y1: number,
  x2: number, y2: number,
  i: number, j: number,
  clockwise: boolean,
): [number, number, number, number][] {
  const cx = x1 + i;
  const cy = y1 + j;
  const r = Math.sqrt(i * i + j * j);

  let startAngle = Math.atan2(y1 - cy, x1 - cx);
  let endAngle = Math.atan2(y2 - cy, x2 - cx);

  // Calculate sweep angle
  let sweep: number;
  if (clockwise) {
    sweep = startAngle - endAngle;
    if (sweep <= 0) sweep += 2 * Math.PI;
  } else {
    sweep = endAngle - startAngle;
    if (sweep <= 0) sweep += 2 * Math.PI;
  }

  // Number of segments: ~1 per 5 degrees, minimum 3
  const numSegs = Math.max(3, Math.ceil(sweep / (5 * Math.PI / 180)));
  const segments: [number, number, number, number][] = [];

  let prevX = x1;
  let prevY = y1;

  for (let s = 1; s <= numSegs; s++) {
    const t = s / numSegs;
    const angle = clockwise
      ? startAngle - sweep * t
      : startAngle + sweep * t;
    const px = s === numSegs ? x2 : cx + r * Math.cos(angle);
    const py = s === numSegs ? y2 : cy + r * Math.sin(angle);
    segments.push([prevX, prevY, px, py]);
    prevX = px;
    prevY = py;
  }

  return segments;
}

/**
 * Parse a GCode string into structured layer data.
 *
 * @param gcode - Raw GCode text
 * @param onProgress - Optional callback reporting parse progress (0..1)
 * @param signal - Optional AbortSignal for cancellation
 * @returns Parsed GCode with layers, bounds, and segment count
 */
export function parseGCode(
  gcode: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): ParsedGCode {
  const lines = gcode.split('\n');
  const totalLines = lines.length;

  // Tracking state
  let x = 0, y = 0, z = 0;
  let eAbsolute = 0;         // absolute E position
  let eRelative = true;      // default to relative E (most slicers emit M83)
  let currentType: MoveType = 'other';
  let currentExtruder = 0;

  // Layer accumulation
  const layerMap = new Map<number, GCodeSegment[]>();
  let currentLayerZ = 0;

  // Bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  let totalSegments = 0;
  let lastProgressReport = 0;

  for (let i = 0; i < totalLines; i++) {
    // Cancellation check
    if (signal?.aborted) {
      throw new DOMException('Parsing cancelled', 'AbortError');
    }

    // Progress reporting (every ~2%)
    if (onProgress && i - lastProgressReport > totalLines * 0.02) {
      onProgress(i / totalLines);
      lastProgressReport = i;
    }

    const line = lines[i].trim();
    if (line.length === 0) continue;

    // Parse comments for feature type and layer markers
    if (line.startsWith(';')) {
      // Kiri:Moto feature comments: "; feature shells"
      const featureMatch = line.match(/^; feature (.+)$/);
      if (featureMatch) {
        currentType = featureToMoveType(featureMatch[1]);
        continue;
      }

      // Kiri:Moto layer comments: ";; --- layer 0 (0.300 @ 0.300) ---"
      const layerMatch = line.match(/^;; --- layer (\d+) \([\d.]+ @ ([\d.]+)\) ---$/);
      if (layerMatch) {
        currentLayerZ = parseFloat(layerMatch[2]);
        continue;
      }

      // PrusaSlicer feature type comments: ";TYPE:Perimeter"
      const prusaTypeMatch = line.match(/^;TYPE:(.+)$/);
      if (prusaTypeMatch) {
        currentType = prusaTypeToMoveType(prusaTypeMatch[1]);
        continue;
      }

      // PrusaSlicer layer change: ";LAYER_CHANGE" followed by ";Z:X.X"
      if (line === ';LAYER_CHANGE') {
        continue;
      }

      // PrusaSlicer Z marker: ";Z:0.300"
      const prusaZMatch = line.match(/^;Z:([\d.]+)$/);
      if (prusaZMatch) {
        currentLayerZ = parseFloat(prusaZMatch[1]);
        continue;
      }

      // PrusaSlicer height marker: ";HEIGHT:0.300" (informational, no action needed)

      continue;
    }

    // Parse GCode commands — strip inline comments
    const cmd = line.split(';')[0].trim();

    const parts = cmd.split(/\s+/);
    const code = parts[0].toUpperCase();

    // Tool change
    if (code.startsWith('T') && /^T\d+$/.test(code)) {
      currentExtruder = parseInt(code.substring(1), 10);
      continue;
    }

    // Relative/absolute extrusion — explicit M82/M83 override the default
    if (code === 'M82') { eRelative = false; continue; }
    if (code === 'M83') { eRelative = true; continue; }

    // G92 — set position
    if (code === 'G92') {
      for (let j = 1; j < parts.length; j++) {
        const p = parts[j].toUpperCase();
        if (p.startsWith('E')) eAbsolute = parseFloat(p.substring(1)) || 0;
        if (p.startsWith('X')) x = parseFloat(p.substring(1)) || 0;
        if (p.startsWith('Y')) y = parseFloat(p.substring(1)) || 0;
        if (p.startsWith('Z')) z = parseFloat(p.substring(1)) || 0;
      }
      continue;
    }

    // G0 (travel) / G1 (linear move) / G2 (CW arc) / G3 (CCW arc)
    const isArc = code === 'G2' || code === 'G3';
    if (code !== 'G0' && code !== 'G1' && !isArc) continue;

    let newX = x, newY = y, newZ = z;
    let hasE = false;
    let eVal = 0;
    let iOffset = 0, jOffset = 0;

    for (let j = 1; j < parts.length; j++) {
      const p = parts[j].toUpperCase();
      if (p.startsWith('X')) newX = parseFloat(p.substring(1)) || 0;
      else if (p.startsWith('Y')) newY = parseFloat(p.substring(1)) || 0;
      else if (p.startsWith('Z')) newZ = parseFloat(p.substring(1)) || 0;
      else if (p.startsWith('E')) {
        eVal = parseFloat(p.substring(1)) || 0;
        hasE = true;
      }
      else if (p.startsWith('I')) iOffset = parseFloat(p.substring(1)) || 0;
      else if (p.startsWith('J')) jOffset = parseFloat(p.substring(1)) || 0;
    }

    // Determine if this is an extrusion or travel
    const isExtrusion = hasE && (eRelative ? eVal > 0 : eVal > eAbsolute);
    if (hasE) {
      eAbsolute = eRelative ? eAbsolute + eVal : eVal;
    }

    // Update Z tracking
    const hasZ = newZ !== z;
    if (hasZ) {
      currentLayerZ = newZ;
    }

    // For arcs, convert to line segments
    if (isArc) {
      const clockwise = code === 'G2';
      const arcSegments = arcToSegments(x, y, newX, newY, iOffset, jOffset, clockwise);
      const segType: MoveType = isExtrusion ? currentType : 'travel';
      const layerKey = Math.round(currentLayerZ * 1000);
      let layerSegments = layerMap.get(layerKey);
      if (!layerSegments) {
        layerSegments = [];
        layerMap.set(layerKey, layerSegments);
      }

      // Interpolate Z linearly across arc sub-segments
      const arcZ1 = z, arcZ2 = newZ;
      const numArcSegs = arcSegments.length;
      for (let a = 0; a < numArcSegs; a++) {
        const [ax1, ay1, ax2, ay2] = arcSegments[a];
        const segZ1 = arcZ1 + (arcZ2 - arcZ1) * (a / numArcSegs);
        const segZ2 = arcZ1 + (arcZ2 - arcZ1) * ((a + 1) / numArcSegs);

        const seg: GCodeSegment = {
          x1: ax1, y1: ay1, z1: segZ1,
          x2: ax2, y2: ay2, z2: segZ2,
          type: segType,
          extruder: currentExtruder,
        };
        layerSegments.push(seg);
        totalSegments++;

        if (isExtrusion) {
          if (ax1 < minX) minX = ax1; if (ax1 > maxX) maxX = ax1;
          if (ax2 < minX) minX = ax2; if (ax2 > maxX) maxX = ax2;
          if (ay1 < minY) minY = ay1; if (ay1 > maxY) maxY = ay1;
          if (ay2 < minY) minY = ay2; if (ay2 > maxY) maxY = ay2;
          if (segZ1 < minZ) minZ = segZ1; if (segZ1 > maxZ) maxZ = segZ1;
          if (segZ2 < minZ) minZ = segZ2; if (segZ2 > maxZ) maxZ = segZ2;
        }
      }
    } else {
      // Linear move (G0/G1)
      const hasXY = newX !== x || newY !== y;

      if (hasXY || (hasZ && hasE)) {
        const segType: MoveType = isExtrusion ? currentType : 'travel';

        const seg: GCodeSegment = {
          x1: x, y1: y, z1: z,
          x2: newX, y2: newY, z2: newZ,
          type: segType,
          extruder: currentExtruder,
        };

        // Use rounded Z as layer key (avoid floating point issues)
        const layerKey = Math.round(currentLayerZ * 1000);
        let layerSegments = layerMap.get(layerKey);
        if (!layerSegments) {
          layerSegments = [];
          layerMap.set(layerKey, layerSegments);
        }
        layerSegments.push(seg);
        totalSegments++;

        // Update bounds (skip travel moves for bounds)
        if (isExtrusion) {
          if (newX < minX) minX = newX;
          if (newX > maxX) maxX = newX;
          if (newY < minY) minY = newY;
          if (newY > maxY) maxY = newY;
          if (newZ < minZ) minZ = newZ;
          if (newZ > maxZ) maxZ = newZ;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    x = newX;
    y = newY;
    z = newZ;
  }

  // Convert layer map to sorted array
  const sortedKeys = Array.from(layerMap.keys()).sort((a, b) => a - b);
  const layers: GCodeLayer[] = sortedKeys.map((key, index) => ({
    z: key / 1000,
    layerIndex: index,
    segments: layerMap.get(key)!,
  }));

  // Handle edge case: no extrusion segments found
  if (minX === Infinity) {
    minX = maxX = minY = maxY = minZ = maxZ = 0;
  }

  onProgress?.(1);

  return {
    layers,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    totalSegments,
  };
}

/** Color mapping for move types */
export const MOVE_TYPE_COLORS: Record<MoveType, string> = {
  'wall':        '#4a90d9',  // blue
  'solid-fill':  '#3dab5a',  // darker green
  'infill':      '#50c878',  // emerald green
  'support':     '#f5a623',  // amber
  'travel':      '#888888',  // gray
  'brim':        '#9b59b6',  // purple
  'skirt':       '#9b59b6',  // purple
  'purge-tower': '#e74c3c',  // red
  'shield':      '#95a5a6',  // silver
  'other':       '#cccccc',  // light gray
};
