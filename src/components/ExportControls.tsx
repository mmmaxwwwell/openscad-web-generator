import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScadValue } from '../types';
import type { UseOpenSCADResult } from '../hooks/useOpenSCAD';
import type { OutputFormat } from '../lib/openscad-api';
import type { Printer } from '../hooks/usePrinters';
import { computeCacheKey, getCachedRender, setCachedRender, hasCachedRender } from '../lib/render-cache';
import { SendToPrinter } from './SendToPrinter';

interface ExportControlsProps {
  source: string;
  params: Record<string, ScadValue>;
  openscad: UseOpenSCADResult;
  fileName: string;
  printers: Printer[];
  onModelGenerated?: (data: ArrayBuffer, format: OutputFormat) => void;
  onRenderComplete?: () => void;
  onToast?: (message: string) => void;
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

export function ExportControls({ source, params, openscad, fileName, printers, onModelGenerated, onRenderComplete, onToast }: ExportControlsProps) {
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

  const getExportBlob = useCallback(async (format: ExportType): Promise<Blob | null> => {
    if (!source) return null;
    const cacheKey = await computeCacheKey(source, params, format);
    const data = await getCachedRender(cacheKey);
    if (!data) return null;
    const ext = formatExt(format);
    const mimeType = ext === '3mf' ? 'model/3mf' : 'model/stl';
    return new Blob([data], { type: mimeType });
  }, [source, params]);

  const getExportFileName = useCallback((format: ExportType): string => {
    const ext = formatExt(format);
    const suffix = formatSuffix(format);
    const baseName = fileName.replace(/\.scad$/i, '');
    return `${baseName}${suffix}.${ext}`;
  }, [fileName]);

  // Keep blobs in state for SendToPrinter (updated when cache changes)
  const [cachedBlobs, setCachedBlobs] = useState<Map<ExportType, Blob>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function updateBlobs() {
      const blobs = new Map<ExportType, Blob>();
      for (const fmt of ALL_FORMATS) {
        if (cachedFormats.has(fmt)) {
          const blob = await getExportBlob(fmt);
          if (blob) blobs.set(fmt, blob);
        }
      }
      if (!cancelled) setCachedBlobs(blobs);
    }
    updateBlobs();
    return () => { cancelled = true; };
  }, [cachedFormats, getExportBlob]);

  function renderFormatRow(format: ExportType) {
    const isCached = cachedFormats.has(format);
    const isRendering = exporting === format;
    const label = formatLabel(format);
    const blob = cachedBlobs.get(format);

    return (
      <div key={format} className="export-format-row">
        <button
          className="export-render-btn"
          onClick={() => handleRender(format)}
          disabled={isDisabled || exporting !== null}
          title={format === 'multicolor-3mf' ? 'Render with per-color separation for multi-material printing' : undefined}
        >
          {isRendering ? `Rendering ${label}…` : isCached ? `Re-render ${label}` : `Render ${label}`}
        </button>
        {isCached && !isRendering && (
          <>
            <button
              className="export-download-btn"
              onClick={() => handleDownload(format)}
              title={`Download cached ${label}`}
            >
              Download {label}
            </button>
            {blob && printers.length > 0 && (
              <SendToPrinter
                printers={printers}
                fileBlob={blob}
                fileName={getExportFileName(format)}
                onSuccess={(msg) => onToast?.(msg)}
                onError={(msg) => onToast?.(msg)}
              />
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="export-controls">
      <h3>Export</h3>
      <div className="export-format-list">
        {ALL_FORMATS.map((fmt) => renderFormatRow(fmt))}
      </div>
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
