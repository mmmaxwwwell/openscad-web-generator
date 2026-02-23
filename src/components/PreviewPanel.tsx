import { useCallback, useEffect, useState } from 'react';
import type { ScadValue, ScadViewpoint } from '../types';
import type { UseOpenSCADResult } from '../hooks/useOpenSCAD';

interface PreviewImage {
  viewpoint: ScadViewpoint;
  dataUrl: string | null;
  loading: boolean;
  error: string | null;
}

interface PreviewPanelProps {
  source: string;
  params: Record<string, ScadValue>;
  viewpoints: ScadViewpoint[];
  openscad: UseOpenSCADResult;
}

export function PreviewPanel({ source, params, viewpoints, openscad }: PreviewPanelProps) {
  const [previews, setPreviews] = useState<PreviewImage[]>([]);

  const generatePreviews = useCallback(async () => {
    if (!source || viewpoints.length === 0) {
      setPreviews([]);
      return;
    }

    // Initialize all previews as loading
    const initial: PreviewImage[] = viewpoints.map((vp) => ({
      viewpoint: vp,
      dataUrl: null,
      loading: true,
      error: null,
    }));
    setPreviews(initial);

    // Generate each preview sequentially to avoid overloading the worker
    for (let i = 0; i < viewpoints.length; i++) {
      try {
        const pngData = await openscad.preview(source, params, viewpoints[i]);
        const blob = new Blob([pngData], { type: 'image/png' });
        const dataUrl = URL.createObjectURL(blob);
        setPreviews((prev) => {
          const updated = [...prev];
          updated[i] = { ...updated[i], dataUrl, loading: false };
          return updated;
        });
      } catch (err) {
        setPreviews((prev) => {
          const updated = [...prev];
          updated[i] = {
            ...updated[i],
            loading: false,
            error: err instanceof Error ? err.message : 'Preview failed',
          };
          return updated;
        });
      }
    }
  }, [source, params, viewpoints, openscad]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      previews.forEach((p) => {
        if (p.dataUrl) URL.revokeObjectURL(p.dataUrl);
      });
    };
  }, [previews]);

  if (viewpoints.length === 0) {
    return (
      <div className="preview-panel">
        <h3>Preview</h3>
        <div className="preview-empty">No viewpoints defined in this file.</div>
      </div>
    );
  }

  return (
    <div className="preview-panel">
      <div className="preview-header">
        <h3>Preview</h3>
        <button
          onClick={generatePreviews}
          disabled={openscad.status === 'rendering' || openscad.status === 'loading'}
        >
          {openscad.status === 'rendering' ? 'Rendering…' : 'Generate Previews'}
        </button>
      </div>

      {openscad.error && <div className="preview-error">{openscad.error}</div>}

      <div className="preview-grid">
        {previews.length === 0 ? (
          <div className="preview-placeholder">
            Click "Generate Previews" to render viewpoints.
          </div>
        ) : (
          previews.map((preview, i) => (
            <div key={i} className="preview-item">
              <div className="preview-label">
                {preview.viewpoint.label || `Viewpoint ${i + 1}`}
              </div>
              {preview.loading ? (
                <div className="preview-loading">Rendering…</div>
              ) : preview.error ? (
                <div className="preview-item-error">{preview.error}</div>
              ) : (
                <img
                  src={preview.dataUrl!}
                  alt={preview.viewpoint.label || `Viewpoint ${i + 1}`}
                  className="preview-image"
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
