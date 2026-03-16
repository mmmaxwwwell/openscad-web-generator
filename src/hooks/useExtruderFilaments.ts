// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Per-extruder filament assignment, persisted per printer address in localStorage.
 *
 * Maps extruder index (0, 1, 2, ...) → filament profile ID.
 * Defaults all extruders to 'builtin-pla' if no assignment exists.
 */

import { useCallback, useEffect, useState } from 'react';
import { BUILTIN_PRESETS, type FilamentProfile } from './useFilaments';

const STORAGE_KEY = 'extruder-filament-assignments';
const DEFAULT_FILAMENT_ID = 'builtin-pla';

/** Map of extruder index → filament profile ID */
export type ExtruderFilamentMap = Record<number, string>;

/** All assignments keyed by printer address */
type AssignmentStore = Record<string, ExtruderFilamentMap>;

function loadStore(): AssignmentStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(store: AssignmentStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/**
 * Build a default assignment map for the given extruder count.
 * All extruders default to PLA.
 */
function buildDefaults(extruderCount: number): ExtruderFilamentMap {
  const map: ExtruderFilamentMap = {};
  for (let i = 0; i < extruderCount; i++) {
    map[i] = DEFAULT_FILAMENT_ID;
  }
  return map;
}

/**
 * Remove stored assignments for a printer (e.g. when the printer is deleted).
 */
export function removeExtruderAssignments(printerAddress: string): void {
  const store = loadStore();
  delete store[printerAddress];
  saveStore(store);
}

export interface UseExtruderFilamentsResult {
  /** Current extruder → filament ID mapping */
  assignments: ExtruderFilamentMap;
  /** Set the filament for a specific extruder */
  setExtruderFilament: (extruderIndex: number, filamentId: string) => void;
  /** Resolve the full FilamentProfile for an extruder (returns PLA if not found) */
  getFilamentForExtruder: (extruderIndex: number, allFilaments: FilamentProfile[]) => FilamentProfile;
}

/**
 * Manage per-extruder filament assignments for a given printer.
 *
 * @param printerAddress - The printer's address (used as storage key). Pass null to skip.
 * @param extruderCount - Number of extruders on the printer (defaults to 1).
 */
export function useExtruderFilaments(
  printerAddress: string | null | undefined,
  extruderCount: number = 1,
): UseExtruderFilamentsResult {
  const [assignments, setAssignments] = useState<ExtruderFilamentMap>(() => {
    if (!printerAddress) return buildDefaults(extruderCount);
    const store = loadStore();
    return store[printerAddress] ?? buildDefaults(extruderCount);
  });

  // Re-load when printer address changes
  useEffect(() => {
    if (!printerAddress) {
      setAssignments(buildDefaults(extruderCount));
      return;
    }
    const store = loadStore();
    const saved = store[printerAddress];
    if (saved) {
      // Ensure we have entries for all extruders (printer may have gained extruders)
      const merged: ExtruderFilamentMap = {};
      for (let i = 0; i < extruderCount; i++) {
        merged[i] = saved[i] ?? DEFAULT_FILAMENT_ID;
      }
      setAssignments(merged);
    } else {
      setAssignments(buildDefaults(extruderCount));
    }
  }, [printerAddress, extruderCount]);

  const setExtruderFilament = useCallback(
    (extruderIndex: number, filamentId: string) => {
      setAssignments((prev) => {
        const next = { ...prev, [extruderIndex]: filamentId };
        // Persist
        if (printerAddress) {
          const store = loadStore();
          store[printerAddress] = next;
          saveStore(store);
        }
        return next;
      });
    },
    [printerAddress],
  );

  const getFilamentForExtruder = useCallback(
    (extruderIndex: number, allFilaments: FilamentProfile[]): FilamentProfile => {
      const id = assignments[extruderIndex] ?? DEFAULT_FILAMENT_ID;
      const found = allFilaments.find((f) => f.id === id);
      // Fallback to PLA builtin if the assigned filament was deleted
      return found ?? BUILTIN_PRESETS[0];
    },
    [assignments],
  );

  return { assignments, setExtruderFilament, getFilamentForExtruder };
}
