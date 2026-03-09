import { useCallback, useRef, useState } from 'react';
import type { FileInfo } from '../types';

interface ExampleFile {
  name: string;
  path: string;
}

const BUNDLED_EXAMPLES: ExampleFile[] = [
  { name: 'Big Chapstick (BOSL2)', path: '/examples/big_chapstick.scad' },
  { name: 'CSG Operations', path: '/examples/CSG.scad' },
  { name: 'OpenSCAD Logo', path: '/examples/logo.scad' },
  { name: 'Linear Extrude', path: '/examples/linear_extrude.scad' },
  { name: 'Rotate Extrude', path: '/examples/rotate_extrude.scad' },
  { name: 'Hull Sailboat', path: '/examples/hull_sailboat.scad' },
  { name: 'Parametric Sign', path: '/examples/sign.scad' },
  { name: 'Candle Stand', path: '/examples/candleStand.scad' },
  { name: 'Fi Mini Case (BOSL2 + QR)', path: '/examples/fi_mini_case.scad' },
];

interface FileManagerProps {
  files: FileInfo[];
  loading: boolean;
  error: string | null;
  onFileSelect: (fileId: string) => void;
  onFileUpload: (name: string, content: string) => Promise<void>;
  onFileDelete: (fileId: string) => Promise<void>;
  onExampleLoad: (name: string, content: string) => void;
  onRefresh: () => Promise<void>;
  selectedFileId: string | null;
  storageBackend: 'browser' | 's3';
  onStorageBackendChange: (backend: 'browser' | 's3') => void;
}

export function FileManager({
  files,
  loading,
  error,
  onFileSelect,
  onFileUpload,
  onFileDelete,
  onExampleLoad,
  onRefresh,
  selectedFileId,
  storageBackend,
  onStorageBackendChange,
}: FileManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const content = await file.text();
      await onFileUpload(file.name, content);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [onFileUpload]);

  const [loadingExample, setLoadingExample] = useState<string | null>(null);

  const handleLoadExample = useCallback(async (example: ExampleFile) => {
    setLoadingExample(example.name);
    try {
      const url = `${import.meta.env.BASE_URL}${example.path.replace(/^\//, '')}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}`);
      const content = await res.text();
      const fileName = example.path.split('/').pop()!;
      onExampleLoad(fileName, content);
    } finally {
      setLoadingExample(null);
    }
  }, [onExampleLoad]);

  const handleDelete = useCallback(async (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    if (confirm(`Delete "${fileId}"?`)) {
      await onFileDelete(fileId);
    }
  }, [onFileDelete]);

  return (
    <div className="file-manager">
      <div className="file-manager-header">
        <h2>Files</h2>
        <div className="file-manager-controls">
          <select
            value={storageBackend}
            onChange={(e) => onStorageBackendChange(e.target.value as 'browser' | 's3')}
          >
            <option value="browser">Browser Storage</option>
            <option value="s3">S3 Storage</option>
          </select>
          <button onClick={onRefresh} disabled={loading} title="Refresh file list">
            Refresh
          </button>
          <button onClick={handleUploadClick} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload .scad'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".scad"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      {error && <div className="file-manager-error">{error}</div>}

      {loading ? (
        <div className="file-manager-loading">Loading files…</div>
      ) : files.length === 0 ? (
        <div className="file-manager-empty">
          No .scad files found. Upload one to get started.
        </div>
      ) : (
        <ul className="file-list">
          {files.map((file) => (
            <li
              key={file.id}
              className={`file-list-item ${file.id === selectedFileId ? 'selected' : ''}`}
              onClick={() => onFileSelect(file.id)}
            >
              <span className="file-name">{file.name}</span>
              <span className="file-meta">
                {file.lastModified.toLocaleDateString()}
                {file.size != null && ` · ${(file.size / 1024).toFixed(1)} KB`}
              </span>
              <button
                className="file-delete-btn"
                onClick={(e) => handleDelete(e, file.id)}
                title="Delete file"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="example-files">
        <h3>Examples</h3>
        <ul className="file-list">
          {BUNDLED_EXAMPLES.map((example) => (
            <li key={example.path} className="file-list-item">
              <span className="file-name">{example.name}</span>
              <button
                className="example-load-btn"
                onClick={() => handleLoadExample(example)}
                disabled={loadingExample === example.name}
              >
                {loadingExample === example.name ? 'Loading…' : 'Load'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
