import { describe, it, expect } from 'vitest';
import {
  parseScadFile,
  parseParams,
  parseParamSets,
  parseViewpoints,
  parseValue,
} from '../scad-parser';

// ─── Test fixture: complete scad file ────────────────────

const FIXTURE = `\
// BEGIN_VIEWPOINTS
// 25,35,0,0,0,0,200       // Front perspective
// 0,0,0,0,0,0,300         // Top down
// 90,0,45,0,0,0,180       // Angled side
// END_VIEWPOINTS

// BEGIN_PARAMS
// The overall width of the box in mm.
// Must be at least 10mm for structural integrity.
width = 50;


// The overall height of the box in mm.
height = 30;


// Wall thickness in mm.
// Minimum recommended: 1.2mm for FDM printing.
wall = 2;


// Text to emboss on the lid.
label = "My Box";


// Whether to add ventilation holes.
vents = true;


// Shape of ventilation holes.
// Affects airflow characteristics.
vent_shape = "circle"; // [circle, square, hexagon]


// Dimensions as [width, depth, height].
dimensions = [100, 60, 40];
// END_PARAMS

// BEGIN_PARAM_SETS
// set: Thin Walls
// wall = 1.2
// label = "Thin"

// set: Thick & Solid
// wall = 4
// vents = false
// label = "Solid"

// set: Large Hex Vents
// width = 100
// height = 60
// vent_shape = "hexagon"
// END_PARAM_SETS

difference() {
    cube([width, width, height]);
}
`;

// ─── parseValue ──────────────────────────────────────────

describe('parseValue', () => {
  it('parses integers', () => {
    expect(parseValue('50')).toEqual({ value: 50, type: 'number' });
  });

  it('parses floats', () => {
    expect(parseValue('1.2')).toEqual({ value: 1.2, type: 'number' });
  });

  it('parses booleans', () => {
    expect(parseValue('true')).toEqual({ value: true, type: 'boolean' });
    expect(parseValue('false')).toEqual({ value: false, type: 'boolean' });
  });

  it('parses strings', () => {
    expect(parseValue('"hello"')).toEqual({ value: 'hello', type: 'string' });
  });

  it('parses vectors', () => {
    expect(parseValue('[10, 20, 30]')).toEqual({ value: [10, 20, 30], type: 'vector' });
  });

  it('parses negative numbers', () => {
    expect(parseValue('-5')).toEqual({ value: -5, type: 'number' });
  });
});

// ─── parseParams ─────────────────────────────────────────

describe('parseParams', () => {
  const params = parseParams(FIXTURE);

  it('extracts all parameters', () => {
    expect(params).toHaveLength(7);
  });

  it('parses number param with multi-line help', () => {
    const width = params.find((p) => p.name === 'width');
    expect(width).toBeDefined();
    expect(width!.type).toBe('number');
    expect(width!.default).toBe(50);
    expect(width!.help).toContain('overall width');
    expect(width!.help).toContain('at least 10mm');
  });

  it('parses number param with single-line help', () => {
    const height = params.find((p) => p.name === 'height');
    expect(height).toBeDefined();
    expect(height!.type).toBe('number');
    expect(height!.default).toBe(30);
    expect(height!.help).toBe('The overall height of the box in mm.');
  });

  it('parses string param', () => {
    const label = params.find((p) => p.name === 'label');
    expect(label).toBeDefined();
    expect(label!.type).toBe('string');
    expect(label!.default).toBe('My Box');
  });

  it('parses boolean param', () => {
    const vents = params.find((p) => p.name === 'vents');
    expect(vents).toBeDefined();
    expect(vents!.type).toBe('boolean');
    expect(vents!.default).toBe(true);
  });

  it('parses enum param with options', () => {
    const ventShape = params.find((p) => p.name === 'vent_shape');
    expect(ventShape).toBeDefined();
    expect(ventShape!.type).toBe('enum');
    expect(ventShape!.default).toBe('circle');
    expect(ventShape!.options).toEqual(['circle', 'square', 'hexagon']);
    expect(ventShape!.help).toContain('Affects airflow');
  });

  it('parses vector param', () => {
    const dims = params.find((p) => p.name === 'dimensions');
    expect(dims).toBeDefined();
    expect(dims!.type).toBe('vector');
    expect(dims!.default).toEqual([100, 60, 40]);
  });

  it('returns empty array when section is missing', () => {
    expect(parseParams('// no params section here')).toEqual([]);
  });
});

// ─── parseParamSets ──────────────────────────────────────

describe('parseParamSets', () => {
  const sets = parseParamSets(FIXTURE);

  it('extracts all parameter sets', () => {
    expect(sets).toHaveLength(3);
  });

  it('parses set names', () => {
    expect(sets.map((s) => s.name)).toEqual(['Thin Walls', 'Thick & Solid', 'Large Hex Vents']);
  });

  it('parses set values correctly', () => {
    const thin = sets.find((s) => s.name === 'Thin Walls')!;
    expect(thin.values.wall).toBe(1.2);
    expect(thin.values.label).toBe('Thin');
  });

  it('parses boolean overrides in sets', () => {
    const thick = sets.find((s) => s.name === 'Thick & Solid')!;
    expect(thick.values.vents).toBe(false);
    expect(thick.values.wall).toBe(4);
  });

  it('parses string overrides in sets', () => {
    const large = sets.find((s) => s.name === 'Large Hex Vents')!;
    expect(large.values.vent_shape).toBe('hexagon');
  });

  it('returns empty array when section is missing', () => {
    expect(parseParamSets('// nothing here')).toEqual([]);
  });
});

// ─── parseViewpoints ─────────────────────────────────────

describe('parseViewpoints', () => {
  const vps = parseViewpoints(FIXTURE);

  it('extracts all viewpoints', () => {
    expect(vps).toHaveLength(3);
  });

  it('parses viewpoint values', () => {
    expect(vps[0]).toEqual({
      rotX: 25,
      rotY: 35,
      rotZ: 0,
      transX: 0,
      transY: 0,
      transZ: 0,
      distance: 200,
      label: 'Front perspective',
    });
  });

  it('parses viewpoint labels', () => {
    expect(vps[1].label).toBe('Top down');
    expect(vps[2].label).toBe('Angled side');
  });

  it('returns empty array when section is missing', () => {
    expect(parseViewpoints('// no viewpoints')).toEqual([]);
  });
});

// ─── parseScadFile (integration) ─────────────────────────

describe('parseScadFile', () => {
  it('returns complete parsed result', () => {
    const result = parseScadFile(FIXTURE);
    expect(result.params).toHaveLength(7);
    expect(result.paramSets).toHaveLength(3);
    expect(result.viewpoints).toHaveLength(3);
    expect(result.source).toBe(FIXTURE);
  });

  it('handles empty source', () => {
    const result = parseScadFile('');
    expect(result.params).toEqual([]);
    expect(result.paramSets).toEqual([]);
    expect(result.viewpoints).toEqual([]);
  });

  it('handles file with only params section', () => {
    const source = `// BEGIN_PARAMS\nwidth = 10;\n// END_PARAMS`;
    const result = parseScadFile(source);
    expect(result.params).toHaveLength(1);
    expect(result.paramSets).toEqual([]);
    expect(result.viewpoints).toEqual([]);
  });
});
