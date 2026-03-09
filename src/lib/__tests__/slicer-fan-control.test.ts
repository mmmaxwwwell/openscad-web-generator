import { describe, it, expect } from 'vitest';
import { buildProcessSettings, buildDeviceSettings, type PrinterSettings } from '../slicer-settings';
import { DEFAULT_PRINT_PROFILE, type PrintProfile } from '../../types/print-profile';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';

// ─── Helpers ───

const PLA_RESOLVED: ResolvedFilamentSettings = {
  nozzleTemp: 210,
  bedTemp: 60,
  fanSpeed: 100,
  firstLayerFan: 0,
  printSpeed: 50,
  retractDist: 4,
  retractSpeed: 45,
  firstLayerNozzleTemp: 210,
  firstLayerBedTemp: 60,
  minSpeed: 20,
  minLayerTime: 6,
};

function makeFilament(overrides: Partial<ResolvedFilamentSettings> = {}): ResolvedFilamentSettings {
  return { ...PLA_RESOLVED, ...overrides };
}

const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  bedWidth: 235,
  bedDepth: 235,
  maxHeight: 300,
  originCenter: false,
  startGcode: 'START_PRINT BED_TEMP={bed_temp} EXTRUDER_TEMP={temp}',
  endGcode: 'END_PRINT',
  toolChangeGcode: 'T{tool}',
};

// ─── Tests ───

describe('slicer-settings: fan control', () => {
  describe('buildProcessSettings — fan speed conversion', () => {
    it('PLA 100% fan → outputFanSpeed=255, firstLayerFanSpeed=0, outputFanLayer=1', () => {
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, makeFilament({
        fanSpeed: 100,
        firstLayerFan: 0,
      }));
      expect(result.outputFanSpeed).toBe(255);
      expect(result.firstLayerFanSpeed).toBe(0);
      expect(result.outputFanLayer).toBe(1);
    });

    it('PETG reduced fan: 50% → outputFanSpeed≈128', () => {
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, makeFilament({
        fanSpeed: 50,
        firstLayerFan: 0,
      }));
      // 50 * 2.55 = 127.5 in exact math, but IEEE 754 gives 127.499...
      expect(result.outputFanSpeed).toBe(Math.round(50 * 2.55));
      expect(result.firstLayerFanSpeed).toBe(0);
    });

    it('ABS minimal fan: 20% → outputFanSpeed=51', () => {
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, makeFilament({
        fanSpeed: 20,
        firstLayerFan: 0,
      }));
      expect(result.outputFanSpeed).toBe(51);
    });

    it('TPU no fan: 0% → outputFanSpeed=0', () => {
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, makeFilament({
        fanSpeed: 0,
        firstLayerFan: 0,
      }));
      expect(result.outputFanSpeed).toBe(0);
    });

    it('first layer fan override: fanSpeed=100, firstLayerFan=50 → firstLayerFanSpeed≈128', () => {
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, makeFilament({
        fanSpeed: 100,
        firstLayerFan: 50,
      }));
      expect(result.outputFanSpeed).toBe(255);
      // 50 * 2.55 = 127.499... in IEEE 754
      expect(result.firstLayerFanSpeed).toBe(Math.round(50 * 2.55));
    });
  });

  describe('buildProcessSettings — outputFanLayer is always 1', () => {
    it('outputFanLayer defaults to 1 regardless of profile', () => {
      const customProfile: PrintProfile = { ...DEFAULT_PRINT_PROFILE, layerHeight: 0.1 };
      const result = buildProcessSettings(customProfile, PLA_RESOLVED);
      expect(result.outputFanLayer).toBe(1);
    });
  });

  describe('buildProcessSettings — other filament-derived fields', () => {
    it('maps temperature and speed fields correctly', () => {
      const filament = makeFilament({
        nozzleTemp: 230,
        bedTemp: 80,
        printSpeed: 60,
        retractDist: 5,
        retractSpeed: 50,
      });
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, filament);
      expect(result.outputTemp).toBe(230);
      expect(result.outputBedTemp).toBe(80);
      expect(result.outputFeedrate).toBe(60);
      expect(result.outputRetractDist).toBe(5);
      expect(result.outputRetractSpeed).toBe(50);
    });
  });

  describe('buildDeviceSettings — gcode templates', () => {
    it('includes gcodeFan template for M106', () => {
      const result = buildDeviceSettings(null, DEFAULT_PRINTER_SETTINGS, 1);
      expect(result.gcodeFan).toEqual(['M106 S{fan_speed}']);
    });

    it('includes gcodeLayer template for layer comments', () => {
      const result = buildDeviceSettings(null, DEFAULT_PRINTER_SETTINGS, 1);
      expect(result.gcodeLayer).toEqual([';LAYER:{layer}']);
    });

    it('migrates PrusaSlicer gcode variables in startGcode', () => {
      const ps: PrinterSettings = {
        ...DEFAULT_PRINTER_SETTINGS,
        startGcode: 'M190 S{first_layer_bed_temperature[0]}\nM109 S{first_layer_temperature[0]}',
      };
      const result = buildDeviceSettings(null, ps, 1);
      const pre = result.gcodePre as string[];
      expect(pre).toContain('M190 S{bed_temp}');
      expect(pre).toContain('M109 S{temp}');
    });

    it('sets bed dimensions from printer settings', () => {
      const result = buildDeviceSettings(null, DEFAULT_PRINTER_SETTINGS, 1);
      expect(result.bedWidth).toBe(235);
      expect(result.bedDepth).toBe(235);
      expect(result.maxHeight).toBe(300);
      expect(result.originCenter).toBe(false);
    });

    it('creates single extruder with defaults when no PrinterConfig', () => {
      const result = buildDeviceSettings(null, DEFAULT_PRINTER_SETTINGS, 1);
      const extruders = result.extruders as Record<string, unknown>[];
      expect(extruders).toHaveLength(1);
      expect(extruders[0].extNozzle).toBe(0.4);
      expect(extruders[0].extFilament).toBe(1.75);
      expect(extruders[0].extSelect).toEqual(['T0']);
    });

    it('creates multiple extruders when extruderCount > 1', () => {
      const filaments = [
        { id: 'pla', name: 'PLA', type: 'pla', nozzleTemp: 210, bedTemp: 60, fanSpeed: 100, printSpeed: 50, retractDist: 4, retractSpeed: 45, firstLayerNozzleTemp: 210, firstLayerBedTemp: 60, minSpeed: 20, minLayerTime: 6, notes: '', builtin: true },
        { id: 'petg', name: 'PETG', type: 'petg', nozzleTemp: 240, bedTemp: 80, fanSpeed: 50, printSpeed: 40, retractDist: 5, retractSpeed: 40, firstLayerNozzleTemp: 240, firstLayerBedTemp: 80, minSpeed: 20, minLayerTime: 6, notes: '', builtin: true },
      ];
      const getFilament = (i: number) => filaments[i];
      const result = buildDeviceSettings(null, DEFAULT_PRINTER_SETTINGS, 2, getFilament as never, filaments);
      const extruders = result.extruders as Record<string, unknown>[];
      expect(extruders).toHaveLength(2);
      expect(extruders[0].extSelect).toEqual(['T0']);
      expect(extruders[0].extTemp).toBe(210);
      expect(extruders[1].extSelect).toEqual(['T1']);
      expect(extruders[1].extTemp).toBe(240);
    });
  });

  describe('buildProcessSettings — fan speed rounding edge cases', () => {
    it('33% fan → Math.round(33 * 2.55) = 84', () => {
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, makeFilament({ fanSpeed: 33 }));
      expect(result.outputFanSpeed).toBe(Math.round(33 * 2.55));
      expect(result.outputFanSpeed).toBe(84);
    });

    it('1% fan → Math.round(1 * 2.55) = 3', () => {
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, makeFilament({ fanSpeed: 1 }));
      expect(result.outputFanSpeed).toBe(3);
    });

    it('99% fan → Math.round(99 * 2.55) = 252', () => {
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, makeFilament({ fanSpeed: 99 }));
      expect(result.outputFanSpeed).toBe(252);
    });
  });

  describe('regression: fan must activate at layer 1, not later', () => {
    it('outputFanLayer is exactly 1 (second physical layer) for PLA defaults', () => {
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, PLA_RESOLVED);
      // The bug: fan was activating at layer 45 instead of layer 1.
      // outputFanLayer=1 means fan turns on at the second layer (0-indexed).
      expect(result.outputFanLayer).toBe(1);
      // Verify the fan speed itself is non-zero for PLA
      expect(result.outputFanSpeed).toBeGreaterThan(0);
      // Verify first layer fan is off for default PLA
      expect(result.firstLayerFanSpeed).toBe(0);
    });

    it('outputFanSpeed is set even when firstLayerFanSpeed is 0', () => {
      // Ensures the engine receives both values independently
      const result = buildProcessSettings(DEFAULT_PRINT_PROFILE, makeFilament({
        fanSpeed: 80,
        firstLayerFan: 0,
      }));
      expect(result.outputFanSpeed).toBe(204);
      expect(result.firstLayerFanSpeed).toBe(0);
      expect(result.outputFanLayer).toBe(1);
    });
  });
});
