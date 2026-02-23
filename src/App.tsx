import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScadParamSet, ScadValue } from './types';
import type { StorageConfig } from './lib/storage';
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
  const storageConfig = useMemo<StorageConfig>(
    () => ({ backend: storageBackend } as StorageConfig),
    [storageBackend],
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
      <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
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
        {fileLoadError && (
          <div style={{ color: 'red', marginTop: '1rem' }}>{fileLoadError}</div>
        )}
      </div>
    );
  }

  // Editor screen (file loaded & parsed)
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <button onClick={handleBackToFiles}>&larr; Back to Files</button>
        <h1 style={{ margin: 0 }}>{selectedFileId}</h1>
      </div>

      {!parsedFile ? (
        <div>Parsing file...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '2rem' }}>
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
