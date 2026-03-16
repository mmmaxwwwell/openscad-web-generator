// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { parseGcodeStats } from '../../hooks/useSlicer';

describe('parseGcodeStats', () => {
  it('extracts print time from PrusaSlicer comment', () => {
    const gcode = `
G28
G1 X0 Y0
; estimated printing time (normal mode) = 1h 0m 0s
; filament used [mm] = 1234.5
M84
`;
    const stats = parseGcodeStats(gcode);
    expect(stats.printTime).toBe(3600);
  });

  it('extracts filament used from PrusaSlicer comment', () => {
    const gcode = `
G28
; estimated printing time (normal mode) = 0h 2m 0s
; filament used [mm] = 567.89
`;
    const stats = parseGcodeStats(gcode);
    expect(stats.filamentUsed).toBeCloseTo(567.89);
  });

  it('returns both values when present', () => {
    const gcode = '; estimated printing time (normal mode) = 0h 0m 42s\n; filament used [mm] = 100.0';
    const stats = parseGcodeStats(gcode);
    expect(stats).toEqual({ printTime: 42, filamentUsed: 100.0 });
  });

  it('returns undefined for printTime if not present', () => {
    const gcode = 'G28\nG1 X10 Y10\n; filament used [mm] = 50.0';
    expect(parseGcodeStats(gcode).printTime).toBeUndefined();
  });

  it('returns undefined for filamentUsed if not present', () => {
    const gcode = 'G28\n; estimated printing time (normal mode) = 0h 1m 40s\nG1 X10';
    expect(parseGcodeStats(gcode).filamentUsed).toBeUndefined();
  });

  it('returns both undefined for gcode with no stats comments', () => {
    const gcode = 'G28\nG1 X10 Y10 F3000\nM84';
    expect(parseGcodeStats(gcode)).toEqual({
      printTime: undefined,
      filamentUsed: undefined,
    });
  });

  it('returns both undefined for empty string', () => {
    expect(parseGcodeStats('')).toEqual({
      printTime: undefined,
      filamentUsed: undefined,
    });
  });

  it('handles hours-only time', () => {
    const gcode = '; estimated printing time (normal mode) = 24h 0m 0s\n; filament used [mm] = 99999.99';
    expect(parseGcodeStats(gcode)).toEqual({ printTime: 86400, filamentUsed: 99999.99 });
  });

  it('handles minutes and seconds only', () => {
    const gcode = '; estimated printing time (normal mode) = 5m 30s';
    expect(parseGcodeStats(gcode).printTime).toBe(330);
  });
});
