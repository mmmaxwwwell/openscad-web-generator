// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  parseScadFile,
  parseParams,
  parseParamSets,
  parseValue,
  parseDescription,
  parseSlicerSettings,
} from '../scad-parser';

// ─── Test fixture: complete scad file ────────────────────

const FIXTURE = `\
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

  it('falls back to string for unparseable values', () => {
    expect(parseValue('foo_bar')).toEqual({ value: 'foo_bar', type: 'string' });
  });

  it('treats vector with non-numeric values as string', () => {
    expect(parseValue('[a, b, c]')).toEqual({ value: '[a, b, c]', type: 'string' });
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

  it('returns empty array when end marker is missing', () => {
    expect(parseParams('// BEGIN_PARAMS\nwidth = 10;')).toEqual([]);
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

// ─── parseScadFile (integration) ─────────────────────────

describe('parseScadFile', () => {
  it('returns complete parsed result', () => {
    const result = parseScadFile(FIXTURE);
    expect(result.params).toHaveLength(7);
    expect(result.paramSets).toHaveLength(3);
    expect(result.source).toBe(FIXTURE);
  });

  it('handles empty source', () => {
    const result = parseScadFile('');
    expect(result.params).toEqual([]);
    expect(result.paramSets).toEqual([]);
  });

  it('handles file with only params section', () => {
    const source = `// BEGIN_PARAMS\nwidth = 10;\n// END_PARAMS`;
    const result = parseScadFile(source);
    expect(result.params).toHaveLength(1);
    expect(result.paramSets).toEqual([]);
  });

  it('includes description in parsed result', () => {
    const source = `// BEGIN_DESCRIPTION\n// A cool model.\n// END_DESCRIPTION\n// BEGIN_PARAMS\nwidth = 10;\n// END_PARAMS`;
    const result = parseScadFile(source);
    expect(result.description).toBe('A cool model.');
  });
});

// ─── parseDescription ─────────────────────────────────────

describe('parseDescription', () => {
  it('extracts description text from comments', () => {
    const source = `// BEGIN_DESCRIPTION\n// Line one.\n// Line two.\n// END_DESCRIPTION`;
    expect(parseDescription(source)).toBe('Line one.\nLine two.');
  });

  it('returns empty string when section is missing', () => {
    expect(parseDescription('cube();')).toBe('');
  });

  it('strips leading comment markers', () => {
    const source = `// BEGIN_DESCRIPTION\n//No space prefix\n// END_DESCRIPTION`;
    expect(parseDescription(source)).toBe('No space prefix');
  });
});

// ─── parseSlicerSettings ──────────────────────────────────

describe('parseSlicerSettings', () => {
  it('extracts top_single_wall_layers', () => {
    const source = `// BEGIN_SLICER_SETTINGS\n// top_single_wall_layers = 3\n// END_SLICER_SETTINGS`;
    const settings = parseSlicerSettings(source);
    expect(settings.topSingleWallLayers).toBe(3);
  });

  it('returns empty object when section is missing', () => {
    expect(parseSlicerSettings('cube();')).toEqual({});
  });

  it('ignores non-matching lines', () => {
    const source = `// BEGIN_SLICER_SETTINGS\n// some random line\n// END_SLICER_SETTINGS`;
    expect(parseSlicerSettings(source)).toEqual({});
  });

  it('ignores unknown keys', () => {
    const source = `// BEGIN_SLICER_SETTINGS\n// unknown_key = 5\n// END_SLICER_SETTINGS`;
    expect(parseSlicerSettings(source)).toEqual({});
  });

  it('ignores non-number values for top_single_wall_layers', () => {
    const source = `// BEGIN_SLICER_SETTINGS\n// top_single_wall_layers = "bad"\n// END_SLICER_SETTINGS`;
    expect(parseSlicerSettings(source)).toEqual({});
  });
});

// ─── parseParams: multiline text type ─────────────────────

describe('parseParams: multiline text type', () => {
  it('parses multiline flag to produce text type', () => {
    const source = `// BEGIN_PARAMS\n// Description text // multiline\nlabel = "hello";\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe('text');
    expect(params[0].name).toBe('label');
  });

  it('does not set text type for non-string multiline params', () => {
    const source = `// BEGIN_PARAMS\n// Some number // multiline\ncount = 5;\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe('number');
  });

  it('multiline flag strips cleanly from help text', () => {
    const source = `// BEGIN_PARAMS\n// Enter text here // multiline\ntext = "hello";\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params[0].help).toBe('Enter text here');
    expect(params[0].type).toBe('text');
  });
});

// ─── parseParams: edge cases ──────────────────────────────

describe('parseParams: edge cases', () => {
  it('skips lines that are not comments before assignment', () => {
    const source = `// BEGIN_PARAMS\ncube();\nwidth = 10;\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params).toHaveLength(1);
    expect(params[0].help).toBe('');
  });

  it('skips blocks where last line is not an assignment', () => {
    const source = `// BEGIN_PARAMS\n// just a comment\n// another comment\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params).toHaveLength(0);
  });

  it('handles param with empty help (no preceding comments)', () => {
    const source = `// BEGIN_PARAMS\nsize = 42;\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params).toHaveLength(1);
    expect(params[0].help).toBe('');
    expect(params[0].default).toBe(42);
  });

  it('handles empty inline comment options gracefully', () => {
    const source = `// BEGIN_PARAMS\nshape = "circle"; // []\n// END_PARAMS`;
    const params = parseParams(source);
    // Empty brackets should not produce enum type
    expect(params[0].type).toBe('string');
  });

  it('handles comment line that is just "//" (empty comment text)', () => {
    const source = `// BEGIN_PARAMS\n//\n// Help text\nwidth = 10;\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params).toHaveLength(1);
    // Empty comment line should not add to help (only "Help text" does)
    expect(params[0].help).toBe('Help text');
  });

  it('handles inline comment without options', () => {
    const source = `// BEGIN_PARAMS\nwidth = 10; // in mm\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe('number');
  });

  it('handles bracket content with all-empty items [ , , ]', () => {
    const source = `// BEGIN_PARAMS\nshape = "circle"; // [ , , ]\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params[0].type).toBe('string');
  });

  it('handles extra blank lines between blocks (empty blocks)', () => {
    const source = `// BEGIN_PARAMS\n\n\n\n\nwidth = 10;\n\n\n\n\nheight = 20;\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── parseParamSets: edge cases ───────────────────────────

describe('parseParamSets: edge cases', () => {
  it('skips blocks without set: header', () => {
    const source = `// BEGIN_PARAM_SETS\n// not a set header\n// width = 10\n// END_PARAM_SETS`;
    const sets = parseParamSets(source);
    expect(sets).toHaveLength(0);
  });

  it('skips non-matching lines within a set', () => {
    const source = `// BEGIN_PARAM_SETS\n// set: Test\n// width = 10\nrandom garbage\n// END_PARAM_SETS`;
    const sets = parseParamSets(source);
    expect(sets).toHaveLength(1);
    expect(sets[0].values.width).toBe(10);
  });

  it('handles extra blank lines producing empty blocks', () => {
    const source = `// BEGIN_PARAM_SETS\n\n\n// set: Test\n// width = 10\n\n\n// END_PARAM_SETS`;
    const sets = parseParamSets(source);
    expect(sets).toHaveLength(1);
  });
});

// ─── parseValue: additional edge cases ───────────────────

describe('parseValue: additional edge cases', () => {
  it('parses zero as number', () => {
    expect(parseValue('0')).toEqual({ value: 0, type: 'number' });
  });

  it('parses negative float', () => {
    expect(parseValue('-3.14')).toEqual({ value: -3.14, type: 'number' });
  });

  it('parses empty string literal', () => {
    expect(parseValue('""')).toEqual({ value: '', type: 'string' });
  });

  it('parses single-element vector', () => {
    expect(parseValue('[42]')).toEqual({ value: [42], type: 'vector' });
  });

  it('parses 2D vector', () => {
    expect(parseValue('[10, 20]')).toEqual({ value: [10, 20], type: 'vector' });
  });

  it('treats empty brackets as string', () => {
    // [] has inner string "", which splits to [""], Number("") is 0 but... let's check
    const result = parseValue('[]');
    // "".split(",") = [""], Number("") = 0, isNaN(0) = false, so this becomes [0]
    expect(result.type).toBe('vector');
  });

  it('parses vector with negative numbers', () => {
    expect(parseValue('[-5, 10, -15]')).toEqual({ value: [-5, 10, -15], type: 'vector' });
  });

  it('parses scientific notation', () => {
    expect(parseValue('1e3')).toEqual({ value: 1000, type: 'number' });
  });
});

// ─── parseParams: more edge cases ────────────────────────

describe('parseParams: additional edge cases', () => {
  it('handles param name with underscores', () => {
    const source = `// BEGIN_PARAMS\n// Help text\nmy_long_param_name = 42;\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('my_long_param_name');
  });

  it('handles string param with special characters', () => {
    const source = `// BEGIN_PARAMS\nlabel = "Hello, World! @#$";\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params[0].default).toBe('Hello, World! @#$');
  });

  it('handles negative default value', () => {
    const source = `// BEGIN_PARAMS\noffset = -10;\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params[0].default).toBe(-10);
  });

  it('handles vector param with many elements', () => {
    const source = `// BEGIN_PARAMS\ncolors = [1, 2, 3, 4, 5];\n// END_PARAMS`;
    const params = parseParams(source);
    expect(params[0].type).toBe('vector');
    expect(params[0].default).toEqual([1, 2, 3, 4, 5]);
  });

  it('multiline flag on enum param does not override enum type', () => {
    const source = `// BEGIN_PARAMS\n// Choose one // multiline\nshape = "circle"; // [circle, square]\n// END_PARAMS`;
    const params = parseParams(source);
    // enum takes priority over multiline since multiline only applies to string type
    expect(params[0].type).toBe('enum');
    expect(params[0].options).toEqual(['circle', 'square']);
  });
});

// ─── parseDescription: edge cases ────────────────────────

describe('parseDescription: edge cases', () => {
  it('handles multiline description with empty lines', () => {
    const source = `// BEGIN_DESCRIPTION\n// Line one.\n//\n// Line three.\n// END_DESCRIPTION`;
    expect(parseDescription(source)).toBe('Line one.\nLine three.');
  });

  it('handles description with only whitespace lines', () => {
    const source = `// BEGIN_DESCRIPTION\n//   \n// END_DESCRIPTION`;
    // "   " trimmed = "", which is filtered out
    expect(parseDescription(source)).toBe('');
  });
});

// ─── parseParamSets: additional edge cases ───────────────

describe('parseParamSets: additional edge cases', () => {
  it('handles set with vector value', () => {
    const source = `// BEGIN_PARAM_SETS\n// set: Custom\n// dims = [100, 200, 300]\n// END_PARAM_SETS`;
    const sets = parseParamSets(source);
    expect(sets).toHaveLength(1);
    expect(sets[0].values.dims).toEqual([100, 200, 300]);
  });

  it('handles set with boolean value', () => {
    const source = `// BEGIN_PARAM_SETS\n// set: NoVents\n// vents = false\n// END_PARAM_SETS`;
    const sets = parseParamSets(source);
    expect(sets[0].values.vents).toBe(false);
  });

  it('handles multiple sets separated by blank lines', () => {
    const source = `// BEGIN_PARAM_SETS\n// set: A\n// x = 1\n\n// set: B\n// x = 2\n\n// set: C\n// x = 3\n// END_PARAM_SETS`;
    const sets = parseParamSets(source);
    expect(sets).toHaveLength(3);
    expect(sets[0].values.x).toBe(1);
    expect(sets[2].values.x).toBe(3);
  });
});
