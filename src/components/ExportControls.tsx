import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScadValue } from '../types';
import type { UseOpenSCADResult } from '../hooks/useOpenSCAD';
import type { OutputFormat } from '../lib/openscad-api';
import type { Printer } from '../hooks/usePrinters';
import type { ColorGroup } from '../lib/merge-3mf';
import { extractColorGroups } from '../lib/merge-3mf';
import { computeCacheKey, getCachedRender, setCachedRender, hasCachedRender } from '../lib/render-cache';
import { SendToPrinterButton } from './SendToPrinterButton';

interface ExportControlsProps {
  source: string;
  params: Record<string, ScadValue>;
  openscad: UseOpenSCADResult;
  fileName: string;
  printers: Printer[];
  onModelGenerated?: (data: ArrayBuffer, format: OutputFormat) => void;
  onRenderComplete?: () => void;
  onToast?: (message: string) => void;
  onSendToPrinter?: (printer: Printer, stlData: ArrayBuffer, fileName: string, colorGroups?: ColorGroup[], threeMfData?: ArrayBuffer) => void;
}

type ExportType = OutputFormat | 'multicolor-3mf';

const ALL_FORMATS: ExportType[] = ['stl', '3mf', 'multicolor-3mf'];

function formatLabel(format: ExportType): string {
  switch (format) {
    case 'stl': return 'STL';
    case '3mf': return '3MF';
    case 'multicolor-3mf': return 'Multi-Color 3MF';
  }
}

function formatExt(format: ExportType): string {
  return format === 'stl' ? 'stl' : '3mf';
}

function formatSuffix(format: ExportType): string {
  return format === 'multicolor-3mf' ? '-multicolor' : '';
}

export function ExportControls({ source, params, openscad, fileName, printers, onModelGenerated, onRenderComplete, onToast, onSendToPrinter }: ExportControlsProps) {
  const [exporting, setExporting] = useState<ExportType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  // Which formats have cache hits for current source+params
  const [cachedFormats, setCachedFormats] = useState<Set<ExportType>>(new Set());

  // Check cache for all formats when source/params change
  useEffect(() => {
    if (!source) return;
    let cancelled = false;

    async function checkAll() {
      const hits = new Set<ExportType>();
      await Promise.all(
        ALL_FORMATS.map(async (fmt) => {
          const key = await computeCacheKey(source, params, fmt);
          if (await hasCachedRender(key)) hits.add(fmt);
        }),
      );
      if (!cancelled) setCachedFormats(hits);
    }

    checkAll();
    return () => { cancelled = true; };
  }, [source, params]);

  // Auto-scroll log panel
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [openscad.logs]);

  const handleRender = useCallback(async (format: ExportType) => {
    if (!source) return;

    setExporting(format);
    setError(null);
    setErrorLogs([]);
    try {
      // Check cache first
      const cacheKey = await computeCacheKey(source, params, format);
      const cached = await getCachedRender(cacheKey);

      let data: ArrayBuffer;
      if (cached) {
        data = cached;
      } else if (format === 'multicolor-3mf') {
        data = await openscad.renderMulticolor(source, params);
        await setCachedRender(cacheKey, data, format);
      } else {
        data = await openscad.render(source, params, format);
        await setCachedRender(cacheKey, data, format);
      }

      const previewFormat: OutputFormat = format === 'multicolor-3mf' ? '3mf' : format;
      onModelGenerated?.(data, previewFormat);
      setCachedFormats((prev) => new Set(prev).add(format));
      onRenderComplete?.();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Render failed');
      if (err.logs) setErrorLogs(err.logs);
    } finally {
      setExporting(null);
    }
  }, [source, params, openscad, onModelGenerated, onRenderComplete]);

  const handleDownload = useCallback(async (format: ExportType) => {
    if (!source) return;

    const cacheKey = await computeCacheKey(source, params, format);
    const data = await getCachedRender(cacheKey);
    if (!data) return;

    const ext = formatExt(format);
    const suffix = formatSuffix(format);
    const mimeType = ext === '3mf' ? 'model/3mf' : 'model/stl';

    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const baseName = fileName.replace(/\.scad$/i, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [source, params, fileName]);

  const isDisabled = !source || openscad.status === 'rendering' || openscad.status === 'loading';

  // Send to printer for a specific format — fetches cached data and opens the print dialog
  const handleSendForFormat = useCallback(async (format: ExportType, printer: Printer) => {
    if (!onSendToPrinter || !source) return;

    // For STL: send STL data directly, check if multicolor 3MF is also available
    // For 3MF: send the 3MF as STL fallback (slicer needs STL)
    // For multicolor-3mf: send with color groups for multi-material slicing

    // Always need STL data for slicing
    const stlCacheKey = await computeCacheKey(source, params, 'stl');
    let stlData = await getCachedRender(stlCacheKey);

    if (format === 'stl') {
      if (!stlData) {
        onToast?.('Render STL first before sending to printer');
        return;
      }
      // Check if multicolor 3MF is also cached for color info
      let colorGroups: ColorGroup[] | undefined;
      const multicolorKey = await computeCacheKey(source, params, 'multicolor-3mf');
      const multicolorData = await getCachedRender(multicolorKey);
      if (multicolorData) {
        const groups = extractColorGroups(multicolorData);
        if (groups.length > 1) colorGroups = groups;
      }
      const baseName = fileName.replace(/\.scad$/i, '');
      onSendToPrinter(printer, stlData, `${baseName}.stl`, colorGroups, colorGroups ? multicolorData! : undefined);
    } else if (format === '3mf') {
      // For plain 3MF, we still need STL for the slicer
      if (!stlData) {
        onToast?.('Render STL first — the slicer needs STL data');
        return;
      }
      const baseName = fileName.replace(/\.scad$/i, '');
      onSendToPrinter(printer, stlData, `${baseName}.stl`);
    } else if (format === 'multicolor-3mf') {
      // Multicolor: need STL + multicolor 3MF for color groups
      if (!stlData) {
        onToast?.('Render STL first — the slicer needs STL data');
        return;
      }
      const multicolorKey = await computeCacheKey(source, params, 'multicolor-3mf');
      const multicolorData = await getCachedRender(multicolorKey);
      if (!multicolorData) {
        onToast?.('Render Multi-Color 3MF first');
        return;
      }
      let colorGroups: ColorGroup[] | undefined;
      const groups = extractColorGroups(multicolorData);
      if (groups.length > 1) colorGroups = groups;
      const baseName = fileName.replace(/\.scad$/i, '');
      onSendToPrinter(printer, stlData, `${baseName}.stl`, colorGroups, multicolorData);
    }
  }, [onSendToPrinter, source, params, fileName, onToast]);

  const hasPrinters = printers.length > 0 && onSendToPrinter;

  function renderFormatSection(format: ExportType) {
    const isCached = cachedFormats.has(format);
    const isRendering = exporting === format;
    const label = formatLabel(format);

    return (
      <div key={format} className="export-section">
        <h4 className="export-section-title">{label}</h4>
        <div className="export-section-actions">
          <button
            className="export-render-btn"
            onClick={() => handleRender(format)}
            disabled={isDisabled || exporting !== null}
            title={format === 'multicolor-3mf' ? 'Render with per-color separation for multi-material printing' : undefined}
          >
            {isRendering ? `Rendering…` : isCached ? `Re-render` : `Render`}
          </button>
          {isCached && !isRendering && (
            <button
              className="export-download-btn"
              onClick={() => handleDownload(format)}
              title={`Download cached ${label}`}
            >
              Download
            </button>
          )}
          {isCached && !isRendering && hasPrinters && (
            <SendToPrinterButton
              printers={printers}
              onSelectPrinter={(printer) => handleSendForFormat(format, printer)}
              label="Send to Printer"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="export-controls">
      <h3>Export</h3>
      {ALL_FORMATS.map((fmt) => renderFormatSection(fmt))}
      {openscad.logs.length > 0 && (
        <pre className="openscad-logs" ref={logRef}>{openscad.logs.join('\n')}</pre>
      )}
      {error && (
        <div className="export-error">
          <div>{error}</div>
          {errorLogs.length > 0 && (
            <pre className="openscad-logs">{errorLogs.join('\n')}</pre>
          )}
        </div>
      )}
    </div>
  );
}
