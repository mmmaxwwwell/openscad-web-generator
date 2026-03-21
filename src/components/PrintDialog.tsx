// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Printer } from '../hooks/usePrinters';
import type { FilamentProfile } from '../hooks/useFilaments';
import { useExtruderFilaments } from '../hooks/useExtruderFilaments';
import { usePrinterFilamentOverrides, type PrinterFilamentOverride } from '../hooks/usePrinterFilamentOverrides';
import { startPrint, type PrinterConfig } from '../lib/moonraker-api';
import type { SliceProgress, SliceResult } from '../hooks/useSlicer';
import type { ColorGroup } from '../lib/merge-3mf';
import type { PrintProfile } from '../types/print-profile';
import { DEFAULT_PRINT_PROFILE } from '../types/print-profile';
import { getPrinterProfile, getNozzleProfile } from '../data/printer-profiles';
import { buildOrcaConfig, type PrinterSettings } from '../lib/orca-slicer-settings';
import type { PrinterStructureType, NozzleType } from '../lib/slicer-settings';
import type { ScadSlicerSettings } from '../lib/scad-parser';
import type { ParsedGCode } from '../lib/gcode-parser';
import { GCodePreview } from './GCodePreview';
import {
  QualityTab,
  WallsTab,
  InfillTab,
  SpeedTab,
  SupportTab,
  AdhesionTab,
  CoolingTab,
  RetractionTab,
  AdvancedTab,
} from './print-settings';

// Re-export for any external consumers
export type { PrintProfile } from '../types/print-profile';


const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  bedWidth: 235,
  bedDepth: 235,
  maxHeight: 300,
  originCenter: false,
  startGcode: 'START_PRINT BED_TEMP={bed_temp} EXTRUDER_TEMP={temp}',
  endGcode: 'END_PRINT',
  toolChangeGcode: 'T{tool}',
  printableArea: [],
  bedExcludeAreas: [],
  printerStructureType: 'cartesian',
  nozzleType: 'brass',
  nozzleHRC: 0,
  auxiliaryFan: false,
  chamberTempControl: false,
  maxVolumetricSpeed: 0,
};

/** Build PrinterSettings from a printer profile, falling back to generic defaults */
function printerSettingsFromProfile(profileId?: string): PrinterSettings {
  if (!profileId) return DEFAULT_PRINTER_SETTINGS;
  const profile = getPrinterProfile(profileId);
  if (!profile) return DEFAULT_PRINTER_SETTINGS;
  return {
    ...DEFAULT_PRINTER_SETTINGS,
    bedWidth: profile.bedWidth,
    bedDepth: profile.bedDepth,
    maxHeight: profile.maxHeight,
    originCenter: profile.originCenter,
    startGcode: profile.startGcode,
    endGcode: profile.endGcode,
  };
}

/** Build PrintProfile defaults from a printer profile */
function printProfileFromProfile(profileId?: string, nozzleDiameter?: number): PrintProfile {
  if (!profileId) return DEFAULT_PRINT_PROFILE;
  const profile = getPrinterProfile(profileId);
  if (!profile) return DEFAULT_PRINT_PROFILE;
  const pd = profile.printDefaults;
  const nozzle = getNozzleProfile(profile, nozzleDiameter ?? profile.defaultNozzle);
  return {
    ...DEFAULT_PRINT_PROFILE,
    layerHeight: pd.layerHeight,
    initialLayerPrintHeight: pd.initialLayerPrintHeight,
    lineWidth: pd.lineWidth,
    wallLoops: pd.wallLoops,
    topLayers: pd.topLayers,
    bottomLayers: pd.bottomLayers,
    wallSequence: pd.wallSequence,
    sparseInfillDensity: pd.sparseInfillDensity,
    infillAngle: pd.infillAngle,
    infillOverlap: pd.infillOverlap,
    travelSpeed: pd.travelSpeed,
    initialLayerSpeed: pd.initialLayerSpeed,
    outerWallSpeed: pd.outerWallSpeed,
    initialLayerInfillSpeed: pd.initialLayerInfillSpeed,
    zHopHeight: pd.zHopHeight,
    supportThresholdAngle: pd.supportThresholdAngle,
    supportXYOffset: pd.supportXYOffset,
    supportZGap: pd.supportZGap,
    coastDistance: pd.coastDistance,
    wipeDistance: pd.wipeDistance,
    retractOnLayerChange: pd.retractOnLayerChange,
    arcFittingEnable: pd.arcFittingEnable,
    ...(nozzle ? { lineWidth: nozzle.diameter * 1.05 } : {}),
  };
}

const PROFILE_STORAGE_KEY = 'print-settings';

function loadSavedProfile(printerAddress: string): Partial<PrintProfile> | null {
  try {
    const all = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}');
    return all[printerAddress] ?? null;
  } catch {
    return null;
  }
}

function saveProfile(printerAddress: string, profile: PrintProfile): void {
  try {
    const all = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}');
    all[printerAddress] = profile;
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage errors
  }
}

interface PrintDialogProps {
  printer: Printer;
  printerConfig: PrinterConfig | null;
  printerConfigLoading: boolean;
  filaments: FilamentProfile[];
  stlData: ArrayBuffer;
  fileName: string;
  colorGroups?: ColorGroup[];
  threeMfData?: ArrayBuffer;
  onSlice: (
    stlData: ArrayBuffer,
    config: Record<string, string>,
    threeMfData?: ArrayBuffer,
  ) => Promise<SliceResult>;
  slicerStatus: string;
  slicerProgress: SliceProgress | null;
  slicerError: string | null;
  slicerDebugLog?: string[];
  onCancelSlice?: () => void;
  onUploadGcode: (gcode: string, fileName: string) => Promise<void>;
  onClose: () => void;
  onToast?: (message: string) => void;
  scadSlicerSettings?: ScadSlicerSettings;
  /** Human-readable slicer engine name (e.g. "WASM", "Native ARM") */
  engineName?: string;
}

type DialogPhase = 'configure' | 'slicing' | 'done' | 'error' | 'preview';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function progressPercent(p: SliceProgress): number {
  const stageWeights: Record<string, [number, number]> = {
    parsing: [0, 0.05],
    slicing: [0.05, 0.6],
    preparing: [0.6, 0.9],
    exporting: [0.9, 1.0],
  };
  const [start, end] = stageWeights[p.stage] ?? [0, 1];
  return Math.round((start + (end - start) * p.progress) * 100);
}

/** Auto-scrolling slicer log */
function SlicerLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <pre
      ref={ref}
      style={{
        fontSize: '0.65rem',
        opacity: 0.8,
        marginTop: '0.5rem',
        height: '120px',
        overflow: 'auto',
        background: '#111',
        color: '#0f0',
        padding: '0.5rem',
        borderRadius: '4px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {lines.join('\n')}
    </pre>
  );
}

/** A field label with override indicator and reset button */
function OverridableLabel({
  label,
  filamentName,
  isOverridden,
  onReset,
}: {
  label: string;
  filamentName: string;
  isOverridden: boolean;
  onReset: () => void;
}) {
  return (
    <span className="print-dialog-overridable-label">
      {label}
      {isOverridden ? (
        <button
          className="print-dialog-reset-btn"
          onClick={(e) => { e.preventDefault(); onReset(); }}
          title={`Reset to ${filamentName} profile default`}
        >
          reset
        </button>
      ) : (
        <span className="print-dialog-from-profile">From {filamentName}</span>
      )}
    </span>
  );
}

export function PrintDialog({
  printer,
  printerConfig,
  printerConfigLoading,
  filaments,
  stlData,
  fileName,
  colorGroups,
  threeMfData,
  onSlice,
  slicerStatus,
  slicerProgress,
  slicerError,
  slicerDebugLog,
  onCancelSlice,
  onUploadGcode,
  onClose,
  onToast,
  scadSlicerSettings: _scadSlicerSettings,
  engineName,
}: PrintDialogProps) {
  void _scadSlicerSettings; // reserved for future scad-file slicer overrides
  const hasMulticolor = colorGroups && colorGroups.length > 1;

  const [phase, setPhase] = useState<DialogPhase>('configure');
  const [profile, setProfile] = useState<PrintProfile>(() => {
    const base = printProfileFromProfile(printer.profileId, printer.nozzleDiameter);
    const saved = loadSavedProfile(printer.address);
    const merged = saved ? { ...base, ...saved } : base;
    return merged;
  });
  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(
    () => printerSettingsFromProfile(printer.profileId),
  );
  const [sliceResult, setSliceResult] = useState<SliceResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [startingPrint, setStartingPrint] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(
    hasMulticolor ? 'extruders' : 'quality',
  );

  // GCode preview state
  const [parsedGCode, setParsedGCode] = useState<ParsedGCode | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const previewWorkerRef = useRef<Worker | null>(null);

  // Per-color extruder assignments (color group index → extruder index)
  const [extruderAssignments, setExtruderAssignments] = useState<Record<number, number>>(() => {
    if (!colorGroups) return {};
    const assignments: Record<number, number> = {};
    for (const cg of colorGroups) {
      assignments[cg.index] = cg.index;
    }
    return assignments;
  });

  // Per-extruder filament selection
  const extruderCount = hasMulticolor
    ? Math.max(...Object.values(extruderAssignments)) + 1
    : 1;
  const {
    assignments: filamentAssignments,
    setExtruderFilament,
    getFilamentForExtruder,
  } = useExtruderFilaments(printer.address, extruderCount);

  // Primary filament = extruder 0's filament
  const primaryFilament = getFilamentForExtruder(0, filaments);

  // Per-printer filament overrides
  const {
    getResolvedFilament,
    setOverride,
    isFieldOverridden,
    resetField,
  } = usePrinterFilamentOverrides();

  // Resolved filament settings (global + per-printer overrides)
  const resolved = useMemo(
    () => getResolvedFilament(printer.address, primaryFilament),
    [getResolvedFilament, printer.address, primaryFilament],
  );

  // Apply printer config when it arrives
  useEffect(() => {
    if (!printerConfig) return;
    setPrinterSettings((prev) => ({
      ...prev,
      bedWidth: printerConfig.bedWidth,
      bedDepth: printerConfig.bedDepth,
      maxHeight: printerConfig.maxHeight,
      originCenter: printerConfig.originCenter,
      startGcode: printerConfig.startGcode || prev.startGcode,
      endGcode: printerConfig.endGcode || prev.endGcode,
    }));
  }, [printerConfig]);

  /** Update handler for extracted tab components */
  const handleProfileChange = useCallback((updates: Partial<PrintProfile>) => {
    setProfile((prev) => ({ ...prev, ...updates }));
  }, []);

  const updatePrinter = useCallback(<K extends keyof PrinterSettings>(key: K, value: PrinterSettings[K]) => {
    setPrinterSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** Update a filament-derived field — saves as per-printer override */
  const updateFilamentField = useCallback((field: keyof PrinterFilamentOverride, value: number | boolean) => {
    setOverride(printer.address, primaryFilament.id, { [field]: value });
  }, [setOverride, printer.address, primaryFilament.id]);

  /** Reset a single filament field override */
  const resetFilamentField = useCallback((field: keyof PrinterFilamentOverride) => {
    resetField(printer.address, primaryFilament.id, field);
  }, [resetField, printer.address, primaryFilament.id]);

  /** Check if a filament field is overridden */
  const isOverridden = useCallback((field: keyof PrinterFilamentOverride) => {
    return isFieldOverridden(printer.address, primaryFilament.id, field);
  }, [isFieldOverridden, printer.address, primaryFilament.id]);

  const handleSlice = useCallback(async () => {
    setPhase('slicing');
    setUploadError(null);
    try {
      saveProfile(printer.address, profile);
      const config = buildOrcaConfig(profile, resolved, printerSettings, printerConfig, extruderCount);

      // For multi-color, pass the 3MF buffer directly — OrcaSlicer handles
      // extruder assignment internally from 3MF metadata.
      const result = await onSlice(stlData, config, hasMulticolor ? threeMfData : undefined);
      setSliceResult(result);
      setPhase('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Slicing cancelled') {
        setPhase('configure');
        return;
      }
      setPhase('error');
      setUploadError(msg);
    }
  }, [profile, resolved, printerConfig, printerSettings, stlData, onSlice, printer.address, extruderCount, hasMulticolor, threeMfData]);

  const gcodeFileName = useMemo(
    () => fileName.replace(/\.(stl|3mf|scad)$/i, '') + '.gcode',
    [fileName],
  );

  /** Auto-start parsing GCode for inline preview when sliceResult arrives */
  useEffect(() => {
    if (!sliceResult || parsedGCode) return;
    // Don't re-parse if already parsing
    if (previewWorkerRef.current) return;

    setPreviewProgress(0);

    const worker = new Worker(
      new URL('../workers/gcode-preview-worker.ts', import.meta.url),
      { type: 'module' },
    );
    previewWorkerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setPreviewProgress(msg.progress);
      } else if (msg.type === 'done') {
        setParsedGCode(msg.result);
        worker.terminate();
        previewWorkerRef.current = null;
      } else if (msg.type === 'error') {
        worker.terminate();
        previewWorkerRef.current = null;
      } else if (msg.type === 'cancelled') {
        worker.terminate();
        previewWorkerRef.current = null;
      }
    };

    worker.postMessage({ type: 'parse', gcode: sliceResult.gcode });
  }, [sliceResult, parsedGCode]);

  // Clean up worker on unmount
  useEffect(() => {
    return () => {
      if (previewWorkerRef.current) {
        previewWorkerRef.current.terminate();
        previewWorkerRef.current = null;
      }
    };
  }, []);

  // Escape key: fullscreen preview → done → close dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (phase === 'preview') {
        setPhase('done');
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, onClose]);

  const sections = [
    ...(hasMulticolor ? [{ id: 'extruders', label: 'Extruders' }] : []),
    { id: 'printer', label: 'Printer' },
    { id: 'quality', label: 'Quality' },
    { id: 'walls', label: 'Walls' },
    { id: 'infill', label: 'Infill' },
    { id: 'speed', label: 'Speed' },
    { id: 'temperature', label: 'Temp' },
    { id: 'support', label: 'Support' },
    { id: 'adhesion', label: 'Adhesion' },
    { id: 'cooling', label: 'Cooling' },
    { id: 'retraction', label: 'Retract' },
    { id: 'advanced', label: 'Advanced' },
  ];

  return (
    <>
    {phase === 'preview' && parsedGCode && (
      <div className="gcode-preview-fullscreen">
        <GCodePreview
          parsedGCode={parsedGCode}
          bedWidth={printerSettings.bedWidth}
          bedDepth={printerSettings.bedDepth}
          originCenter={printerSettings.originCenter}
          nozzleDiameter={printerConfig?.nozzleDiameter ?? 0.4}
          extruderColors={
            colorGroups && colorGroups.length > 1
              ? colorGroups.map((cg) => cg.colorHex.slice(0, 7))
              : undefined
          }
          onBack={() => setPhase('done')}
        />
      </div>
    )}
    <div className="printer-settings-overlay" onClick={onClose} style={phase === 'preview' ? { display: 'none' } : undefined}>
      <div className="printer-settings-dialog print-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="printer-settings-header">
          <h3>Print: {fileName}</h3>
          <button className="printer-settings-close" onClick={onClose}>&times;</button>
        </div>

        {/* Printer & filament summary */}
        <div className="print-dialog-summary">
          <span className="print-dialog-printer">
            {printer.name}
            {printerConfigLoading && ' (loading config...)'}
            {printerConfig && ` (${printerConfig.bedWidth}x${printerConfig.bedDepth}mm${printerConfig.originCenter ? ', center origin' : ''})`}
          </span>
          {engineName && (
            <span className={`print-dialog-engine-badge ${engineName.toLowerCase().includes('native') ? 'print-dialog-engine-badge--native' : 'print-dialog-engine-badge--wasm'}`}>
              {engineName}
            </span>
          )}
          {!hasMulticolor && (
            <label className="print-dialog-filament-select">
              <span>Filament:</span>
              <select
                value={filamentAssignments[0] ?? primaryFilament.id}
                onChange={(e) => setExtruderFilament(0, e.target.value)}
              >
                {filaments.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} ({f.nozzleTemp}°C)</option>
                ))}
              </select>
            </label>
          )}
          {hasMulticolor && (
            <span className="print-dialog-filament">{extruderCount} extruders</span>
          )}
        </div>

        {phase === 'configure' && (
          <>
            {/* Section tabs */}
            <div className="print-dialog-tabs">
              {sections.map((s) => (
                <button
                  key={s.id}
                  className={`print-dialog-tab ${activeSection === s.id ? 'print-dialog-tab--active' : ''}`}
                  onClick={() => setActiveSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Section content */}
            <div className="print-dialog-section">
              {activeSection === 'extruders' && hasMulticolor && (
                <>
                  <p className="print-dialog-hint">
                    Assign each color to an extruder, then select a filament for each extruder.
                  </p>
                  <h4 className="print-dialog-subheading">Color → Extruder</h4>
                  {colorGroups.map((cg) => (
                    <label key={cg.index} className="print-dialog-field print-dialog-extruder-row">
                      <span className="print-dialog-color-label">
                        <span
                          className="print-dialog-color-swatch"
                          style={{ backgroundColor: cg.colorHex.slice(0, 7) }}
                        />
                        Color {cg.index + 1}
                      </span>
                      <select
                        value={extruderAssignments[cg.index] ?? cg.index}
                        onChange={(e) => setExtruderAssignments((prev) => ({
                          ...prev,
                          [cg.index]: Number(e.target.value),
                        }))}
                      >
                        {Array.from({ length: Math.max(colorGroups.length, extruderCount) }, (_, i) => (
                          <option key={i} value={i}>Extruder {i} (T{i})</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <h4 className="print-dialog-subheading">Extruder → Filament</h4>
                  {Array.from({ length: extruderCount }, (_, i) => {
                    const ef = getFilamentForExtruder(i, filaments);
                    return (
                      <label key={i} className="print-dialog-field print-dialog-extruder-row">
                        <span>T{i} — {ef.name}</span>
                        <select
                          value={filamentAssignments[i] ?? ef.id}
                          onChange={(e) => setExtruderFilament(i, e.target.value)}
                        >
                          {filaments.map((f) => (
                            <option key={f.id} value={f.id}>{f.name} ({f.nozzleTemp}°C)</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                  <h4 className="print-dialog-subheading">Tool Change GCode</h4>
                  <p className="print-dialog-hint">
                    Runs on each extruder switch. Variables: {'{tool}'}, {'{last_tool}'}, {'{z}'}, {'{e}'}.
                  </p>
                  <textarea
                    className="print-dialog-gcode"
                    value={printerSettings.toolChangeGcode}
                    onChange={(e) => updatePrinter('toolChangeGcode', e.target.value)}
                    rows={5}
                    placeholder={'T{tool}\n; Add purge/wipe/temp gcode here'}
                  />
                </>
              )}

              {activeSection === 'printer' && (
                <>
                  <label className="print-dialog-field">
                    <span>Bed Width (mm)</span>
                    <input type="number" value={printerSettings.bedWidth} min={50} max={1000}
                      onChange={(e) => updatePrinter('bedWidth', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Bed Depth (mm)</span>
                    <input type="number" value={printerSettings.bedDepth} min={50} max={1000}
                      onChange={(e) => updatePrinter('bedDepth', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Max Height (mm)</span>
                    <input type="number" value={printerSettings.maxHeight} min={50} max={1000}
                      onChange={(e) => updatePrinter('maxHeight', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field print-dialog-field--checkbox">
                    <input type="checkbox" checked={printerSettings.originCenter}
                      onChange={(e) => updatePrinter('originCenter', e.target.checked)} />
                    <span>Origin at bed center</span>
                  </label>

                  <details className="print-dialog-details">
                    <summary>Printable Area (polygon vertices)</summary>
                    <p className="print-dialog-hint">
                      Define the printable area as polygon vertices. Leave empty to use Bed Width &times; Depth rectangle.
                    </p>
                    {(printerSettings.printableArea ?? []).map((pt, i) => (
                      <div key={i} className="print-dialog-inline-row">
                        <label className="print-dialog-field">
                          <span>X</span>
                          <input type="number" value={pt.x} step={1}
                            onChange={(e) => {
                              const area = [...(printerSettings.printableArea ?? [])];
                              area[i] = { ...area[i], x: Number(e.target.value) };
                              updatePrinter('printableArea', area);
                            }} />
                        </label>
                        <label className="print-dialog-field">
                          <span>Y</span>
                          <input type="number" value={pt.y} step={1}
                            onChange={(e) => {
                              const area = [...(printerSettings.printableArea ?? [])];
                              area[i] = { ...area[i], y: Number(e.target.value) };
                              updatePrinter('printableArea', area);
                            }} />
                        </label>
                        <button className="print-dialog-remove-btn" onClick={() => {
                          const area = (printerSettings.printableArea ?? []).filter((_, j) => j !== i);
                          updatePrinter('printableArea', area);
                        }}>&times;</button>
                      </div>
                    ))}
                    <button className="print-dialog-add-btn" onClick={() => {
                      const area = [...(printerSettings.printableArea ?? []), { x: 0, y: 0 }];
                      updatePrinter('printableArea', area);
                    }}>Add vertex</button>
                  </details>

                  <details className="print-dialog-details">
                    <summary>Bed Exclude Areas</summary>
                    <p className="print-dialog-hint">
                      Rectangles the nozzle should not enter (e.g. for bed clips, purge bucket).
                    </p>
                    {(printerSettings.bedExcludeAreas ?? []).map((area, i) => (
                      <div key={i} className="print-dialog-inline-row">
                        <label className="print-dialog-field">
                          <span>X</span>
                          <input type="number" value={area.x} step={1}
                            onChange={(e) => {
                              const areas = [...(printerSettings.bedExcludeAreas ?? [])];
                              areas[i] = { ...areas[i], x: Number(e.target.value) };
                              updatePrinter('bedExcludeAreas', areas);
                            }} />
                        </label>
                        <label className="print-dialog-field">
                          <span>Y</span>
                          <input type="number" value={area.y} step={1}
                            onChange={(e) => {
                              const areas = [...(printerSettings.bedExcludeAreas ?? [])];
                              areas[i] = { ...areas[i], y: Number(e.target.value) };
                              updatePrinter('bedExcludeAreas', areas);
                            }} />
                        </label>
                        <label className="print-dialog-field">
                          <span>W</span>
                          <input type="number" value={area.width} min={1} step={1}
                            onChange={(e) => {
                              const areas = [...(printerSettings.bedExcludeAreas ?? [])];
                              areas[i] = { ...areas[i], width: Number(e.target.value) };
                              updatePrinter('bedExcludeAreas', areas);
                            }} />
                        </label>
                        <label className="print-dialog-field">
                          <span>H</span>
                          <input type="number" value={area.height} min={1} step={1}
                            onChange={(e) => {
                              const areas = [...(printerSettings.bedExcludeAreas ?? [])];
                              areas[i] = { ...areas[i], height: Number(e.target.value) };
                              updatePrinter('bedExcludeAreas', areas);
                            }} />
                        </label>
                        <button className="print-dialog-remove-btn" onClick={() => {
                          const areas = (printerSettings.bedExcludeAreas ?? []).filter((_, j) => j !== i);
                          updatePrinter('bedExcludeAreas', areas);
                        }}>&times;</button>
                      </div>
                    ))}
                    <button className="print-dialog-add-btn" onClick={() => {
                      const areas = [...(printerSettings.bedExcludeAreas ?? []), { x: 0, y: 0, width: 10, height: 10 }];
                      updatePrinter('bedExcludeAreas', areas);
                    }}>Add exclude area</button>
                  </details>

                  <label className="print-dialog-field">
                    <span>Printer Structure</span>
                    <select value={printerSettings.printerStructureType}
                      onChange={(e) => updatePrinter('printerStructureType', e.target.value as PrinterStructureType)}>
                      <option value="cartesian">Cartesian</option>
                      <option value="corexy">CoreXY</option>
                      <option value="i3">i3 (bed slinger)</option>
                      <option value="hbot">H-Bot</option>
                      <option value="delta">Delta</option>
                    </select>
                  </label>

                  <label className="print-dialog-field">
                    <span>Nozzle Type</span>
                    <select value={printerSettings.nozzleType}
                      onChange={(e) => updatePrinter('nozzleType', e.target.value as NozzleType)}>
                      <option value="brass">Brass</option>
                      <option value="hardened_steel">Hardened Steel</option>
                      <option value="stainless_steel">Stainless Steel</option>
                      <option value="undefine">Unspecified</option>
                    </select>
                  </label>
                  <label className="print-dialog-field">
                    <span>Nozzle HRC (0 = not specified)</span>
                    <input type="number" value={printerSettings.nozzleHRC} min={0} max={100} step={1}
                      onChange={(e) => updatePrinter('nozzleHRC', Number(e.target.value))} />
                  </label>

                  <label className="print-dialog-field print-dialog-field--checkbox">
                    <input type="checkbox" checked={printerSettings.auxiliaryFan}
                      onChange={(e) => updatePrinter('auxiliaryFan', e.target.checked)} />
                    <span>Auxiliary part cooling fan</span>
                  </label>
                  <label className="print-dialog-field print-dialog-field--checkbox">
                    <input type="checkbox" checked={printerSettings.chamberTempControl}
                      onChange={(e) => updatePrinter('chamberTempControl', e.target.checked)} />
                    <span>Chamber temperature control</span>
                  </label>

                  <label className="print-dialog-field">
                    <span>Max Volumetric Speed (mm&sup3;/s, 0 = unlimited)</span>
                    <input type="number" value={printerSettings.maxVolumetricSpeed} min={0} max={100} step={0.5}
                      onChange={(e) => updatePrinter('maxVolumetricSpeed', Number(e.target.value))} />
                  </label>

                  <label className="print-dialog-field">
                    <span>Start GCode</span>
                    <textarea
                      className="print-dialog-gcode"
                      value={printerSettings.startGcode}
                      onChange={(e) => updatePrinter('startGcode', e.target.value)}
                      rows={4}
                      placeholder="Auto-filled from printer config"
                    />
                  </label>
                  <label className="print-dialog-field">
                    <span>End GCode</span>
                    <textarea
                      className="print-dialog-gcode"
                      value={printerSettings.endGcode}
                      onChange={(e) => updatePrinter('endGcode', e.target.value)}
                      rows={4}
                      placeholder="Auto-filled from printer config"
                    />
                  </label>
                  {printerConfig && (
                    <p className="print-dialog-hint">
                      Auto-populated from Moonraker. Edit to override.
                    </p>
                  )}
                </>
              )}

              {activeSection === 'quality' && (
                <QualityTab profile={profile} onChange={handleProfileChange} />
              )}

              {activeSection === 'walls' && (
                <WallsTab profile={profile} onChange={handleProfileChange} />
              )}

              {activeSection === 'infill' && (
                <InfillTab profile={profile} onChange={handleProfileChange} />
              )}

              {activeSection === 'speed' && (
                <>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label={`Print Speed (mm/s)${printerConfig ? ` [max ${printerConfig.maxVelocity}]` : ''}`}
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('printSpeed')}
                      onReset={() => resetFilamentField('printSpeed')}
                    />
                    <input type="number" value={resolved.printSpeed} min={5} max={printerConfig?.maxVelocity ?? 500}
                      onChange={(e) => updateFilamentField('printSpeed', Number(e.target.value))} />
                  </label>
                  <SpeedTab profile={profile} onChange={handleProfileChange} maxVelocity={printerConfig?.maxVelocity} />
                </>
              )}

              {activeSection === 'temperature' && (
                <>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label="Nozzle Temp (°C)"
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('nozzleTemp')}
                      onReset={() => resetFilamentField('nozzleTemp')}
                    />
                    <input type="number" value={resolved.nozzleTemp} min={150} max={350}
                      onChange={(e) => updateFilamentField('nozzleTemp', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label="First Layer Nozzle (°C)"
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('firstLayerNozzleTemp')}
                      onReset={() => resetFilamentField('firstLayerNozzleTemp')}
                    />
                    <input type="number" value={resolved.firstLayerNozzleTemp} min={150} max={350}
                      onChange={(e) => updateFilamentField('firstLayerNozzleTemp', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label="Bed Temp (°C)"
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('bedTemp')}
                      onReset={() => resetFilamentField('bedTemp')}
                    />
                    <input type="number" value={resolved.bedTemp} min={0} max={150}
                      onChange={(e) => updateFilamentField('bedTemp', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label="First Layer Bed (°C)"
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('firstLayerBedTemp')}
                      onReset={() => resetFilamentField('firstLayerBedTemp')}
                    />
                    <input type="number" value={resolved.firstLayerBedTemp} min={0} max={150}
                      onChange={(e) => updateFilamentField('firstLayerBedTemp', Number(e.target.value))} />
                  </label>
                </>
              )}

              {activeSection === 'support' && (
                <SupportTab profile={profile} onChange={handleProfileChange} />
              )}

              {activeSection === 'adhesion' && (
                <AdhesionTab profile={profile} onChange={handleProfileChange} />
              )}

              {activeSection === 'cooling' && (
                <CoolingTab
                  profile={profile}
                  onChange={handleProfileChange}
                  resolved={resolved}
                  filamentName={primaryFilament.name}
                  isOverridden={isOverridden}
                  updateFilamentField={updateFilamentField}
                  resetFilamentField={resetFilamentField}
                />
              )}

              {activeSection === 'retraction' && (
                <RetractionTab
                  profile={profile}
                  onChange={handleProfileChange}
                  resolved={resolved}
                  filamentName={primaryFilament.name}
                  isOverridden={isOverridden}
                  updateFilamentField={updateFilamentField}
                  resetFilamentField={resetFilamentField}
                />
              )}

              {activeSection === 'advanced' && (
                <AdvancedTab profile={profile} onChange={handleProfileChange} />
              )}
            </div>

            {/* Slice & Send button */}
            <button
              className="print-dialog-slice-btn"
              onClick={handleSlice}
              disabled={slicerStatus === 'loading' || slicerStatus === 'slicing'}
            >
              Slice
            </button>
          </>
        )}

        {phase === 'slicing' && (
          <div className="print-dialog-progress">
            {engineName && (
              <span className={`print-dialog-engine-badge ${engineName.toLowerCase().includes('native') ? 'print-dialog-engine-badge--native' : 'print-dialog-engine-badge--wasm'}`}>
                Slicing with {engineName}
              </span>
            )}
            <p className="print-dialog-progress-label">
              {slicerProgress
                ? `${slicerProgress.stage}${slicerProgress.message ? ` (${slicerProgress.message})` : ''}... ${progressPercent(slicerProgress)}%`
                : 'Initializing slicer...'}
            </p>
            <div className="print-dialog-progress-bar">
              <div
                className="print-dialog-progress-fill"
                style={{ width: `${slicerProgress ? progressPercent(slicerProgress) : 0}%` }}
              />
            </div>
            {slicerProgress && (
              <p className="print-dialog-progress-detail" style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.25rem' }}>
                raw: {slicerProgress.stage} p={slicerProgress.progress.toFixed(3)}
              </p>
            )}
            {slicerDebugLog && slicerDebugLog.length > 0 && (
              <SlicerLog lines={slicerDebugLog} />
            )}
            {onCancelSlice && (
              <button
                className="print-dialog-cancel-btn"
                onClick={onCancelSlice}
                style={{ marginTop: '0.75rem' }}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {phase === 'done' && sliceResult && (
          <div className="print-dialog-done">
            {uploadError && (
              <p className="print-dialog-upload-warning" style={{ color: '#f0ad4e', marginBottom: '0.5rem' }}>
                {uploadError}
              </p>
            )}

            {/* Inline GCode preview */}
            {parsedGCode ? (
              <div className="print-dialog-inline-preview">
                <GCodePreview
                  parsedGCode={parsedGCode}
                  bedWidth={printerSettings.bedWidth}
                  bedDepth={printerSettings.bedDepth}
                  originCenter={printerSettings.originCenter}
                  nozzleDiameter={printerConfig?.nozzleDiameter ?? 0.4}
                  extruderColors={
                    colorGroups && colorGroups.length > 1
                      ? colorGroups.map((cg) => cg.colorHex.slice(0, 7))
                      : undefined
                  }
                />
                <button
                  className="print-dialog-fullscreen-btn"
                  onClick={() => setPhase('preview')}
                  title="Fullscreen preview"
                >
                  &#x26F6;
                </button>
              </div>
            ) : (
              <div className="print-dialog-preview-loading">
                <p>Preparing preview... {Math.round(previewProgress * 100)}%</p>
                <div className="print-dialog-progress-bar">
                  <div
                    className="print-dialog-progress-fill"
                    style={{ width: `${Math.round(previewProgress * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="print-dialog-done-info">
              {sliceResult.printTime && (
                <span>Time: {formatTime(sliceResult.printTime)}</span>
              )}
              {sliceResult.filamentUsed && (
                <span>Filament: {(sliceResult.filamentUsed / 1000).toFixed(1)}m</span>
              )}
            </div>
            <div className="print-dialog-done-actions">
              <button
                className="print-dialog-start-btn"
                disabled={startingPrint}
                onClick={async () => {
                  setStartingPrint(true);
                  setUploadError(null);
                  try {
                    await onUploadGcode(sliceResult.gcode, gcodeFileName);
                    await startPrint(printer.address, gcodeFileName);
                    onToast?.(`Started printing ${gcodeFileName} on ${printer.name}`);
                    onClose();
                  } catch (err) {
                    setUploadError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setStartingPrint(false);
                  }
                }}
              >
                {startingPrint ? 'Sending...' : `Print on ${printer.name}`}
              </button>
              <button
                className="print-dialog-download-btn"
                onClick={() => {
                  const blob = new Blob([sliceResult.gcode], { type: 'application/octet-stream' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = gcodeFileName;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  // Delay revoke to give Android time to start the download
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Download GCode
              </button>
              <button className="print-dialog-close-btn" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="print-dialog-error">
            <p>Slicing failed:</p>
            <pre className="print-dialog-error-detail">{uploadError || slicerError || 'Unknown error'}</pre>
            <div className="print-dialog-error-actions">
              <button onClick={() => setPhase('configure')}>Back to Settings</button>
              <button onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
