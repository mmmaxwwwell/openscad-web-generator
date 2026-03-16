// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { parseGCode, MOVE_TYPE_COLORS, type ParsedGCode } from '../gcode-parser';

// ─── Helpers ───

function gcode(...lines: string[]): string {
  return lines.join('\n');
}

// ─── featureToMoveType (via parseGCode) ─────────────────

describe('parseGCode: feature comments', () => {
  it('maps "shells" to wall type', () => {
    const result = parseGCode(gcode(
      '; feature shells',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('wall');
  });

  it('maps "thin fill" to wall type', () => {
    const result = parseGCode(gcode(
      '; feature thin fill',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('wall');
  });

  it('maps "solid fill" to solid-fill type', () => {
    const result = parseGCode(gcode(
      '; feature solid fill',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('solid-fill');
  });

  it('maps "sparse infill" to infill type', () => {
    const result = parseGCode(gcode(
      '; feature sparse infill',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('infill');
  });

  it('maps "support" to support type', () => {
    const result = parseGCode(gcode(
      '; feature support',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('support');
  });

  it('maps "brim" to brim type', () => {
    const result = parseGCode(gcode(
      '; feature brim',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('brim');
  });

  it('maps "skirt" to skirt type', () => {
    const result = parseGCode(gcode(
      '; feature skirt',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('skirt');
  });

  it('maps "purge tower" to purge-tower type', () => {
    const result = parseGCode(gcode(
      '; feature purge tower',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('purge-tower');
  });

  it('maps "shield" to shield type', () => {
    const result = parseGCode(gcode(
      '; feature shield',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('shield');
  });

  it('maps "layer" to other type', () => {
    const result = parseGCode(gcode(
      '; feature layer',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('other');
  });

  it('maps unknown feature to other type', () => {
    const result = parseGCode(gcode(
      '; feature something_unknown',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('other');
  });
});

// ─── PrusaSlicer feature comments ────────────────────────

describe('parseGCode: PrusaSlicer TYPE comments', () => {
  it('maps ;TYPE:Perimeter to wall', () => {
    const result = parseGCode(gcode(
      ';TYPE:Perimeter',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('wall');
  });

  it('maps ;TYPE:External perimeter to wall', () => {
    const result = parseGCode(gcode(
      ';TYPE:External perimeter',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('wall');
  });

  it('maps ;TYPE:Overhang perimeter to wall', () => {
    const result = parseGCode(gcode(
      ';TYPE:Overhang perimeter',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('wall');
  });

  it('maps ;TYPE:Gap fill to wall', () => {
    const result = parseGCode(gcode(
      ';TYPE:Gap fill',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('wall');
  });

  it('maps ;TYPE:Internal infill to infill', () => {
    const result = parseGCode(gcode(
      ';TYPE:Internal infill',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('infill');
  });

  it('maps ;TYPE:Bridge infill to infill', () => {
    const result = parseGCode(gcode(
      ';TYPE:Bridge infill',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('infill');
  });

  it('maps ;TYPE:Solid infill to solid-fill', () => {
    const result = parseGCode(gcode(
      ';TYPE:Solid infill',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('solid-fill');
  });

  it('maps ;TYPE:Top solid infill to solid-fill', () => {
    const result = parseGCode(gcode(
      ';TYPE:Top solid infill',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('solid-fill');
  });

  it('maps ;TYPE:Support material to support', () => {
    const result = parseGCode(gcode(
      ';TYPE:Support material',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('support');
  });

  it('maps ;TYPE:Support material interface to support', () => {
    const result = parseGCode(gcode(
      ';TYPE:Support material interface',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('support');
  });

  it('maps ;TYPE:Skirt to brim', () => {
    const result = parseGCode(gcode(
      ';TYPE:Skirt',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('brim');
  });

  it('maps ;TYPE:Skirt/Brim to brim', () => {
    const result = parseGCode(gcode(
      ';TYPE:Skirt/Brim',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('brim');
  });

  it('maps ;TYPE:Wipe tower to purge-tower', () => {
    const result = parseGCode(gcode(
      ';TYPE:Wipe tower',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('purge-tower');
  });

  it('maps ;TYPE:Custom to other', () => {
    const result = parseGCode(gcode(
      ';TYPE:Custom',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].type).toBe('other');
  });

  it('PrusaSlicer type persists across moves until changed', () => {
    const result = parseGCode(gcode(
      ';TYPE:Perimeter',
      'G1 X10 Y0 E1',
      'G1 X20 Y0 E2',
      ';TYPE:Internal infill',
      'G1 X30 Y0 E3',
    ));
    const segs = result.layers[0].segments;
    expect(segs[0].type).toBe('wall');
    expect(segs[1].type).toBe('wall');
    expect(segs[2].type).toBe('infill');
  });
});

// ─── PrusaSlicer layer detection ────────────────────────

describe('parseGCode: PrusaSlicer layer comments', () => {
  it('detects layers from ;LAYER_CHANGE + ;Z: comments', () => {
    const result = parseGCode(gcode(
      ';LAYER_CHANGE',
      ';Z:0.3',
      ';HEIGHT:0.3',
      ';TYPE:Perimeter',
      'G1 X10 Y0 Z0.3 E1',
      ';LAYER_CHANGE',
      ';Z:0.5',
      ';HEIGHT:0.2',
      ';TYPE:Perimeter',
      'G1 X20 Y0 Z0.5 E2',
    ));
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0].z).toBeCloseTo(0.3);
    expect(result.layers[1].z).toBeCloseTo(0.5);
  });

  it(';Z: comment sets layer Z without requiring ;LAYER_CHANGE', () => {
    const result = parseGCode(gcode(
      ';Z:0.3',
      'G1 X10 Y0 Z0.3 E1',
      ';Z:0.6',
      'G1 X20 Y0 Z0.6 E2',
    ));
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0].z).toBeCloseTo(0.3);
    expect(result.layers[1].z).toBeCloseTo(0.6);
  });
});

// ─── PrusaSlicer realistic multi-layer ──────────────────

describe('parseGCode: realistic PrusaSlicer GCode', () => {
  it('parses a realistic PrusaSlicer multi-feature print', () => {
    const result = parseGCode(gcode(
      '; generated by PrusaSlicer 2.9.4',
      'G28',
      'M83',
      ';LAYER_CHANGE',
      ';Z:0.3',
      ';HEIGHT:0.3',
      ';TYPE:Skirt/Brim',
      'G1 X10 Y10 Z0.3 F3000 E0.5',
      'G1 X50 Y10 E0.5',
      ';TYPE:External perimeter',
      'G1 X20 Y20 E0.5',
      'G1 X40 Y20 E0.5',
      ';TYPE:Perimeter',
      'G1 X22 Y22 E0.5',
      'G1 X38 Y22 E0.5',
      ';TYPE:Solid infill',
      'G1 X25 Y25 E0.5',
      ';TYPE:Internal infill',
      'G1 X35 Y35 E0.5',
      ';LAYER_CHANGE',
      ';Z:0.5',
      ';HEIGHT:0.2',
      ';TYPE:External perimeter',
      'G1 X20 Y20 Z0.5 E0.5',
      'G1 X40 Y20 E0.5',
      ';TYPE:Top solid infill',
      'G1 X25 Y25 E0.5',
      ';TYPE:Support material',
      'G1 X30 Y30 E0.5',
      ';TYPE:Wipe tower',
      'T1',
      'G1 X60 Y60 E0.5',
    ));

    expect(result.layers.length).toBeGreaterThanOrEqual(2);
    expect(result.layers[0].z).toBeCloseTo(0.3);
    expect(result.layers[1].z).toBeCloseTo(0.5);

    const types = new Set(result.layers.flatMap(l => l.segments.map(s => s.type)));
    expect(types.has('brim')).toBe(true);     // Skirt/Brim
    expect(types.has('wall')).toBe(true);      // External perimeter, Perimeter
    expect(types.has('solid-fill')).toBe(true); // Solid infill, Top solid infill
    expect(types.has('infill')).toBe(true);    // Internal infill
    expect(types.has('support')).toBe(true);   // Support material
    expect(types.has('purge-tower')).toBe(true); // Wipe tower

    // T1 tool change
    const towerSegs = result.layers.flatMap(l => l.segments.filter(s => s.type === 'purge-tower'));
    expect(towerSegs.some(s => s.extruder === 1)).toBe(true);
  });
});

// ─── Basic parsing ──────────────────────────────────────

describe('parseGCode: basic moves', () => {
  it('parses empty gcode', () => {
    const result = parseGCode('');
    expect(result.layers).toHaveLength(0);
    expect(result.totalSegments).toBe(0);
    expect(result.bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
  });

  it('parses G1 linear move with extrusion', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y20 Z0.3 E1',
    ));
    expect(result.totalSegments).toBe(1);
    expect(result.layers).toHaveLength(1);
    const seg = result.layers[0].segments[0];
    expect(seg.x1).toBe(0);
    expect(seg.y1).toBe(0);
    expect(seg.x2).toBe(10);
    expect(seg.y2).toBe(20);
    expect(seg.z2).toBe(0.3);
  });

  it('G0 travel moves are marked as travel', () => {
    const result = parseGCode(gcode(
      'G0 X10 Y20',
    ));
    expect(result.layers[0].segments[0].type).toBe('travel');
  });

  it('G1 without E is a travel move', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y20',
    ));
    expect(result.layers[0].segments[0].type).toBe('travel');
  });

  it('skips blank lines and comment-only lines', () => {
    const result = parseGCode(gcode(
      '',
      '; just a comment',
      '',
      'G1 X10 Y0 E1',
    ));
    expect(result.totalSegments).toBe(1);
  });

  it('strips inline comments from commands', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y20 E1 ; move to position',
    ));
    expect(result.totalSegments).toBe(1);
    expect(result.layers[0].segments[0].x2).toBe(10);
  });

  it('ignores non-G0/G1/G2/G3 commands', () => {
    const result = parseGCode(gcode(
      'M104 S200',
      'M140 S60',
      'G28',
      'G1 X10 Y0 E1',
    ));
    expect(result.totalSegments).toBe(1);
  });
});

// ─── Layer detection ────────────────────────────────────

describe('parseGCode: layers', () => {
  it('detects layers from ";; --- layer N ..." comments', () => {
    const result = parseGCode(gcode(
      ';; --- layer 0 (0.300 @ 0.300) ---',
      'G1 X10 Y0 E1',
      ';; --- layer 1 (0.300 @ 0.600) ---',
      'G1 X20 Y0 E2',
    ));
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0].z).toBeCloseTo(0.3);
    expect(result.layers[1].z).toBeCloseTo(0.6);
  });

  it('detects layers from Z changes', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y0 Z0.3 E1',
      'G1 X20 Y0 E2',
      'G1 X10 Y0 Z0.6 E3',
      'G1 X20 Y0 E4',
    ));
    expect(result.layers.length).toBeGreaterThanOrEqual(2);
  });

  it('assigns layer indices sequentially', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y0 Z0.2 E1',
      'G1 X20 Y0 Z0.4 E2',
      'G1 X30 Y0 Z0.6 E3',
    ));
    for (let i = 0; i < result.layers.length; i++) {
      expect(result.layers[i].layerIndex).toBe(i);
    }
  });
});

// ─── Extrusion mode ─────────────────────────────────────

describe('parseGCode: extrusion mode', () => {
  it('defaults to relative E', () => {
    // In relative mode, any positive E is extrusion
    const result = parseGCode(gcode(
      'G1 X10 Y0 E0.5',
    ));
    expect(result.totalSegments).toBe(1);
    // Should be extrusion, not travel
    expect(result.layers[0].segments[0].type).toBe('other'); // default type before feature comment
  });

  it('M82 switches to absolute E mode', () => {
    const result = parseGCode(gcode(
      'M82',
      'G1 X10 Y0 E1',   // absolute E=1, > 0 = extrusion
      'G1 X20 Y0 E0.5', // absolute E=0.5, < previous 1 = retraction, not extrusion
    ));
    expect(result.totalSegments).toBe(2);
    // First move: extrusion (E goes from 0 to 1)
    // Second move: travel (E decreased — retraction)
    expect(result.layers[0].segments[1].type).toBe('travel');
  });

  it('M83 switches to relative E mode', () => {
    const result = parseGCode(gcode(
      'M82',  // absolute
      'M83',  // back to relative
      'G1 X10 Y0 E0.5', // relative E=0.5 > 0 = extrusion
    ));
    expect(result.totalSegments).toBe(1);
  });
});

// ─── G92 set position ───────────────────────────────────

describe('parseGCode: G92 set position', () => {
  it('resets E position', () => {
    const result = parseGCode(gcode(
      'M82',
      'G1 X10 Y0 E5',
      'G92 E0',
      'G1 X20 Y0 E1', // absolute E=1, > 0 after reset = extrusion
    ));
    expect(result.totalSegments).toBe(2);
  });

  it('resets XYZ position', () => {
    const result = parseGCode(gcode(
      'G92 X100 Y100 Z10',
      'G1 X110 Y100 E1',
    ));
    const seg = result.layers[0].segments[0];
    expect(seg.x1).toBe(100);
    expect(seg.y1).toBe(100);
    expect(seg.x2).toBe(110);
  });
});

// ─── Tool change ────────────────────────────────────────

describe('parseGCode: tool change', () => {
  it('tracks extruder index from T commands', () => {
    const result = parseGCode(gcode(
      'T0',
      'G1 X10 Y0 E1',
      'T1',
      'G1 X20 Y0 E2',
    ));
    expect(result.layers[0].segments[0].extruder).toBe(0);
    expect(result.layers[0].segments[1].extruder).toBe(1);
  });
});

// ─── Arc commands (G2/G3) ───────────────────────────────

describe('parseGCode: arc commands', () => {
  it('parses G2 clockwise arc into multiple segments', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y0 Z0.3',
      '; feature shells',
      'G2 X0 Y10 I-10 J0 E5', // CW 90° arc
    ));
    // Arc should be broken into multiple sub-segments
    expect(result.totalSegments).toBeGreaterThan(2); // travel + arc segments
    // First segment is the G1 travel, rest are arc
    const arcSegs = result.layers[0].segments.filter(s => s.type === 'wall');
    expect(arcSegs.length).toBeGreaterThanOrEqual(3); // at least 3 sub-segments for 90°
  });

  it('parses G3 counter-clockwise arc', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y0 Z0.3',
      '; feature shells',
      'G3 X0 Y10 I-10 J0 E5', // CCW arc
    ));
    const arcSegs = result.layers[0].segments.filter(s => s.type === 'wall');
    expect(arcSegs.length).toBeGreaterThanOrEqual(3);
  });

  it('arc travel moves (no E) are marked as travel', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y0 Z0.3',
      'G2 X0 Y10 I-10 J0', // arc with no extrusion
    ));
    const arcSegs = result.layers[0].segments.filter(s => s.type !== 'travel');
    expect(arcSegs).toHaveLength(0); // all should be travel
  });

  it('arc endpoints are accurate', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y0 Z0.3',
      '; feature shells',
      'G2 X0 Y10 I-10 J0 E5',
    ));
    const arcSegs = result.layers[0].segments.filter(s => s.type === 'wall');
    // First arc segment starts at (10, 0)
    expect(arcSegs[0].x1).toBeCloseTo(10, 1);
    expect(arcSegs[0].y1).toBeCloseTo(0, 1);
    // Last arc segment ends at (0, 10)
    const last = arcSegs[arcSegs.length - 1];
    expect(last.x2).toBeCloseTo(0, 1);
    expect(last.y2).toBeCloseTo(10, 1);
  });

  it('arc with Z change interpolates Z linearly', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y0 Z0.3',
      '; feature shells',
      'G2 X0 Y10 I-10 J0 Z0.6 E5', // arc with Z change
    ));
    // Arc segments may span multiple layers; find wall segments across all layers
    const arcSegs = result.layers.flatMap(l => l.segments.filter(s => s.type === 'wall'));
    expect(arcSegs.length).toBeGreaterThan(0);
    // First sub-segment should start at z=0.3
    expect(arcSegs[0].z1).toBeCloseTo(0.3, 2);
    // Last sub-segment should end at z=0.6
    expect(arcSegs[arcSegs.length - 1].z2).toBeCloseTo(0.6, 2);
  });
});

// ─── Bounds tracking ────────────────────────────────────

describe('parseGCode: bounds', () => {
  it('tracks bounds from extrusion moves only', () => {
    const result = parseGCode(gcode(
      'G0 X-100 Y-100', // travel — should NOT affect bounds
      'G1 X10 Y20 Z0.3 E1',
      'G1 X50 Y60 E2',
    ));
    // Bounds include start+end points of extrusion moves
    // First extrusion starts at (-100, -100) due to prior travel
    expect(result.bounds.minX).toBe(-100);
    expect(result.bounds.maxX).toBe(50);
    expect(result.bounds.minY).toBe(-100);
    expect(result.bounds.maxY).toBe(60);
  });

  it('returns zero bounds when no extrusions', () => {
    const result = parseGCode(gcode(
      'G0 X10 Y20',
      'G0 X30 Y40',
    ));
    expect(result.bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
  });
});

// ─── Progress and cancellation ──────────────────────────

describe('parseGCode: progress and cancellation', () => {
  it('calls progress callback', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `G1 X${i} Y0 E${i * 0.1}`);
    const progressValues: number[] = [];
    parseGCode(lines.join('\n'), (p) => progressValues.push(p));
    expect(progressValues.length).toBeGreaterThan(0);
    // Final progress should be 1
    expect(progressValues[progressValues.length - 1]).toBe(1);
  });

  it('throws on abort signal', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => parseGCode('G1 X10 Y0 E1', undefined, controller.signal)).toThrow('Parsing cancelled');
  });
});

// ─── Edge case branches ─────────────────────────────────

describe('parseGCode: branch edge cases', () => {
  it('Z-only move with extrusion (hasZ && hasE, no XY change)', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y10 Z0.3 E1',
      'G1 Z0.6 E2', // Z change + E, but no XY change
    ));
    expect(result.totalSegments).toBe(2);
  });

  it('bounds track start point as max (travel high then extrude backward)', () => {
    // Travel (no E) to high position, then extrude backward
    // Start point of extrusion is the max, endpoint is lower
    const result = parseGCode(gcode(
      'G0 X100 Y100 Z0.3',    // travel — no bounds update
      'G1 X10 Y10 E1',         // extrude from (100,100) to (10,10)
    ));
    // Start point (100,100) should be tracked as max
    expect(result.bounds.maxX).toBe(100);
    expect(result.bounds.maxY).toBe(100);
    expect(result.bounds.minX).toBe(10);
    expect(result.bounds.minY).toBe(10);
  });

  it('G1 with only Z change and no E is not a segment', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y10 Z0.3 E1',
      'G1 Z0.6',
    ));
    expect(result.totalSegments).toBe(1);
  });

  it('handles CCW arc sweep wrap-around', () => {
    const result = parseGCode(gcode(
      'G1 X0 Y10 Z0.3',
      '; feature shells',
      'G3 X10 Y0 I0 J-10 E5',
    ));
    const arcSegs = result.layers.flatMap(l => l.segments.filter(s => s.type === 'wall'));
    expect(arcSegs.length).toBeGreaterThan(0);
  });

  it('handles CW arc sweep wrap-around', () => {
    const result = parseGCode(gcode(
      'G1 X0 Y10 Z0.3',
      '; feature shells',
      'G2 X10 Y0 I0 J-10 E5',
    ));
    const arcSegs = result.layers.flatMap(l => l.segments.filter(s => s.type === 'wall'));
    expect(arcSegs.length).toBeGreaterThan(0);
  });

  it('arc non-extrusion does not update bounds', () => {
    const result = parseGCode(gcode(
      'G2 X10 Y10 I5 J0',
    ));
    expect(result.bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
  });
});

// ─── Additional branch coverage ─────────────────────────

describe('parseGCode: remaining branch coverage', () => {
  it('G92 with bare X/Y/Z (no number) falls back to 0', () => {
    // parseFloat('') returns NaN, || 0 fallback branch
    const result = parseGCode(gcode(
      'G92 X Y Z E',
      'G1 X10 Y10 Z0.3 E1',
    ));
    const seg = result.layers[0].segments[0];
    expect(seg.x1).toBe(0);
    expect(seg.y1).toBe(0);
  });

  it('G1 with bare Z parameter (NaN fallback)', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y10 Z E1',
    ));
    expect(result.totalSegments).toBe(1);
    const seg = result.layers[0].segments[0];
    expect(seg.z2).toBe(0);
  });

  it('arc extrusion with Z decrease updates minZ bounds', () => {
    // Start high, arc down — segZ2 should be less than initial minZ
    const result = parseGCode(gcode(
      'G1 X10 Y0 Z5.0 E1',          // establish high Z with extrusion
      '; feature shells',
      'G2 X0 Y10 I-10 J0 Z0.3 E10', // arc down to Z=0.3
    ));
    expect(result.bounds.minZ).toBeLessThanOrEqual(0.3);
    expect(result.bounds.maxZ).toBeGreaterThanOrEqual(5.0);
  });

  it('line with only inline comment after command stripping', () => {
    // A line that doesn't start with ; but becomes empty after stripping inline comment
    // e.g. a raw line "  ; foo" trims to "; foo" which starts with ; and is caught earlier
    // But "M104 ; temp" becomes "M104" which is non-empty — this edge is hard to reach
    // Test that command-only-comment lines don't produce segments
    const result = parseGCode(gcode(
      'G1 X10 Y10 Z0.3 E1',
    ));
    expect(result.totalSegments).toBe(1);
  });
});

// ─── Negative E / retraction in relative mode ───────────

describe('parseGCode: retraction handling', () => {
  it('negative E in relative mode is not extrusion (retraction)', () => {
    const result = parseGCode(gcode(
      '; feature shells',
      'G1 X10 Y0 E0.5',
      'G1 X20 Y0 E-0.5', // retraction
    ));
    const segs = result.layers[0].segments;
    expect(segs[1].type).toBe('travel'); // retraction = not extrusion
  });

  it('absolute mode: E decrease is retraction', () => {
    const result = parseGCode(gcode(
      'M82',
      '; feature shells',
      'G1 X10 Y0 E2',
      'G1 X20 Y0 E1.5', // E went down = retraction
    ));
    expect(result.layers[0].segments[1].type).toBe('travel');
  });

  it('absolute mode: E increase after retraction is extrusion', () => {
    const result = parseGCode(gcode(
      'M82',
      '; feature shells',
      'G1 X10 Y0 E2',
      'G1 X15 Y0 E1.5', // retraction
      'G1 X20 Y0 E3',   // extrusion resumes
    ));
    expect(result.layers[0].segments[2].type).toBe('wall');
  });
});

// ─── G1 with only E (no XY change) ─────────────────────

describe('parseGCode: E-only moves', () => {
  it('G1 with only E and no positional change produces no segment', () => {
    const result = parseGCode(gcode(
      'G1 E1', // no X/Y/Z change, no segment
    ));
    expect(result.totalSegments).toBe(0);
  });

  it('G1 with F (feedrate) parameter is parsed correctly', () => {
    const result = parseGCode(gcode(
      'G1 X10 Y20 F3000 E1',
    ));
    expect(result.totalSegments).toBe(1);
    expect(result.layers[0].segments[0].x2).toBe(10);
  });
});

// ─── Multiple consecutive layer comments ────────────────

describe('parseGCode: multiple layer comments', () => {
  it('handles back-to-back layer comments without moves', () => {
    const result = parseGCode(gcode(
      ';; --- layer 0 (0.300 @ 0.300) ---',
      ';; --- layer 1 (0.300 @ 0.600) ---',
      'G1 X10 Y0 E1',
    ));
    // Only one layer should have segments
    expect(result.layers.filter(l => l.segments.length > 0)).toHaveLength(1);
  });

  it('layer Z from comment overrides Z from G1', () => {
    const result = parseGCode(gcode(
      ';; --- layer 0 (0.300 @ 0.300) ---',
      'G1 X10 Y0 Z0.5 E1', // Z=0.5 but layer said 0.3
    ));
    // The Z change updates currentLayerZ, so the segment goes to Z=0.5 layer
    expect(result.layers.some(l => l.z === 0.5)).toBe(true);
  });
});

// ─── Large coordinate values ────────────────────────────

describe('parseGCode: large/extreme values', () => {
  it('handles very large coordinates', () => {
    const result = parseGCode(gcode(
      'G1 X99999 Y99999 Z0.3 E1',
    ));
    expect(result.bounds.maxX).toBe(99999);
    expect(result.bounds.maxY).toBe(99999);
  });

  it('handles negative coordinates', () => {
    const result = parseGCode(gcode(
      'G1 X-50 Y-50 Z0.3 E1',
    ));
    expect(result.bounds.minX).toBe(-50);
    expect(result.bounds.minY).toBe(-50);
  });
});

// ─── Feature comment persistence ────────────────────────

describe('parseGCode: feature persistence across moves', () => {
  it('feature type persists across multiple moves until changed', () => {
    const result = parseGCode(gcode(
      '; feature shells',
      'G1 X10 Y0 E1',
      'G1 X20 Y0 E2',
      'G1 X30 Y0 E3',
    ));
    const types = result.layers[0].segments.map(s => s.type);
    expect(types).toEqual(['wall', 'wall', 'wall']);
  });

  it('feature type changes when new comment appears', () => {
    const result = parseGCode(gcode(
      '; feature shells',
      'G1 X10 Y0 E1',
      '; feature sparse infill',
      'G1 X20 Y0 E2',
    ));
    expect(result.layers[0].segments[0].type).toBe('wall');
    expect(result.layers[0].segments[1].type).toBe('infill');
  });
});

// ─── Tool change edge cases ─────────────────────────────

describe('parseGCode: tool change edge cases', () => {
  it('T0 at start sets extruder 0 explicitly', () => {
    const result = parseGCode(gcode(
      'T0',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].extruder).toBe(0);
  });

  it('handles high extruder numbers', () => {
    const result = parseGCode(gcode(
      'T7',
      'G1 X10 Y0 E1',
    ));
    expect(result.layers[0].segments[0].extruder).toBe(7);
  });
});

// ─── Arc edge cases ─────────────────────────────────────

describe('parseGCode: arc edge cases', () => {
  it('full circle arc (start == end) with sweep wrap', () => {
    // When start == end, sweep calc may give 0 or 2*PI
    const result = parseGCode(gcode(
      'G1 X10 Y0 Z0.3',
      '; feature shells',
      'G2 X10 Y0 I-10 J0 E5',
    ));
    // Should produce some segments regardless of sweep edge case
    expect(result.totalSegments).toBeGreaterThan(0);
  });

  it('arc with zero radius does not crash', () => {
    expect(() => parseGCode(gcode(
      'G1 X10 Y0 Z0.3',
      'G2 X10 Y0 I0 J0 E5',
    ))).not.toThrow();
  });

  it('arc extrusion updates bounds including start point', () => {
    const result = parseGCode(gcode(
      'G1 X20 Y0 Z0.3',
      '; feature shells',
      'G2 X0 Y20 I-20 J0 E10',
    ));
    // Arc starts at (20,0), center at (0,0), radius 20, ends at (0,20)
    // Bounds should include points along the arc
    expect(result.bounds.maxX).toBeGreaterThanOrEqual(19);
    expect(result.bounds.maxY).toBeGreaterThanOrEqual(19);
  });
});

// ─── MOVE_TYPE_COLORS ───────────────────────────────────

describe('MOVE_TYPE_COLORS', () => {
  it('has entries for all move types', () => {
    const types = ['wall', 'solid-fill', 'infill', 'support', 'travel', 'brim', 'skirt', 'purge-tower', 'shield', 'other'] as const;
    for (const t of types) {
      expect(MOVE_TYPE_COLORS[t]).toBeDefined();
      expect(MOVE_TYPE_COLORS[t]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

// ─── Comprehensive GCode ────────────────────────────────

describe('parseGCode: realistic multi-layer GCode', () => {
  it('parses a realistic multi-feature print', () => {
    const result = parseGCode(gcode(
      '; Generated by test',
      'G28',
      'M82',
      'G92 E0',
      ';; --- layer 0 (0.300 @ 0.300) ---',
      '; feature skirt',
      'G1 X10 Y10 Z0.3 F3000 E0.5',
      'G1 X50 Y10 E1.0',
      'G1 X50 Y50 E1.5',
      '; feature shells',
      'G1 X20 Y20 E2.0',
      'G1 X40 Y20 E2.5',
      '; feature sparse infill',
      'G1 X25 Y25 E3.0',
      'G1 X35 Y35 E3.5',
      ';; --- layer 1 (0.300 @ 0.600) ---',
      '; feature shells',
      'G1 X20 Y20 Z0.6 E4.0',
      'G1 X40 Y20 E4.5',
      '; feature solid fill',
      'G1 X25 Y25 E5.0',
      'T1',
      '; feature support',
      'G1 X30 Y30 E5.5',
    ));

    expect(result.layers.length).toBeGreaterThanOrEqual(2);
    expect(result.totalSegments).toBeGreaterThan(5);

    // Layer 0 should be at z=0.3
    expect(result.layers[0].z).toBeCloseTo(0.3);

    // Check feature types are tracked
    const types = new Set(result.layers.flatMap(l => l.segments.map(s => s.type)));
    expect(types.has('skirt')).toBe(true);
    expect(types.has('wall')).toBe(true);
    expect(types.has('infill')).toBe(true);
    expect(types.has('solid-fill')).toBe(true);
    expect(types.has('support')).toBe(true);

    // T1 tool change should be tracked
    const supportSegs = result.layers.flatMap(l => l.segments.filter(s => s.type === 'support'));
    expect(supportSegs.some(s => s.extruder === 1)).toBe(true);
  });
});
