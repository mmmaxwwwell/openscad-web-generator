import { useCallback, useState } from 'react';
import type { ScadValue } from '../types';
import type { UseOpenSCADResult } from '../hooks/useOpenSCAD';
import type { OutputFormat } from '../lib/openscad-api';

interface ExportControlsProps {
  source: string;
  params: Record<string, ScadValue>;
  openscad: UseOpenSCADResult;
  fileName: string;
}

export function ExportControls({ source, params, openscad, fileName }: ExportControlsProps) {
  const [exporting, setExporting] = useState<OutputFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<string[]>([]);

  const handleExport = useCallback(async (format: OutputFormat) => {
    if (!source) return;

    setExporting(format);
    setError(null);
    setErrorLogs([]);
    try {
      const data = await openscad.render(source, params, format);
      const ext = format === '3mf' ? '3mf' : 'stl';
      const mimeType = format === '3mf' ? 'model/3mf' : 'model/stl';
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const baseName = fileName.replace(/\.scad$/i, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Export failed');
      if (err.logs) setErrorLogs(err.logs);
    } finally {
      setExporting(null);
    }
  }, [source, params, openscad, fileName]);

  const isDisabled = !source || openscad.status === 'rendering' || openscad.status === 'loading';

  return (
    <div className="export-controls">
      <h3>Export</h3>
      <div className="export-buttons">
        <button
          onClick={() => handleExport('stl')}
          disabled={isDisabled || exporting !== null}
        >
          {exporting === 'stl' ? 'Exporting STL…' : 'Export STL'}
        </button>
        <button
          onClick={() => handleExport('3mf')}
          disabled={isDisabled || exporting !== null}
        >
          {exporting === '3mf' ? 'Exporting 3MF…' : 'Export 3MF'}
        </button>
      </div>
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
