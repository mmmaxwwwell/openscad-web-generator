import { useMemo } from 'react';
import { parseScadFile } from '../lib/scad-parser';
import type { ScadFile } from '../types';

/**
 * React hook that parses a loaded .scad file source string
 * and returns structured data (params, param sets, viewpoints).
 *
 * Returns null if source is empty/null.
 * Memoizes the parse result so it only re-parses when source changes.
 */
export function useScadParser(source: string | null): ScadFile | null {
  return useMemo(() => {
    if (!source) return null;
    return parseScadFile(source);
  }, [source]);
}
