import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScadParamSet, ScadValue } from './types';
import type { S3Config, StorageConfig } from './lib/storage';
import { useStorage } from './hooks/useStorage';
import { useScadParser } from './hooks/useScadParser';
import { useOpenSCAD } from './hooks/useOpenSCAD';
import { BrowserParamSetStorage } from './lib/storage-browser';
import { FileManager } from './components/FileManager';
import { ParameterEditor } from './components/ParameterEditor';
import { ParameterSetSelector } from './components/ParameterSetSelector';
import { PreviewPanel } from './components/PreviewPanel';
import { ExportControls } from './components/ExportControls';
import { Toast } from './components/Toast';
import { playDing } from './lib/notification-sound';
import type { OutputFormat } from './lib/openscad-api';

const paramSetStorage = new BrowserParamSetStorage();

function App() {
  // ─── Storage configuration ──────────────────────────────
  const [storageBackend, setStorageBackend] = useState<'browser' | 's3'>('browser');
  const [s3Config, setS3Config] = useState<S3Config>({
    endpoint: '',
    bucket: '',
    region: 'us-east-1',
    accessKeyId: '',
    secretAccessKey: '',
  });
  const storageConfig = useMemo<StorageConfig>(
    () => storageBackend === 's3'
      ? { backend: 's3', s3: s3Config }
      : { backend: 'browser' },
    [storageBackend, s3Config],
  );
  const storage = useStorage(storageConfig);

  // ─── OpenSCAD WASM ─────────────────────────────────────
  const openscad = useOpenSCAD();

  // ─── 3D Preview state ─────────────────────────────────
  const [previewData, setPreviewData] = useState<ArrayBuffer | null>(null);
  const [previewFormat, setPreviewFormat] = useState<OutputFormat | null>(null);

  const handleModelGenerated = useCallback((data: ArrayBuffer, format: OutputFormat) => {
    setPreviewData(data);
    setPreviewFormat(format);
  }, []);

  // ─── File selection & loading ───────────────────────────
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [fileSource, setFileSource] = useState<string | null>(null);
  const [fileLoadError, setFileLoadError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (fileId: string) => {
    setSelectedFileId(fileId);
    setFileSource(null);
    setFileLoadError(null);
    setPreviewData(null);
    setPreviewFormat(null);
    openscad.clearLogs();
    try {
      const content = await storage.loadFile(fileId);
      setFileSource(content);
    } catch (err) {
      setFileLoadError(err instanceof Error ? err.message : 'Failed to load file');
    }
  }, [storage, openscad]);

  const handleFileUpload = useCallback(async (name: string, content: string) => {
    await storage.saveFile(name, content);
  }, [storage]);

  const handleFileDelete = useCallback(async (fileId: string) => {
    await storage.deleteFile(fileId);
    if (selectedFileId === fileId) {
      setSelectedFileId(null);
      setFileSource(null);
    }
  }, [storage, selectedFileId]);

  const handleExampleLoad = useCallback((name: string, content: string) => {
    setSelectedFileId(name);
    setFileSource(content);
    setFileLoadError(null);
    setPreviewData(null);
    setPreviewFormat(null);
    openscad.clearLogs();
  }, [openscad]);

  const handleBackToFiles = useCallback(() => {
    setSelectedFileId(null);
    setFileSource(null);
    setFileLoadError(null);
  }, []);

  // ─── Scad file parsing ─────────────────────────────────
  const parsedFile = useScadParser(fileSource);

  // ─── Parameter values (editable state) ──────────────────
  const [paramValues, setParamValues] = useState<Record<string, ScadValue>>({});

  // Reset param values to defaults when a new file is parsed
  useEffect(() => {
    if (!parsedFile) {
      setParamValues({});
      return;
    }
    const defaults: Record<string, ScadValue> = {};
    for (const p of parsedFile.params) {
      defaults[p.name] = p.default;
    }
    setParamValues(defaults);
  }, [parsedFile]);

  const handleParamChange = useCallback((name: string, value: ScadValue) => {
    setParamValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  // ─── Parameter set application ─────────────────────────
  const handleApplyParamSet = useCallback((values: Record<string, ScadValue>) => {
    setParamValues((prev) => ({ ...prev, ...values }));
  }, []);

  // ─── Custom parameter sets (IndexedDB) ─────────────────
  const [customSets, setCustomSets] = useState<ScadParamSet[]>([]);

  // Load custom sets when file changes
  useEffect(() => {
    if (!selectedFileId) {
      setCustomSets([]);
      return;
    }
    paramSetStorage.listSets(selectedFileId).then((sets) => {
      setCustomSets(sets.map((s) => ({ name: s.name, values: s.values })));
    });
  }, [selectedFileId]);

  const handleSaveCustomSet = useCallback(async (name: string) => {
    if (!selectedFileId) return;
    await paramSetStorage.saveSet(selectedFileId, name, { ...paramValues });
    const sets = await paramSetStorage.listSets(selectedFileId);
    setCustomSets(sets.map((s) => ({ name: s.name, values: s.values })));
  }, [selectedFileId, paramValues]);

  const handleDeleteCustomSet = useCallback(async (name: string) => {
    if (!selectedFileId) return;
    await paramSetStorage.deleteSet(selectedFileId, name);
    const sets = await paramSetStorage.listSets(selectedFileId);
    setCustomSets(sets.map((s) => ({ name: s.name, values: s.values })));
  }, [selectedFileId]);

  // ─── Toast / notification ─────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleRenderComplete = useCallback(() => {
    setToastMessage('Render complete — download ready!');
    playDing();
  }, []);

  const handleDismissToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  // ─── GitHub corner ─────────────────────────────────────
  const githubCorner = (
    <a href="https://github.com/mmmaxwwwell/openscad-web-generator" className="github-corner" aria-label="View source on GitHub">
      <svg width="80" height="80" viewBox="0 0 250 250" style={{ fill: '#151513', color: '#fff', position: 'absolute', top: 0, border: 0, right: 0, zIndex: 1000 }} aria-hidden="true">
        <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z" />
        <path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style={{ transformOrigin: '130px 106px' }} className="octo-arm" />
        <path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" className="octo-body" />
      </svg>
    </a>
  );

  // ─── Render ────────────────────────────────────────────
  // File selection screen
  if (!selectedFileId || !fileSource) {
    return (
      <div className="app-container app-container--files">
        {githubCorner}
        <h1>OpenSCAD Web Parameter Editor</h1>
        <FileManager
          files={storage.files}
          loading={storage.loading}
          error={storage.error}
          onFileSelect={handleFileSelect}
          onFileUpload={handleFileUpload}
          onFileDelete={handleFileDelete}
          onExampleLoad={handleExampleLoad}
          onRefresh={storage.refresh}
          selectedFileId={selectedFileId}
          storageBackend={storageBackend}
          onStorageBackendChange={setStorageBackend}
        />
        {storageBackend === 's3' && (
          <div className="s3-config">
            <h3>S3 Configuration</h3>
            <div className="s3-config-fields">
              <label>
                Endpoint
                <input
                  type="text"
                  placeholder="https://s3.amazonaws.com"
                  value={s3Config.endpoint}
                  onChange={(e) => setS3Config((prev) => ({ ...prev, endpoint: e.target.value }))}
                />
              </label>
              <label>
                Bucket
                <input
                  type="text"
                  placeholder="my-scad-files"
                  value={s3Config.bucket}
                  onChange={(e) => setS3Config((prev) => ({ ...prev, bucket: e.target.value }))}
                />
              </label>
              <label>
                Region
                <input
                  type="text"
                  placeholder="us-east-1"
                  value={s3Config.region}
                  onChange={(e) => setS3Config((prev) => ({ ...prev, region: e.target.value }))}
                />
              </label>
              <label>
                Access Key ID
                <input
                  type="text"
                  value={s3Config.accessKeyId}
                  onChange={(e) => setS3Config((prev) => ({ ...prev, accessKeyId: e.target.value }))}
                />
              </label>
              <label>
                Secret Access Key
                <input
                  type="password"
                  value={s3Config.secretAccessKey}
                  onChange={(e) => setS3Config((prev) => ({ ...prev, secretAccessKey: e.target.value }))}
                />
              </label>
            </div>
          </div>
        )}
        {fileLoadError && (
          <div className="file-load-error">{fileLoadError}</div>
        )}
      </div>
    );
  }

  // Editor screen (file loaded & parsed)
  return (
    <div className="app-container">
      {githubCorner}
      <div className="editor-header">
        <button onClick={handleBackToFiles}>&larr; Back to Files</button>
        <h1 className="editor-title">{selectedFileId}</h1>
        <span className={`wasm-status wasm-status--${openscad.status}`}>
          {openscad.status === 'idle' && 'WASM: Not loaded'}
          {openscad.status === 'loading' && 'WASM: Loading…'}
          {openscad.status === 'ready' && 'WASM: Ready'}
          {openscad.status === 'rendering' && 'WASM: Rendering…'}
          {openscad.status === 'error' && 'WASM: Error'}
        </span>
      </div>

      {!parsedFile ? (
        <div>Parsing file...</div>
      ) : (
        <div className="editor-layout">
          {/* Left sidebar: parameters + sets + export */}
          <div>
            <ParameterEditor
              params={parsedFile.params}
              values={paramValues}
              onChange={handleParamChange}
            />
            <ParameterSetSelector
              defaultSets={parsedFile.paramSets}
              customSets={customSets}
              onApply={handleApplyParamSet}
              onSave={handleSaveCustomSet}
              onDelete={handleDeleteCustomSet}
            />
            <ExportControls
              source={fileSource}
              params={paramValues}
              openscad={openscad}
              fileName={selectedFileId}
              onModelGenerated={handleModelGenerated}
              onRenderComplete={handleRenderComplete}
            />
          </div>

          {/* Right area: 3D preview */}
          <div>
            <PreviewPanel
              modelData={previewData}
              modelFormat={previewFormat}
            />
          </div>
        </div>
      )}
      <Toast message={toastMessage} onDismiss={handleDismissToast} />
    </div>
  );
}

export default App;
