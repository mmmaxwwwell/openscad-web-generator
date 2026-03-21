// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Per-printer filament overrides — lets users tweak filament settings
 * (temp, speed, retraction, fan) for a specific printer without modifying
 * the global FilamentProfile.
 *
 * Stored in localStorage as:
 *   Record<printerAddress, Record<filamentId, PrinterFilamentOverride>>
 */

import { useCallback, useState } from 'react';
import type { FilamentProfile } from './useFilaments';

const STORAGE_KEY = 'printer-filament-overrides';

export interface PrinterFilamentOverride {
  nozzleTemp?: number;
  bedTemp?: number;
  fanSpeed?: number;
  firstLayerFan?: number;
  printSpeed?: number;
  retractDist?: number;
  retractSpeed?: number;
  deretractionSpeed?: number;
  firstLayerNozzleTemp?: number;
  firstLayerBedTemp?: number;
  minSpeed?: number;
  minLayerTime?: number;
  // OrcaSlicer filament fields
  flowRatio?: number;
  enablePressureAdvance?: boolean;
  pressureAdvance?: number;
  adaptivePressureAdvance?: boolean;
  overhangFanSpeed?: number;
  overhangFanThreshold?: number;
  enableOverhangBridgeFan?: boolean;
  closeFanFirstLayers?: number;
  fanCoolingLayerTime?: number;
  slowDownLayerTime?: number;
  fanMaxSpeed?: number;
  // Multi-plate bed temps
  coolPlateTemp?: number;
  coolPlateTempInitialLayer?: number;
  engPlateTemp?: number;
  engPlateTempInitialLayer?: number;
  texturedPlateTemp?: number;
  texturedPlateTempInitialLayer?: number;
}

export interface ResolvedFilamentSettings {
  nozzleTemp: number;
  bedTemp: number;
  fanSpeed: number;
  firstLayerFan: number;
  printSpeed: number;
  retractDist: number;
  retractSpeed: number;
  deretractionSpeed: number;
  firstLayerNozzleTemp: number;
  firstLayerBedTemp: number;
  minSpeed: number;
  minLayerTime: number;
  // OrcaSlicer filament fields
  flowRatio: number;
  enablePressureAdvance: boolean;
  pressureAdvance: number;
  adaptivePressureAdvance: boolean;
  overhangFanSpeed: number;
  overhangFanThreshold: number;
  enableOverhangBridgeFan: boolean;
  closeFanFirstLayers: number;
  fanCoolingLayerTime: number;
  slowDownLayerTime: number;
  fanMaxSpeed: number;
  // Multi-plate bed temps
  coolPlateTemp: number;
  coolPlateTempInitialLayer: number;
  engPlateTemp: number;
  engPlateTempInitialLayer: number;
  texturedPlateTemp: number;
  texturedPlateTempInitialLayer: number;
}

/** All overrides keyed by printer address, then filament ID */
type OverrideStore = Record<string, Record<string, PrinterFilamentOverride>>;

function loadStore(): OverrideStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(store: OverrideStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Merge a global FilamentProfile with per-printer overrides */
function resolveFilament(
  filament: FilamentProfile,
  overrides: PrinterFilamentOverride,
): ResolvedFilamentSettings {
  return {
    nozzleTemp: overrides.nozzleTemp ?? filament.nozzleTemp,
    bedTemp: overrides.bedTemp ?? filament.bedTemp,
    fanSpeed: overrides.fanSpeed ?? filament.fanSpeed,
    firstLayerFan: overrides.firstLayerFan ?? 0,
    printSpeed: overrides.printSpeed ?? filament.printSpeed,
    retractDist: overrides.retractDist ?? filament.retractDist,
    retractSpeed: overrides.retractSpeed ?? filament.retractSpeed,
    deretractionSpeed: overrides.deretractionSpeed ?? filament.deretractionSpeed ?? 0,
    firstLayerNozzleTemp: overrides.firstLayerNozzleTemp ?? filament.firstLayerNozzleTemp ?? filament.nozzleTemp,
    firstLayerBedTemp: overrides.firstLayerBedTemp ?? filament.firstLayerBedTemp ?? filament.bedTemp,
    minSpeed: overrides.minSpeed ?? filament.minSpeed ?? 20,
    minLayerTime: overrides.minLayerTime ?? filament.minLayerTime ?? 6,
    // OrcaSlicer filament fields
    flowRatio: overrides.flowRatio ?? filament.flowRatio ?? 1.0,
    enablePressureAdvance: overrides.enablePressureAdvance ?? filament.enablePressureAdvance ?? false,
    pressureAdvance: overrides.pressureAdvance ?? filament.pressureAdvance ?? 0.04,
    adaptivePressureAdvance: overrides.adaptivePressureAdvance ?? filament.adaptivePressureAdvance ?? false,
    overhangFanSpeed: overrides.overhangFanSpeed ?? filament.overhangFanSpeed ?? 100,
    overhangFanThreshold: overrides.overhangFanThreshold ?? filament.overhangFanThreshold ?? 0,
    enableOverhangBridgeFan: overrides.enableOverhangBridgeFan ?? filament.enableOverhangBridgeFan ?? true,
    closeFanFirstLayers: overrides.closeFanFirstLayers ?? filament.closeFanFirstLayers ?? 1,
    fanCoolingLayerTime: overrides.fanCoolingLayerTime ?? filament.fanCoolingLayerTime ?? 60,
    slowDownLayerTime: overrides.slowDownLayerTime ?? filament.slowDownLayerTime ?? 4,
    fanMaxSpeed: overrides.fanMaxSpeed ?? filament.fanMaxSpeed ?? overrides.fanSpeed ?? filament.fanSpeed,
    // Multi-plate bed temps (default to standard bed temp)
    coolPlateTemp: overrides.coolPlateTemp ?? filament.coolPlateTemp ?? filament.bedTemp,
    coolPlateTempInitialLayer: overrides.coolPlateTempInitialLayer ?? filament.coolPlateTempInitialLayer ?? filament.firstLayerBedTemp ?? filament.bedTemp,
    engPlateTemp: overrides.engPlateTemp ?? filament.engPlateTemp ?? filament.bedTemp,
    engPlateTempInitialLayer: overrides.engPlateTempInitialLayer ?? filament.engPlateTempInitialLayer ?? filament.firstLayerBedTemp ?? filament.bedTemp,
    texturedPlateTemp: overrides.texturedPlateTemp ?? filament.texturedPlateTemp ?? filament.bedTemp,
    texturedPlateTempInitialLayer: overrides.texturedPlateTempInitialLayer ?? filament.texturedPlateTempInitialLayer ?? filament.firstLayerBedTemp ?? filament.bedTemp,
  };
}

export interface UsePrinterFilamentOverridesResult {
  /** Get resolved filament settings (global + per-printer overrides merged) */
  getResolvedFilament: (printerAddress: string, filament: FilamentProfile) => ResolvedFilamentSettings;
  /** Save an override for a specific printer+filament pair */
  setOverride: (printerAddress: string, filamentId: string, overrides: PrinterFilamentOverride) => void;
  /** Get just the overrides (for showing what's customized) */
  getOverrides: (printerAddress: string, filamentId: string) => PrinterFilamentOverride;
  /** Reset overrides back to global defaults */
  resetOverrides: (printerAddress: string, filamentId: string) => void;
  /** Check if a specific field is overridden */
  isFieldOverridden: (printerAddress: string, filamentId: string, field: keyof PrinterFilamentOverride) => boolean;
  /** Reset a single field back to global default */
  resetField: (printerAddress: string, filamentId: string, field: keyof PrinterFilamentOverride) => void;
}

export function usePrinterFilamentOverrides(): UsePrinterFilamentOverridesResult {
  // Revision counter to trigger re-renders when overrides change
  const [, setRev] = useState(0);

  const getOverrides = useCallback(
    (printerAddress: string, filamentId: string): PrinterFilamentOverride => {
      const store = loadStore();
      return store[printerAddress]?.[filamentId] ?? {};
    },
    [],
  );

  const getResolvedFilament = useCallback(
    (printerAddress: string, filament: FilamentProfile): ResolvedFilamentSettings => {
      const overrides = getOverrides(printerAddress, filament.id);
      return resolveFilament(filament, overrides);
    },
    [getOverrides],
  );

  const setOverride = useCallback(
    (printerAddress: string, filamentId: string, overrides: PrinterFilamentOverride) => {
      const store = loadStore();
      if (!store[printerAddress]) store[printerAddress] = {};
      const existing = store[printerAddress][filamentId] ?? {};
      // Merge new overrides, remove undefined values
      const merged: PrinterFilamentOverride = { ...existing };
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete merged[key as keyof PrinterFilamentOverride];
        } else {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
      // Clean up empty override objects
      if (Object.keys(merged).length === 0) {
        delete store[printerAddress][filamentId];
        if (Object.keys(store[printerAddress]).length === 0) {
          delete store[printerAddress];
        }
      } else {
        store[printerAddress][filamentId] = merged;
      }
      saveStore(store);
      setRev((n) => n + 1);
    },
    [],
  );

  const resetOverrides = useCallback(
    (printerAddress: string, filamentId: string) => {
      const store = loadStore();
      if (store[printerAddress]) {
        delete store[printerAddress][filamentId];
        if (Object.keys(store[printerAddress]).length === 0) {
          delete store[printerAddress];
        }
        saveStore(store);
        setRev((n) => n + 1);
      }
    },
    [],
  );

  const isFieldOverridden = useCallback(
    (printerAddress: string, filamentId: string, field: keyof PrinterFilamentOverride): boolean => {
      const overrides = getOverrides(printerAddress, filamentId);
      return overrides[field] !== undefined;
    },
    [getOverrides],
  );

  const resetField = useCallback(
    (printerAddress: string, filamentId: string, field: keyof PrinterFilamentOverride) => {
      const store = loadStore();
      const existing = store[printerAddress]?.[filamentId];
      if (!existing) return;
      delete existing[field];
      if (Object.keys(existing).length === 0) {
        delete store[printerAddress][filamentId];
        if (Object.keys(store[printerAddress]).length === 0) {
          delete store[printerAddress];
        }
      }
      saveStore(store);
      setRev((n) => n + 1);
    },
    [],
  );

  return { getResolvedFilament, setOverride, getOverrides, resetOverrides, isFieldOverridden, resetField };
}
