import { describe, it, expect } from 'vitest';
import { injectParameters } from '../openscad-api';

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
