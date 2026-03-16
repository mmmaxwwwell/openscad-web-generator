// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Web worker for parsing GCode in a background thread.
 *
 * Messages IN:
 *   { type: 'parse', gcode: string }  — start parsing
 *   { type: 'cancel' }               — cancel current parse
 *
 * Messages OUT:
 *   { type: 'progress', progress: number }           — 0..1 parse progress
 *   { type: 'done', result: ParsedGCode }            — parsing complete
 *   { type: 'error', error: string }                 — parsing failed
 *   { type: 'cancelled' }                            — parsing was cancelled
 */

import { parseGCode, type ParsedGCode } from '../lib/gcode-parser';

let abortController: AbortController | null = null;

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'cancel') {
    abortController?.abort();
    return;
  }

  if (msg.type === 'parse') {
    // Cancel any in-progress parse
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    try {
      const result: ParsedGCode = parseGCode(
        msg.gcode,
        (progress) => {
          if (!signal.aborted) {
            self.postMessage({ type: 'progress', progress });
          }
        },
        signal,
      );
      if (!signal.aborted) {
        // Debug: log parse stats
        const typeCounts: Record<string, number> = {};
        let g2g3 = 0;
        for (const layer of result.layers) {
          for (const seg of layer.segments) {
            typeCounts[seg.type] = (typeCounts[seg.type] || 0) + 1;
          }
        }
        // Count G2/G3 in raw gcode
        const lines = msg.gcode.split('\n');
        for (const l of lines) {
          const cmd = l.trim().split(/\s+/)[0]?.toUpperCase();
          if (cmd === 'G2' || cmd === 'G3') g2g3++;
        }
        const totalGcodeLines = lines.length;
        const g0g1 = lines.filter((l: string) => {
          const c = l.trim().split(/\s+/)[0]?.toUpperCase();
          return c === 'G0' || c === 'G1';
        }).length;
        console.log('[GCode Parser]', {
          totalGcodeLines,
          g0g1,
          g2g3,
          layers: result.layers.length,
          totalSegments: result.totalSegments,
          typeCounts,
          bounds: result.bounds,
        });
        self.postMessage({ type: 'done', result });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        self.postMessage({ type: 'cancelled' });
      } else {
        self.postMessage({ type: 'error', error: String(err) });
      }
    } finally {
      abortController = null;
    }
  }
};
