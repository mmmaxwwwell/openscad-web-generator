import { useCallback, useEffect, useState } from 'react';

export interface Printer {
  id: string;
  name: string;
  address: string;
  /** Printer profile ID from printer-profiles.ts (e.g. 'flashforge-adv5m'), or empty for generic */
  profileId?: string;
  /** Selected nozzle diameter in mm (e.g. 0.4) */
  nozzleDiameter?: number;
}

const STORAGE_KEY = 'moonraker-printers';

function loadPrinters(): Printer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function savePrinters(printers: Printer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(printers));
}

export function usePrinters() {
  const [printers, setPrinters] = useState<Printer[]>(loadPrinters);

  // Sync to localStorage whenever printers change
  useEffect(() => {
    savePrinters(printers);
  }, [printers]);

  const addPrinter = useCallback((name: string, address: string, profileId?: string, nozzleDiameter?: number) => {
    const printer: Printer = { id: crypto.randomUUID(), name, address, profileId, nozzleDiameter };
    setPrinters((prev) => [...prev, printer]);
  }, []);

  const updatePrinter = useCallback((id: string, name: string, address: string, profileId?: string, nozzleDiameter?: number) => {
    setPrinters((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name, address, profileId, nozzleDiameter } : p)),
    );
  }, []);

  const deletePrinter = useCallback((id: string) => {
    setPrinters((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { printers, addPrinter, updatePrinter, deletePrinter };
}
