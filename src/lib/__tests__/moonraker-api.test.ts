// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildMoonrakerUrl, extractGcodeBlock, extractGcodeSection, parsePrinterConfig, fetchConfigfile, fetchToolhead, fetchRawPrinterCfg, startPrint, fetchPrinterConfig } from '../moonraker-api';

// ─── Shared fetch mock helpers ───────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetch(response: { ok?: boolean; status?: number; json?: unknown; text?: string }) {
  return vi.fn(() => Promise.resolve({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: 'OK',
    json: () => Promise.resolve(response.json),
    text: () => Promise.resolve(response.text ?? ''),
  }));
}

/** Set up HTTP window.location and auto-restore fetch after each test. */
function useMockFetch() {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'http:' } },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
}

// ─── buildMoonrakerUrl ──────────────────────────────────────────────────────

describe('buildMoonrakerUrl', () => {
  it('prepends http:// when no protocol given', () => {
    expect(buildMoonrakerUrl('192.168.1.50', '/api/version')).toBe('http://192.168.1.50/api/version');
  });

  it('keeps http:// when already present', () => {
    expect(buildMoonrakerUrl('http://192.168.1.50', '/api/version')).toBe('http://192.168.1.50/api/version');
  });

  it('keeps https:// when already present', () => {
    expect(buildMoonrakerUrl('https://printer.local', '/api/version')).toBe('https://printer.local/api/version');
  });

  it('strips trailing slashes from address', () => {
    expect(buildMoonrakerUrl('http://printer.local///', '/api/version')).toBe('http://printer.local/api/version');
  });

  it('handles hostname with port', () => {
    expect(buildMoonrakerUrl('printer.local:7125', '/server/info')).toBe('http://printer.local:7125/server/info');
  });

  it('handles address with protocol and port', () => {
    expect(buildMoonrakerUrl('http://printer.local:7125/', '/server/info')).toBe('http://printer.local:7125/server/info');
  });
});

// ─── extractGcodeBlock ──────────────────────────────────────────────────────

describe('extractGcodeBlock', () => {
  it('extracts a simple START_PRINT macro', () => {
    const cfg = `
[gcode_macro START_PRINT]
gcode:
  G28
  G1 Z5 F3000
  M104 S{params.EXTRUDER_TEMP}

[gcode_macro END_PRINT]
gcode:
  M104 S0
`;
    expect(extractGcodeBlock(cfg, 'START_PRINT')).toBe(
      'G28\nG1 Z5 F3000\nM104 S{params.EXTRUDER_TEMP}',
    );
  });

  it('extracts END_PRINT macro', () => {
    const cfg = `
[gcode_macro START_PRINT]
gcode:
  G28

[gcode_macro END_PRINT]
gcode:
  M104 S0
  M140 S0
  G28 X Y
`;
    expect(extractGcodeBlock(cfg, 'END_PRINT')).toBe(
      'M104 S0\nM140 S0\nG28 X Y',
    );
  });

  it('returns empty string if macro not found', () => {
    expect(extractGcodeBlock('[printer]\nkinematics: cartesian', 'START_PRINT')).toBe('');
  });

  it('returns empty string if gcode: line is missing in macro', () => {
    const cfg = `
[gcode_macro START_PRINT]
description: Start print routine
variable_some_var: 0
`;
    expect(extractGcodeBlock(cfg, 'START_PRINT')).toBe('');
  });

  it('is case-insensitive for section header', () => {
    const cfg = `
[GCODE_MACRO start_print]
gcode:
  G28
`;
    expect(extractGcodeBlock(cfg, 'start_print')).toBe('G28');
  });

  it('handles macro at end of file without trailing newline', () => {
    const cfg = `[gcode_macro END_PRINT]
gcode:
  M84`;
    expect(extractGcodeBlock(cfg, 'END_PRINT')).toBe('M84');
  });

  it('skips non-gcode keys in macro block', () => {
    const cfg = `
[gcode_macro START_PRINT]
description: Start print
variable_temp: 200
gcode:
  G28
  G1 Z5
`;
    expect(extractGcodeBlock(cfg, 'START_PRINT')).toBe('G28\nG1 Z5');
  });

  it('extracts macro with blank line stopping continuation', () => {
    const cfg = `
[gcode_macro START_PRINT]
gcode:
  G28
  G29

  M104 S200
`;
    const result = extractGcodeBlock(cfg, 'START_PRINT');
    expect(result).toBe('G28\nG29');
  });

  it('handles macro with tabs instead of spaces for indentation', () => {
    const cfg = `[gcode_macro START_PRINT]
gcode:
\tG28
\tG1 Z5
`;
    expect(extractGcodeBlock(cfg, 'START_PRINT')).toBe('G28\nG1 Z5');
  });
});

// ─── extractGcodeSection ────────────────────────────────────────────────────

describe('extractGcodeSection', () => {
  it('extracts inline start_gcode with continuation lines', () => {
    const cfg = `
[extruder]
nozzle_diameter: 0.4
start_gcode:
  G28
  G1 Z5 F3000
  M104 S200
filament_diameter: 1.75
`;
    expect(extractGcodeSection(cfg, 'start_gcode')).toBe(
      'G28\nG1 Z5 F3000\nM104 S200',
    );
  });

  it('extracts value on same line as key', () => {
    const cfg = `
end_gcode: M84
other_key: value
`;
    expect(extractGcodeSection(cfg, 'end_gcode')).toBe('M84');
  });

  it('extracts value on same line plus continuations', () => {
    const cfg = `
start_gcode: G28
  G1 Z5
  M104 S200
filament_diameter: 1.75
`;
    expect(extractGcodeSection(cfg, 'start_gcode')).toBe(
      'G28\nG1 Z5\nM104 S200',
    );
  });

  it('returns empty string if section not found', () => {
    expect(extractGcodeSection('nozzle_diameter: 0.4', 'start_gcode')).toBe('');
  });

  it('skips blank lines within indented block', () => {
    const cfg = `
start_gcode:
  G28

  G1 Z5
other: value
`;
    expect(extractGcodeSection(cfg, 'start_gcode')).toBe('G28\nG1 Z5');
  });

  it('stops at non-indented line', () => {
    const cfg = `
start_gcode:
  G28
  G1 Z5
end_gcode:
  M84
`;
    expect(extractGcodeSection(cfg, 'start_gcode')).toBe('G28\nG1 Z5');
  });

  it('handles empty value with only continuation lines', () => {
    const cfg = `
start_gcode:
  G28
  G1 Z5
`;
    expect(extractGcodeSection(cfg, 'start_gcode')).toBe('G28\nG1 Z5');
  });

  it('handles value at end of file with no trailing newline', () => {
    const cfg = 'end_gcode: M84';
    expect(extractGcodeSection(cfg, 'end_gcode')).toBe('M84');
  });

  it('handles multiple colons in value', () => {
    const cfg = 'start_gcode: M104 S{first_layer_temperature[0]}';
    expect(extractGcodeSection(cfg, 'start_gcode')).toBe('M104 S{first_layer_temperature[0]}');
  });

  it('handles empty firstLine when key is at end of string', () => {
    const cfg = 'start_gcode:';
    expect(extractGcodeSection(cfg, 'start_gcode')).toBe('');
  });
});

// ─── parsePrinterConfig ─────────────────────────────────────────────────────

const DEFAULT_TOOLHEAD = { max_velocity: 300, max_accel: 3000, square_corner_velocity: 5 };

describe('parsePrinterConfig', () => {
  it('parses bed dimensions from stepper config', () => {
    const config = {
      stepper_x: { position_min: '0', position_max: '220' },
      stepper_y: { position_min: '0', position_max: '220' },
      stepper_z: { position_max: '250' },
      extruder: {},
    };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.bedWidth).toBe(220);
    expect(result.bedDepth).toBe(220);
    expect(result.maxHeight).toBe(250);
  });

  it('uses defaults when stepper config is missing', () => {
    const result = parsePrinterConfig({}, DEFAULT_TOOLHEAD, '');
    expect(result.bedWidth).toBe(235);
    expect(result.bedDepth).toBe(235);
    expect(result.maxHeight).toBe(300);
  });

  it('computes bed size as max - min', () => {
    const config = {
      stepper_x: { position_min: '-10', position_max: '210' },
      stepper_y: { position_min: '-5', position_max: '215' },
      stepper_z: { position_max: '300' },
      extruder: {},
    };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.bedWidth).toBe(220);
    expect(result.bedDepth).toBe(220);
  });

  it('detects center origin when position_min is significantly negative', () => {
    const config = {
      stepper_x: { position_min: '-117.5', position_max: '117.5' },
      stepper_y: { position_min: '-117.5', position_max: '117.5' },
      stepper_z: { position_max: '300' },
      extruder: {},
    };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.originCenter).toBe(true);
    expect(result.bedWidth).toBe(235);
  });

  it('detects non-center origin for typical cartesian', () => {
    const config = {
      stepper_x: { position_min: '0', position_max: '235' },
      stepper_y: { position_min: '0', position_max: '235' },
      stepper_z: { position_max: '250' },
      extruder: {},
    };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.originCenter).toBe(false);
  });

  it('detects circular bed for delta kinematics', () => {
    const config = {
      printer: { kinematics: 'delta' },
      stepper_x: { position_max: '200' },
      stepper_y: { position_max: '200' },
      stepper_z: { position_max: '300' },
      extruder: {},
    };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.bedCircular).toBe(true);
  });

  it('detects non-circular bed for cartesian kinematics', () => {
    const config = {
      printer: { kinematics: 'cartesian' },
      extruder: {},
    };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.bedCircular).toBe(false);
  });

  it('parses extruder config', () => {
    const config = {
      extruder: {
        nozzle_diameter: '0.6',
        filament_diameter: '2.85',
        max_extrude_only_velocity: '80',
      },
    };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.nozzleDiameter).toBe(0.6);
    expect(result.filamentDiameter).toBe(2.85);
    expect(result.maxExtrudeOnlyVelocity).toBe(80);
  });

  it('uses extruder defaults when missing', () => {
    const result = parsePrinterConfig({}, DEFAULT_TOOLHEAD, '');
    expect(result.nozzleDiameter).toBe(0.4);
    expect(result.filamentDiameter).toBe(1.75);
    expect(result.maxExtrudeOnlyVelocity).toBe(50);
  });

  it('counts single extruder', () => {
    const config = { extruder: {} };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.extruderCount).toBe(1);
  });

  it('counts multiple extruders', () => {
    const config = { extruder: {}, extruder1: {}, extruder2: {} };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.extruderCount).toBe(3);
  });

  it('defaults to 1 extruder when none listed', () => {
    const result = parsePrinterConfig({}, DEFAULT_TOOLHEAD, '');
    expect(result.extruderCount).toBe(1);
  });

  it('does not count non-extruder keys containing "extruder"', () => {
    const config = { extruder: {}, extruder_stepper: {} };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.extruderCount).toBe(1);
  });

  it('passes through toolhead values', () => {
    const toolhead = { max_velocity: 500, max_accel: 5000, square_corner_velocity: 8 };
    const result = parsePrinterConfig({}, toolhead, '');
    expect(result.maxVelocity).toBe(500);
    expect(result.maxAccel).toBe(5000);
    expect(result.squareCornerVelocity).toBe(8);
  });

  it('extracts start/end gcode from macro blocks', () => {
    const rawCfg = `
[gcode_macro START_PRINT]
gcode:
  G28
  BED_MESH_CALIBRATE

[gcode_macro END_PRINT]
gcode:
  M104 S0
  M140 S0
`;
    const result = parsePrinterConfig({ extruder: {} }, DEFAULT_TOOLHEAD, rawCfg);
    expect(result.startGcode).toBe('G28\nBED_MESH_CALIBRATE');
    expect(result.endGcode).toBe('M104 S0\nM140 S0');
  });

  it('falls back to inline gcode sections when macros not found', () => {
    const rawCfg = `
start_gcode: G28
  G1 Z5
end_gcode: M84
`;
    const result = parsePrinterConfig({ extruder: {} }, DEFAULT_TOOLHEAD, rawCfg);
    expect(result.startGcode).toBe('G28\nG1 Z5');
    expect(result.endGcode).toBe('M84');
  });

  it('returns empty gcode when no macros or sections found', () => {
    const result = parsePrinterConfig({}, DEFAULT_TOOLHEAD, '');
    expect(result.startGcode).toBe('');
    expect(result.endGcode).toBe('');
  });

  it('handles NaN in stepper config gracefully', () => {
    const config = {
      stepper_x: { position_min: 'bad', position_max: 'bad' },
      extruder: {},
    };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.bedWidth).toBeNaN();
  });

  it('counts extruder, extruder1 but not extruder_stepper or extruder_motion', () => {
    const config = {
      extruder: {},
      extruder1: {},
      extruder_stepper: {},
      extruder_motion: {},
    };
    const result = parsePrinterConfig(config, DEFAULT_TOOLHEAD, '');
    expect(result.extruderCount).toBe(2);
  });
});

// ─── Network functions (mocked fetch) ───────────────────────────────────────

describe('fetchConfigfile', () => {
  useMockFetch();

  it('returns parsed configfile config', async () => {
    globalThis.fetch = mockFetch({
      json: {
        result: { status: { configfile: { config: { extruder: { nozzle_diameter: '0.4' } } } } },
      },
    }) as any;

    const config = await fetchConfigfile('192.168.1.50');
    expect(config).toEqual({ extruder: { nozzle_diameter: '0.4' } });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://192.168.1.50/printer/objects/query?configfile',
      { mode: 'cors' },
    );
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = mockFetch({ ok: false, status: 500, text: 'Internal error' }) as any;
    await expect(fetchConfigfile('192.168.1.50')).rejects.toThrow('failed (500)');
  });

  it('uses statusText when error body is empty', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 502, statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('no json')),
      text: () => Promise.resolve(''),
    })) as any;
    await expect(fetchConfigfile('192.168.1.50')).rejects.toThrow('Bad Gateway');
  });

  it('uses empty string when res.text() rejects', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 500, statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('no json')),
      text: () => Promise.reject(new Error('body stream error')),
    })) as any;
    await expect(fetchConfigfile('192.168.1.50')).rejects.toThrow('Internal Server Error');
  });
});

describe('fetchToolhead', () => {
  useMockFetch();

  it('returns toolhead data', async () => {
    const toolhead = { max_velocity: 300, max_accel: 3000, square_corner_velocity: 5 };
    globalThis.fetch = mockFetch({
      json: { result: { status: { toolhead } } },
    }) as any;

    const result = await fetchToolhead('printer.local');
    expect(result).toEqual(toolhead);
  });
});

describe('fetchRawPrinterCfg', () => {
  useMockFetch();

  it('returns raw printer.cfg text', async () => {
    globalThis.fetch = mockFetch({ text: '[extruder]\nnozzle_diameter: 0.4' }) as any;
    const result = await fetchRawPrinterCfg('printer.local');
    expect(result).toBe('[extruder]\nnozzle_diameter: 0.4');
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = mockFetch({ ok: false, status: 404, text: 'Not found' }) as any;
    await expect(fetchRawPrinterCfg('printer.local')).rejects.toThrow('printer.cfg fetch failed (404)');
  });

  it('uses statusText when error body is empty', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 503, statusText: 'Service Unavailable',
      json: () => Promise.reject(new Error('no json')),
      text: () => Promise.resolve(''),
    })) as any;
    await expect(fetchRawPrinterCfg('printer.local')).rejects.toThrow('Service Unavailable');
  });

  it('handles res.text() rejection gracefully', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 500, statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('no json')),
      text: () => Promise.reject(new Error('body stream error')),
    })) as any;
    await expect(fetchRawPrinterCfg('printer.local')).rejects.toThrow('Internal Server Error');
  });
});

describe('startPrint', () => {
  useMockFetch();

  it('sends POST to correct URL with encoded filename', async () => {
    globalThis.fetch = mockFetch({ json: {} }) as any;
    await startPrint('printer.local', 'my file.gcode');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://printer.local/printer/print/start?filename=my%20file.gcode',
      expect.objectContaining({ method: 'POST', mode: 'cors' }),
    );
  });

  it('throws on non-ok POST response', async () => {
    globalThis.fetch = mockFetch({ ok: false, status: 503, text: 'Printer busy' }) as any;
    await expect(startPrint('printer.local', 'test.gcode')).rejects.toThrow('failed (503)');
  });

  it('sends POST without body', async () => {
    globalThis.fetch = mockFetch({ json: {} }) as any;
    await startPrint('printer.local', 'test.gcode');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'POST', mode: 'cors' }),
    );
  });

  it('uses statusText when POST error body is empty', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 502, statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('no json')),
      text: () => Promise.resolve(''),
    })) as any;
    await expect(startPrint('printer.local', 'test.gcode')).rejects.toThrow('Bad Gateway');
  });

  it('includes error text in POST failure message when available', async () => {
    globalThis.fetch = mockFetch({ ok: false, status: 409, text: 'Conflict: printer busy' }) as any;
    await expect(startPrint('printer.local', 'test.gcode')).rejects.toThrow('Conflict: printer busy');
  });

  it('handles POST res.text() rejection', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 500, statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('no json')),
      text: () => Promise.reject(new Error('body read error')),
    })) as any;
    await expect(startPrint('printer.local', 'test.gcode')).rejects.toThrow('Internal Server Error');
  });
});

describe('fetchPrinterConfig', () => {
  useMockFetch();

  it('handles fetchRawPrinterCfg failure gracefully (catch → empty string)', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 2) {
        const body = callCount === 1
          ? { result: { status: { configfile: { config: { extruder: {} } } } } }
          : { result: { status: { toolhead: { max_velocity: 300, max_accel: 3000, square_corner_velocity: 5 } } } };
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(''),
        });
      }
      // raw printer.cfg fetch fails
      return Promise.resolve({
        ok: false, status: 404, statusText: 'Not Found',
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve('Not found'),
      });
    }) as any;

    const config = await fetchPrinterConfig('printer.local');
    expect(config.startGcode).toBe('');
    expect(config.endGcode).toBe('');
    expect(config.maxVelocity).toBe(300);
  });

  it('fetches and parses full printer config', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(() => {
      callCount++;
      if (callCount <= 2) {
        const body = callCount === 1
          ? { result: { status: { configfile: { config: {
              stepper_x: { position_min: '0', position_max: '220' },
              stepper_y: { position_min: '0', position_max: '220' },
              stepper_z: { position_max: '250' },
              extruder: { nozzle_diameter: '0.4' },
            } } } } }
          : { result: { status: { toolhead: { max_velocity: 300, max_accel: 3000, square_corner_velocity: 5 } } } };
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(''),
        });
      }
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('[gcode_macro START_PRINT]\ngcode:\n  G28\n'),
      });
    }) as any;

    const config = await fetchPrinterConfig('printer.local');
    expect(config.bedWidth).toBe(220);
    expect(config.bedDepth).toBe(220);
    expect(config.maxHeight).toBe(250);
    expect(config.maxVelocity).toBe(300);
    expect(config.startGcode).toBe('G28');
  });
});

// ─── Mixed content ──────────────────────────────────────────────────────────

describe('mixed content check', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws on mixed content (HTTPS page → HTTP printer)', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'https:' } },
      writable: true,
      configurable: true,
    });
    globalThis.fetch = mockFetch({ json: {} }) as any;

    await expect(fetchConfigfile('http://192.168.1.50')).rejects.toThrow('Mixed content blocked');
  });

  it('allows HTTP→HTTP (no mixed content)', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'http:' } },
      writable: true,
      configurable: true,
    });
    globalThis.fetch = mockFetch({
      json: { result: { status: { configfile: { config: {} } } } },
    }) as any;

    await expect(fetchConfigfile('http://192.168.1.50')).resolves.toEqual({});
  });

  it('allows HTTPS→HTTPS (no mixed content)', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'https:' } },
      writable: true,
      configurable: true,
    });
    globalThis.fetch = mockFetch({
      json: { result: { status: { configfile: { config: {} } } } },
    }) as any;

    await expect(fetchConfigfile('https://printer.local')).resolves.toEqual({});
  });

  it('allows mixed content when AndroidPrinterDiscovery allows cleartext', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: { protocol: 'https:' },
        AndroidPrinterDiscovery: { allowsCleartextTraffic: () => true },
      },
      writable: true,
      configurable: true,
    });
    globalThis.fetch = mockFetch({
      json: { result: { status: { configfile: { config: {} } } } },
    }) as any;

    await expect(fetchConfigfile('http://192.168.1.50')).resolves.toEqual({});
  });
});
