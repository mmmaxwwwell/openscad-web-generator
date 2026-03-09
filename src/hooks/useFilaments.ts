import { useCallback, useEffect, useState } from 'react';
import { getPrinterProfile, getFilamentDefaults, getNozzleProfile } from '../data/printer-profiles';

export interface FilamentProfile {
  id: string;
  name: string;
  /** Filament type key used for printer profile lookup (e.g. 'pla', 'petg') */
  type: string;
  nozzleTemp: number;
  bedTemp: number;
  fanSpeed: number; // 0-100 percentage
  printSpeed: number; // mm/s
  retractDist: number; // mm
  retractSpeed: number; // mm/s
  firstLayerNozzleTemp: number; // °C
  firstLayerBedTemp: number; // °C
  minSpeed: number; // mm/s — cooling slowdown min speed
  minLayerTime: number; // seconds — min layer time for cooling
  notes: string;
  builtin: boolean; // true = non-deletable preset
}

/** Generic defaults (no printer profile selected) */
const GENERIC_PRESETS: FilamentProfile[] = [
  {
    id: 'builtin-pla',
    name: 'PLA',
    type: 'pla',
    nozzleTemp: 210,
    bedTemp: 60,
    fanSpeed: 100,
    printSpeed: 50,
    retractDist: 4,
    retractSpeed: 45,
    firstLayerNozzleTemp: 210,
    firstLayerBedTemp: 60,
    minSpeed: 20,
    minLayerTime: 6,
    notes: 'Most common, easy to print',
    builtin: true,
  },
  {
    id: 'builtin-petg',
    name: 'PETG',
    type: 'petg',
    nozzleTemp: 240,
    bedTemp: 80,
    fanSpeed: 50,
    printSpeed: 45,
    retractDist: 5,
    retractSpeed: 45,
    firstLayerNozzleTemp: 240,
    firstLayerBedTemp: 80,
    minSpeed: 30,
    minLayerTime: 8,
    notes: 'Stringing-prone, strong',
    builtin: true,
  },
  {
    id: 'builtin-tpu',
    name: 'TPU',
    type: 'tpu',
    nozzleTemp: 230,
    bedTemp: 50,
    fanSpeed: 50,
    printSpeed: 25,
    retractDist: 2,
    retractSpeed: 25,
    firstLayerNozzleTemp: 230,
    firstLayerBedTemp: 50,
    minSpeed: 20,
    minLayerTime: 8,
    notes: 'Flexible, slow, minimal retraction',
    builtin: true,
  },
  {
    id: 'builtin-asa',
    name: 'ASA',
    type: 'asa',
    nozzleTemp: 260,
    bedTemp: 100,
    fanSpeed: 30,
    printSpeed: 45,
    retractDist: 5,
    retractSpeed: 45,
    firstLayerNozzleTemp: 260,
    firstLayerBedTemp: 100,
    minSpeed: 20,
    minLayerTime: 5,
    notes: 'UV-resistant, needs enclosure',
    builtin: true,
  },
  {
    id: 'builtin-abs',
    name: 'ABS',
    type: 'abs',
    nozzleTemp: 250,
    bedTemp: 100,
    fanSpeed: 0,
    printSpeed: 45,
    retractDist: 5,
    retractSpeed: 45,
    firstLayerNozzleTemp: 250,
    firstLayerBedTemp: 100,
    minSpeed: 20,
    minLayerTime: 8,
    notes: 'Needs enclosure, prone to warping',
    builtin: true,
  },
];

/**
 * Build builtin presets with printer-profile-aware defaults.
 * If a printer profile is set, override generic values with
 * the profile's per-filament and per-nozzle defaults.
 */
function buildBuiltinPresets(profileId?: string, nozzleDiameter?: number): FilamentProfile[] {
  if (!profileId) return GENERIC_PRESETS;

  const printerProfile = getPrinterProfile(profileId);
  if (!printerProfile) return GENERIC_PRESETS;

  const nozzle = getNozzleProfile(printerProfile, nozzleDiameter ?? printerProfile.defaultNozzle);

  return GENERIC_PRESETS.map((preset) => {
    const fd = getFilamentDefaults(printerProfile, preset.type);
    if (!fd) return preset;

    return {
      ...preset,
      nozzleTemp: fd.nozzleTemp,
      bedTemp: fd.bedTemp,
      fanSpeed: fd.fanSpeed,
      printSpeed: fd.printSpeed,
      retractDist: fd.retractDist ?? nozzle?.retractDist ?? preset.retractDist,
      retractSpeed: fd.retractSpeed ?? nozzle?.retractSpeed ?? preset.retractSpeed,
      firstLayerNozzleTemp: fd.firstLayerNozzleTemp ?? fd.nozzleTemp,
      firstLayerBedTemp: fd.firstLayerBedTemp ?? fd.bedTemp,
      minSpeed: fd.minSpeed ?? preset.minSpeed,
      minLayerTime: fd.minLayerTime ?? preset.minLayerTime,
      notes: fd.notes,
    };
  });
}

const STORAGE_KEY = 'filament-profiles';

function loadCustomFilaments(): FilamentProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((f: FilamentProfile) => ({
      ...f,
      builtin: false,
      // Backfill fields added after initial release
      firstLayerNozzleTemp: f.firstLayerNozzleTemp ?? f.nozzleTemp,
      firstLayerBedTemp: f.firstLayerBedTemp ?? f.bedTemp,
      minSpeed: f.minSpeed ?? 20,
      minLayerTime: f.minLayerTime ?? 6,
    }));
  } catch {
    return [];
  }
}

function saveCustomFilaments(filaments: FilamentProfile[]) {
  // Only persist user-created filaments; builtins are always generated from code
  const custom = filaments.filter((f) => !f.builtin);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
}

export function useFilaments(printerProfileId?: string, nozzleDiameter?: number) {
  const [customFilaments, setCustomFilaments] = useState<FilamentProfile[]>(loadCustomFilaments);

  const builtinPresets = buildBuiltinPresets(printerProfileId, nozzleDiameter);

  // All filaments = builtins first, then custom
  const filaments = [...builtinPresets, ...customFilaments];

  useEffect(() => {
    saveCustomFilaments(customFilaments);
  }, [customFilaments]);

  const addFilament = useCallback((profile: Omit<FilamentProfile, 'id' | 'builtin'>) => {
    const filament: FilamentProfile = {
      ...profile,
      id: crypto.randomUUID(),
      builtin: false,
    };
    setCustomFilaments((prev) => [...prev, filament]);
    return filament.id;
  }, []);

  const updateFilament = useCallback((id: string, updates: Partial<Omit<FilamentProfile, 'id' | 'builtin'>>) => {
    setCustomFilaments((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    );
  }, []);

  const deleteFilament = useCallback((id: string) => {
    // Prevent deleting builtins
    if (GENERIC_PRESETS.some((p) => p.id === id)) return;
    setCustomFilaments((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const duplicateFilament = useCallback((id: string) => {
    const source = [...builtinPresets, ...loadCustomFilaments()].find((f) => f.id === id);
    if (!source) return;
    const { id: _id, builtin: _builtin, name, ...rest } = source;
    const newFilament: FilamentProfile = {
      ...rest,
      name: `${name} (copy)`,
      id: crypto.randomUUID(),
      builtin: false,
    };
    setCustomFilaments((prev) => [...prev, newFilament]);
    return newFilament.id;
  }, [builtinPresets]);

  return { filaments, addFilament, updateFilament, deleteFilament, duplicateFilament };
}

export { GENERIC_PRESETS as BUILTIN_PRESETS };
