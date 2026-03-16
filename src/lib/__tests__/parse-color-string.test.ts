// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { parseColorString, NAMED_COLORS } from '../color-utils';

describe('parseColorString', () => {
  // ─── Named colors ──────────────────────────────────────────────────────

  it('parses "red" as named color with alpha=1', () => {
    expect(parseColorString('red')).toEqual([1, 0, 0, 1]);
  });

  it('parses "black" as named color', () => {
    expect(parseColorString('black')).toEqual([0, 0, 0, 1]);
  });

  it('parses "white" as named color', () => {
    expect(parseColorString('white')).toEqual([1, 1, 1, 1]);
  });

  it('is case-insensitive for named colors', () => {
    expect(parseColorString('RED')).toEqual([1, 0, 0, 1]);
    expect(parseColorString('Blue')).toEqual([0, 0, 1, 1]);
  });

  it('handles leading/trailing whitespace', () => {
    expect(parseColorString('  green  ')).toEqual([0, 0.502, 0, 1]);
  });

  it('strips surrounding quotes', () => {
    expect(parseColorString('"orange"')).toEqual([1, 0.647, 0, 1]);
  });

  it('parses all named colors without error', () => {
    for (const [name, [r, g, b]] of Object.entries(NAMED_COLORS)) {
      const result = parseColorString(name);
      expect(result).toEqual([r, g, b, 1]);
    }
  });

  // ─── Array format ─────────────────────────────────────────────────────

  it('parses "[r, g, b, a]" array format', () => {
    expect(parseColorString('[0.5, 0.3, 0.1, 0.8]')).toEqual([0.5, 0.3, 0.1, 0.8]);
  });

  it('parses "[r, g, b]" with default alpha=1', () => {
    expect(parseColorString('[0.5, 0.3, 0.1]')).toEqual([0.5, 0.3, 0.1, 1]);
  });

  it('parses array without spaces', () => {
    expect(parseColorString('[1,0,0,1]')).toEqual([1, 0, 0, 1]);
  });

  it('parses array with extra whitespace', () => {
    expect(parseColorString('[ 0.2 , 0.4 , 0.6 ]')).toEqual([0.2, 0.4, 0.6, 1]);
  });

  // ─── Hex colors ───────────────────────────────────────────────────────

  it('parses "#rrggbb" hex format', () => {
    expect(parseColorString('#ff0000')).toEqual([1, 0, 0, 1]);
  });

  it('parses "#000000" as black', () => {
    expect(parseColorString('#000000')).toEqual([0, 0, 0, 1]);
  });

  it('parses mixed-case hex', () => {
    expect(parseColorString('#FF8800')).toEqual([1, 136 / 255, 0, 1]);
  });

  it('parses "#4a90d9" correctly', () => {
    const result = parseColorString('#4a90d9');
    expect(result![0]).toBeCloseTo(0x4a / 255, 3);
    expect(result![1]).toBeCloseTo(0x90 / 255, 3);
    expect(result![2]).toBeCloseTo(0xd9 / 255, 3);
    expect(result![3]).toBe(1);
  });

  // ─── Invalid inputs ───────────────────────────────────────────────────

  it('returns null for empty string', () => {
    expect(parseColorString('')).toBeNull();
  });

  it('returns null for unknown color name', () => {
    expect(parseColorString('notacolor')).toBeNull();
  });

  it('returns null for partial hex', () => {
    expect(parseColorString('#fff')).toBeNull();
  });

  it('returns null for invalid array', () => {
    expect(parseColorString('[a, b, c]')).toBeNull();
  });

  it('returns null for single number', () => {
    expect(parseColorString('42')).toBeNull();
  });

  it('returns null for two-element array', () => {
    expect(parseColorString('[0.5, 0.3]')).toBeNull();
  });

  it('returns null for hex with wrong length', () => {
    expect(parseColorString('#12345')).toBeNull();
    expect(parseColorString('#1234567')).toBeNull();
  });

  it('returns null for hex with invalid chars', () => {
    expect(parseColorString('#gggggg')).toBeNull();
  });

  // ─── Additional color formats ─────────────────────────────

  it('parses array with 5+ values (uses first 4)', () => {
    const result = parseColorString('[0.1, 0.2, 0.3, 0.4, 0.5]');
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('handles quoted array format from OpenSCAD echo', () => {
    expect(parseColorString('"[0.5, 0.3, 0.1, 0.8]"')).toEqual([0.5, 0.3, 0.1, 0.8]);
  });

  it('handles quoted named color', () => {
    expect(parseColorString('"blue"')).toEqual([0, 0, 1, 1]);
  });

  it('handles quoted hex color', () => {
    expect(parseColorString('"#ff0000"')).toEqual([1, 0, 0, 1]);
  });

  it('parses grey alias same as gray', () => {
    expect(parseColorString('grey')).toEqual(parseColorString('gray'));
  });

  it('parses darkgrey alias same as darkgray', () => {
    expect(parseColorString('darkgrey')).toEqual(parseColorString('darkgray'));
  });
});
