import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScadValue } from '../types';
import type { UseOpenSCADResult } from '../hooks/useOpenSCAD';
import type { OutputFormat } from '../lib/openscad-api';
import { computeCacheKey, getCachedRender, setCachedRender, hasCachedRender } from '../lib/render-cache';

interface ExportControlsProps {
  source: string;
  params: Record<string, ScadValue>;
  openscad: UseOpenSCADResult;
  fileName: string;
  onModelGenerated?: (data: ArrayBuffer, format: OutputFormat) => void;
  onRenderComplete?: () => void;
}

type ExportType = OutputFormat | 'multicolor-3mf';

const ALL_FORMATS: ExportType[] = ['stl', '3mf', 'multicolor-3mf'];

export function ExportControls({ source, params, openscad, fileName, onModelGenerated, onRenderComplete }: ExportControlsProps) {
  const [exporting, setExporting] = useState<ExportType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  // Last successful render result
  const [lastRenderData, setLastRenderData] = useState<ArrayBuffer | null>(null);
  const [lastRenderFormat, setLastRenderFormat] = useState<ExportType | null>(null);

  // Which formats have cache hits for current source+params
  const [cachedFormats, setCachedFormats] = useState<Set<ExportType>>(new Set());

  // Clear render data when params or source change
  useEffect(() => {
    setLastRenderData(null);
    setLastRenderFormat(null);
  }, [source, params]);

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
      setLastRenderData(data);
      setLastRenderFormat(format);
      setCachedFormats((prev) => new Set(prev).add(format));
      onRenderComplete?.();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Render failed');
      if (err.logs) setErrorLogs(err.logs);
    } finally {
      setExporting(null);
    }
  }, [source, params, openscad, onModelGenerated, onRenderComplete]);

  const handleDownload = useCallback(() => {
    if (!lastRenderData || !lastRenderFormat) return;

    const is3mf = lastRenderFormat === '3mf' || lastRenderFormat === 'multicolor-3mf';
    const ext = is3mf ? '3mf' : 'stl';
    const mimeType = is3mf ? 'model/3mf' : 'model/stl';
    const suffix = lastRenderFormat === 'multicolor-3mf' ? '-multicolor' : '';

    const blob = new Blob([lastRenderData], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const baseName = fileName.replace(/\.scad$/i, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [lastRenderData, lastRenderFormat, fileName]);

  const isDisabled = !source || openscad.status === 'rendering' || openscad.status === 'loading';

  function renderButton(format: ExportType, label: string) {
    const isCached = cachedFormats.has(format);
    const isRendering = exporting === format;
    return (
      <button
        onClick={() => handleRender(format)}
        disabled={isDisabled || exporting !== null}
        title={format === 'multicolor-3mf' ? 'Render with per-color separation for multi-material printing' : undefined}
      >
        {isRendering ? `Rendering ${label}…` : `Render ${label}`}
        {isCached && !isRendering && <span className="export-cache-badge">cached</span>}
      </button>
    );
  }

  return (
    <div className="export-controls">
      <h3>Export</h3>
      <div className="export-buttons">
        {renderButton('stl', 'STL')}
        {renderButton('3mf', '3MF')}
        {renderButton('multicolor-3mf', 'Multi-Color 3MF')}
      </div>
      {lastRenderData && (
        <div className="export-download">
          <button className="export-download-btn" onClick={handleDownload}>
            Download {lastRenderFormat === 'multicolor-3mf' ? 'Multi-Color 3MF' : lastRenderFormat?.toUpperCase()}
          </button>
        </div>
      )}
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
