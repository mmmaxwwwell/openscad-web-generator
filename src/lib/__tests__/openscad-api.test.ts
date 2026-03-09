import { describe, it, expect } from 'vitest';
import { injectParameters, viewpointToCameraArg } from '../openscad-api';
import type { ScadViewpoint } from '../../types';

describe('injectParameters', () => {
  it('returns source unchanged when no params', () => {
    const source = 'cube([10,10,10]);';
    expect(injectParameters(source, {})).toBe(source);
  });

  it('prepends number parameter', () => {
    const result = injectParameters('cube();', { width: 20 });
    expect(result).toBe('width = 20;\n\ncube();');
  });

  it('prepends string parameter with proper escaping', () => {
    const result = injectParameters('cube();', { label: 'say "hi"' });
    expect(result).toBe('label = "say \\"hi\\"";\n\ncube();');
  });

  it('prepends boolean parameter', () => {
    const result = injectParameters('cube();', { center: true });
    expect(result).toBe('center = true;\n\ncube();');
  });

  it('prepends vector parameter', () => {
    const result = injectParameters('cube();', { dims: [10, 20, 30] });
    expect(result).toBe('dims = [10, 20, 30];\n\ncube();');
  });

  it('prepends multiple parameters', () => {
    const result = injectParameters('cube();', { width: 10, height: 20 });
    expect(result).toContain('width = 10;');
    expect(result).toContain('height = 20;');
    expect(result).toContain('\n\ncube();');
  });

  it('escapes backslashes in strings', () => {
    const result = injectParameters('cube();', { path: 'C:\\Users' });
    expect(result).toBe('path = "C:\\\\Users";\n\ncube();');
  });
});

describe('viewpointToCameraArg', () => {
  it('reorders from file format (rot first) to CLI format (trans first)', () => {
    const vp: ScadViewpoint = {
      rotX: 25, rotY: 35, rotZ: 0,
      transX: 10, transY: 20, transZ: 30,
      distance: 200,
      label: 'Test',
    };
    // CLI expects: transX,transY,transZ,rotX,rotY,rotZ,distance
    expect(viewpointToCameraArg(vp)).toBe('10,20,30,25,35,0,200');
  });

  it('handles all zeros', () => {
    const vp: ScadViewpoint = {
      rotX: 0, rotY: 0, rotZ: 0,
      transX: 0, transY: 0, transZ: 0,
      distance: 0,
      label: '',
    };
    expect(viewpointToCameraArg(vp)).toBe('0,0,0,0,0,0,0');
  });
});
