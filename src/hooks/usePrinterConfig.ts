/**
 * React hook for fetching and caching printer configuration from Moonraker.
 *
 * Caches PrinterConfig in localStorage per printer address.
 * Serves from cache if fresh (< CACHE_TTL_MS), otherwise re-fetches.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrinterConfig } from '../lib/moonraker-api';
import { fetchPrinterConfig } from '../lib/moonraker-api';

const STORAGE_KEY = 'moonraker-printer-configs';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  config: PrinterConfig;
  fetchedAt: number;
}

type CacheStore = Record<string, CacheEntry>;

function loadCache(): CacheStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveCache(cache: CacheStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

function getCachedConfig(address: string): PrinterConfig | null {
  const cache = loadCache();
  const entry = cache[address];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return entry.config;
}

function setCachedConfig(address: string, config: PrinterConfig): void {
  const cache = loadCache();
  cache[address] = { config, fetchedAt: Date.now() };
  saveCache(cache);
}

export function removeCachedConfig(address: string): void {
  const cache = loadCache();
  delete cache[address];
  saveCache(cache);
}

export interface UsePrinterConfigResult {
  config: PrinterConfig | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch config from Moonraker, bypassing cache */
  refresh: () => void;
}

/**
 * Fetch and cache printer config for the given address.
 * Pass null/undefined/empty string to skip fetching.
 */
export function usePrinterConfig(address: string | null | undefined): UsePrinterConfigResult {
  const [config, setConfig] = useState<PrinterConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const skipCacheRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!address) {
      setConfig(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Check cache first (unless this was a manual refresh)
    if (!skipCacheRef.current) {
      const cached = getCachedConfig(address);
      if (cached) {
        setConfig(cached);
        setError(null);
        setLoading(false);
        return;
      }
    }
    skipCacheRef.current = false;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchPrinterConfig(address)
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        setCachedConfig(address, result);
        setConfig(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [address, fetchTrigger]);

  const refresh = useCallback(() => {
    if (address) {
      removeCachedConfig(address);
    }
    skipCacheRef.current = true;
    setFetchTrigger((n) => n + 1);
  }, [address]);

  return { config, loading, error, refresh };
}
