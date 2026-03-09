import { useCallback, useEffect, useState } from 'react';

export interface Printer {
  id: string;
  name: string;
  address: string;
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

  const addPrinter = useCallback((name: string, address: string) => {
    const printer: Printer = { id: crypto.randomUUID(), name, address };
    setPrinters((prev) => [...prev, printer]);
  }, []);

  const updatePrinter = useCallback((id: string, name: string, address: string) => {
    setPrinters((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name, address } : p)),
    );
  }, []);

  const deletePrinter = useCallback((id: string) => {
    setPrinters((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { printers, addPrinter, updatePrinter, deletePrinter };
}
