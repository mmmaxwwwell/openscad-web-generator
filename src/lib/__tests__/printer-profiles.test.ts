// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  getPrinterProfile,
  getNozzleProfile,
  getFilamentDefaults,
  FLASHFORGE_ADV5M,
  PRINTER_PROFILES,
} from '../../data/printer-profiles';

describe('printer-profiles', () => {
  describe('PRINTER_PROFILES', () => {
    it('contains at least one profile', () => {
      expect(PRINTER_PROFILES.length).toBeGreaterThan(0);
    });

    it('contains the FlashForge ADV5M', () => {
      expect(PRINTER_PROFILES).toContain(FLASHFORGE_ADV5M);
    });
  });

  describe('getPrinterProfile', () => {
    it('returns the profile for a valid ID', () => {
      const profile = getPrinterProfile('flashforge-adv5m');
      expect(profile).toBe(FLASHFORGE_ADV5M);
      expect(profile?.name).toBe('FlashForge Adventurer 5M');
    });

    it('returns undefined for an unknown ID', () => {
      expect(getPrinterProfile('nonexistent')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getPrinterProfile('')).toBeUndefined();
    });
  });

  describe('getNozzleProfile', () => {
    it('returns the 0.4mm nozzle profile', () => {
      const nozzle = getNozzleProfile(FLASHFORGE_ADV5M, 0.4);
      expect(nozzle).toBeDefined();
      expect(nozzle!.diameter).toBe(0.4);
      expect(nozzle!.retractDist).toBe(0.8);
    });

    it('returns the 0.25mm nozzle profile', () => {
      const nozzle = getNozzleProfile(FLASHFORGE_ADV5M, 0.25);
      expect(nozzle).toBeDefined();
      expect(nozzle!.diameter).toBe(0.25);
    });

    it('returns the 0.6mm nozzle profile', () => {
      const nozzle = getNozzleProfile(FLASHFORGE_ADV5M, 0.6);
      expect(nozzle).toBeDefined();
      expect(nozzle!.diameter).toBe(0.6);
    });

    it('returns the 0.8mm nozzle profile', () => {
      const nozzle = getNozzleProfile(FLASHFORGE_ADV5M, 0.8);
      expect(nozzle).toBeDefined();
      expect(nozzle!.diameter).toBe(0.8);
    });

    it('returns undefined for a non-existent nozzle size', () => {
      expect(getNozzleProfile(FLASHFORGE_ADV5M, 1.0)).toBeUndefined();
    });
  });

  describe('getFilamentDefaults', () => {
    it('returns PLA defaults', () => {
      const defaults = getFilamentDefaults(FLASHFORGE_ADV5M, 'pla');
      expect(defaults).toBeDefined();
      expect(defaults!.nozzleTemp).toBe(220);
      expect(defaults!.bedTemp).toBe(55);
      expect(defaults!.fanSpeed).toBe(100);
    });

    it('returns PETG defaults', () => {
      const defaults = getFilamentDefaults(FLASHFORGE_ADV5M, 'petg');
      expect(defaults).toBeDefined();
      expect(defaults!.nozzleTemp).toBe(255);
      expect(defaults!.bedTemp).toBe(70);
    });

    it('returns TPU defaults with retract overrides', () => {
      const defaults = getFilamentDefaults(FLASHFORGE_ADV5M, 'tpu');
      expect(defaults).toBeDefined();
      expect(defaults!.retractDist).toBe(1.2);
    });

    it('returns ASA defaults', () => {
      const defaults = getFilamentDefaults(FLASHFORGE_ADV5M, 'asa');
      expect(defaults).toBeDefined();
      expect(defaults!.fanSpeed).toBe(20);
    });

    it('returns ABS defaults', () => {
      const defaults = getFilamentDefaults(FLASHFORGE_ADV5M, 'abs');
      expect(defaults).toBeDefined();
      expect(defaults!.nozzleTemp).toBe(260);
    });

    it('is case-insensitive', () => {
      expect(getFilamentDefaults(FLASHFORGE_ADV5M, 'PLA')).toBeDefined();
      expect(getFilamentDefaults(FLASHFORGE_ADV5M, 'Petg')).toBeDefined();
      expect(getFilamentDefaults(FLASHFORGE_ADV5M, 'TPU')).toBeDefined();
    });

    it('returns undefined for an unknown filament type', () => {
      expect(getFilamentDefaults(FLASHFORGE_ADV5M, 'nylon')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getFilamentDefaults(FLASHFORGE_ADV5M, '')).toBeUndefined();
    });
  });

  describe('FLASHFORGE_ADV5M profile data', () => {
    it('has correct bed dimensions', () => {
      expect(FLASHFORGE_ADV5M.bedWidth).toBe(220);
      expect(FLASHFORGE_ADV5M.bedDepth).toBe(220);
      expect(FLASHFORGE_ADV5M.maxHeight).toBe(220);
      expect(FLASHFORGE_ADV5M.originCenter).toBe(true);
    });

    it('has 4 nozzle profiles', () => {
      expect(FLASHFORGE_ADV5M.nozzles).toHaveLength(4);
    });

    it('has default nozzle of 0.4mm', () => {
      expect(FLASHFORGE_ADV5M.defaultNozzle).toBe(0.4);
    });

    it('has start and end gcode', () => {
      expect(FLASHFORGE_ADV5M.startGcode).toContain('START_PRINT');
      expect(FLASHFORGE_ADV5M.endGcode).toContain('END_PRINT');
    });

    it('has klipper gcode flavor', () => {
      expect(FLASHFORGE_ADV5M.gcodeFlaver).toBe('klipper');
    });

    it('has print defaults', () => {
      expect(FLASHFORGE_ADV5M.printDefaults.layerHeight).toBe(0.2);
      expect(FLASHFORGE_ADV5M.printDefaults.shellCount).toBe(2);
      expect(FLASHFORGE_ADV5M.printDefaults.infillDensity).toBe(0.15);
    });
  });
});
