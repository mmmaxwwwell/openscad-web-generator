import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScadParam, ScadParamSet, ScadValue } from './types';
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
import { PrinterSettings } from './components/PrinterSettings';
import { Toast } from './components/Toast';
import { playDing } from './lib/notification-sound';
import { usePrinters } from './hooks/usePrinters';
import type { OutputFormat } from './lib/openscad-api';

const paramSetStorage = new BrowserParamSetStorage();

// Reserved URL param keys (not treated as SCAD parameter overrides)
const RESERVED_PARAMS = new Set(['example', 'file']);

/** Only valid OpenSCAD identifiers are accepted as parameter names from URLs */
const VALID_PARAM_NAME = /^[a-zA-Z_]\w*$/;

/** Parse a URL search param value into the correct ScadValue type based on param definition */
function parseUrlParamValue(raw: string, paramDef: ScadParam | undefined): ScadValue {
  if (!paramDef) return raw;
  switch (paramDef.type) {
    case 'number': {
      const n = Number(raw);
      return isNaN(n) ? paramDef.default : n;
    }
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'vector': {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.every((v: unknown) => typeof v === 'number')) return arr;
      } catch { /* ignore */ }
      return paramDef.default;
    }
    case 'enum':
      return paramDef.options?.includes(raw) ? raw : paramDef.default;
    default:
      return raw;
  }
}

/** Serialize a ScadValue for URL search params */
function serializeParamValue(value: ScadValue): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/** Build URLSearchParams from current state */
function buildSearchParams(
  selectedFileId: string | null,
  isExample: boolean,
  paramValues: Record<string, ScadValue>,
  paramDefaults: Record<string, ScadValue>,
): URLSearchParams {
  const params = new URLSearchParams();
  if (!selectedFileId) return params;

  if (isExample) {
    params.set('example', selectedFileId);
  } else {
    params.set('file', selectedFileId);
  }

  // Only include params that differ from defaults
  for (const [name, value] of Object.entries(paramValues)) {
    const def = paramDefaults[name];
    const serialized = serializeParamValue(value);
    if (def !== undefined && serialized === serializeParamValue(def)) continue;
    params.set(name, serialized);
  }

  return params;
}

/** Read URL params synchronously (safe to call multiple times, reads are idempotent) */
function readInitialUrlParams() {
  const search = new URLSearchParams(window.location.search);
  const exampleName = search.get('example');
  const fileName = search.get('file');

  if (!exampleName && !fileName) return null;

  const overrides: Record<string, string> = {};
  for (const [key, value] of search.entries()) {
    if (!RESERVED_PARAMS.has(key) && VALID_PARAM_NAME.test(key)) {
      overrides[key] = value;
    }
  }

  return { exampleName, fileName, overrides };
}

// Capture URL params once at module level, before any React rendering
const initialUrlParams = readInitialUrlParams();

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
  const [isExample, setIsExample] = useState(false);

  // URL param overrides to apply after file is parsed
  const pendingUrlParamsRef = useRef<Record<string, string> | null>(null);

  const handleFileSelect = useCallback(async (fileId: string) => {
    setSelectedFileId(fileId);
    setIsExample(false);
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
    setIsExample(true);
    setFileSource(content);
    setFileLoadError(null);
    setPreviewData(null);
    setPreviewFormat(null);
    openscad.clearLogs();
  }, [openscad]);

  const handleBackToFiles = useCallback(() => {
    setSelectedFileId(null);
    setIsExample(false);
    setFileSource(null);
    setFileLoadError(null);
    // Clear URL params
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // ─── Scad file parsing ─────────────────────────────────
  const parsedFile = useScadParser(fileSource);

  // ─── Parameter values (editable state) ──────────────────
  const [paramValues, setParamValues] = useState<Record<string, ScadValue>>({});

  // Reset param values to defaults when a new file is parsed, then apply any pending URL overrides
  useEffect(() => {
    if (!parsedFile) {
      setParamValues({});
      return;
    }
    const defaults: Record<string, ScadValue> = {};
    for (const p of parsedFile.params) {
      defaults[p.name] = p.default;
    }

    // Apply URL param overrides if present
    const pending = pendingUrlParamsRef.current;
    if (pending) {
      pendingUrlParamsRef.current = null;
      for (const [key, raw] of Object.entries(pending)) {
        const paramDef = parsedFile.params.find((p) => p.name === key);
        if (paramDef) {
          defaults[key] = parseUrlParamValue(raw, paramDef);
        }
      }
    }

    setParamValues(defaults);
  }, [parsedFile]);

  const handleParamChange = useCallback((name: string, value: ScadValue) => {
    setParamValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  // ─── URL sync: load from URL on initial mount ──────────
  // URL params were captured at module level (initialUrlParams) to survive StrictMode double-firing.
  const urlLoadStarted = useRef(false);

  useEffect(() => {
    if (!initialUrlParams || urlLoadStarted.current) return;
    urlLoadStarted.current = true;

    const { exampleName, fileName, overrides } = initialUrlParams;

    if (Object.keys(overrides).length > 0) {
      pendingUrlParamsRef.current = overrides;
    }

    if (exampleName) {
      const url = `${import.meta.env.BASE_URL}examples/${exampleName}`;
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to fetch ${url}`);
          return res.text();
        })
        .then((content) => {
          handleExampleLoad(exampleName, content);
        })
        .catch((err) => {
          setFileLoadError(err instanceof Error ? err.message : 'Failed to load example from URL');
        });
    } else if (fileName) {
      handleFileSelect(fileName);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── URL sync: update URL when state changes ───────────
  const paramDefaults = useMemo(() => {
    if (!parsedFile) return {};
    const defaults: Record<string, ScadValue> = {};
    for (const p of parsedFile.params) defaults[p.name] = p.default;
    return defaults;
  }, [parsedFile]);

  useEffect(() => {
    // Don't overwrite URL until the initial load has been processed
    if (initialUrlParams && !selectedFileId) return;

    const search = buildSearchParams(selectedFileId, isExample, paramValues, paramDefaults);
    const newUrl = search.toString()
      ? `${window.location.pathname}?${search.toString()}`
      : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  }, [selectedFileId, isExample, paramValues, paramDefaults]);

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

  // ─── Printer management ─────────────────────────────
  const { printers, addPrinter, updatePrinter, deletePrinter } = usePrinters();
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);

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
        <button
          className="printer-settings-btn"
          onClick={() => setShowPrinterSettings(true)}
          title="Manage Moonraker printers"
        >
          &#9881; Printers
        </button>
      </div>

      {parsedFile?.description && (
        <p className="file-description">{parsedFile.description}</p>
      )}

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
              printers={printers}
              onModelGenerated={handleModelGenerated}
              onRenderComplete={handleRenderComplete}
              onToast={setToastMessage}
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
      {showPrinterSettings && (
        <PrinterSettings
          printers={printers}
          onAdd={addPrinter}
          onUpdate={updatePrinter}
          onDelete={deletePrinter}
          onClose={() => setShowPrinterSettings(false)}
        />
      )}
      <Toast message={toastMessage} onDismiss={handleDismissToast} />
    </div>
  );
}

export default App;
