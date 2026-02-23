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

  // ─── File selection & loading ───────────────────────────
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [fileSource, setFileSource] = useState<string | null>(null);
  const [fileLoadError, setFileLoadError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (fileId: string) => {
    setSelectedFileId(fileId);
    setFileSource(null);
    setFileLoadError(null);
    try {
      const content = await storage.loadFile(fileId);
      setFileSource(content);
    } catch (err) {
      setFileLoadError(err instanceof Error ? err.message : 'Failed to load file');
    }
  }, [storage]);

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

  // ─── OpenSCAD WASM ─────────────────────────────────────
  const openscad = useOpenSCAD();

  // ─── Render ────────────────────────────────────────────
  // File selection screen
  if (!selectedFileId || !fileSource) {
    return (
      <div className="app-container app-container--files">
        <h1>OpenSCAD Web Parameter Editor</h1>
        <FileManager
          files={storage.files}
          loading={storage.loading}
          error={storage.error}
          onFileSelect={handleFileSelect}
          onFileUpload={handleFileUpload}
          onFileDelete={handleFileDelete}
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
            />
          </div>

          {/* Right area: preview */}
          <div>
            <PreviewPanel
              source={fileSource}
              params={paramValues}
              viewpoints={parsedFile.viewpoints}
              openscad={openscad}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
