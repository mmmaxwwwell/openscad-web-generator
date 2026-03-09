import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Printer } from '../hooks/usePrinters';
import type { FilamentProfile } from '../hooks/useFilaments';
import { useExtruderFilaments } from '../hooks/useExtruderFilaments';
import { usePrinterFilamentOverrides, type PrinterFilamentOverride } from '../hooks/usePrinterFilamentOverrides';
import { startPrint, type PrinterConfig } from '../lib/moonraker-api';
import type { SliceProgress, SliceResult } from '../hooks/useSlicer';
import type { ColorGroup } from '../lib/merge-3mf';
import { extractColorMeshes } from '../lib/merge-3mf';
import type { MultiColorMesh } from '../lib/kiri-engine';
import type { PrintProfile } from '../types/print-profile';
import { DEFAULT_PRINT_PROFILE } from '../types/print-profile';
import { getPrinterProfile, getNozzleProfile } from '../data/printer-profiles';
import { buildProcessSettings, buildDeviceSettings, type PrinterSettings } from '../lib/slicer-settings';

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
};

/** Build PrinterSettings from a printer profile, falling back to generic defaults */
function printerSettingsFromProfile(profileId?: string): PrinterSettings {
  if (!profileId) return DEFAULT_PRINTER_SETTINGS;
  const profile = getPrinterProfile(profileId);
  if (!profile) return DEFAULT_PRINTER_SETTINGS;
  return {
    bedWidth: profile.bedWidth,
    bedDepth: profile.bedDepth,
    maxHeight: profile.maxHeight,
    originCenter: profile.originCenter,
    startGcode: profile.startGcode,
    endGcode: profile.endGcode,
    toolChangeGcode: DEFAULT_PRINTER_SETTINGS.toolChangeGcode,
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
    firstLayerHeight: pd.firstLayerHeight,
    lineWidth: pd.lineWidth,
    shellCount: pd.shellCount,
    topLayers: pd.topLayers,
    bottomLayers: pd.bottomLayers,
    shellOrder: pd.shellOrder,
    infillDensity: pd.infillDensity,
    infillAngle: pd.infillAngle,
    infillOverlap: pd.infillOverlap,
    travelSpeed: pd.travelSpeed,
    firstLayerSpeed: pd.firstLayerSpeed,
    outerWallSpeed: pd.outerWallSpeed,
    firstLayerFillSpeed: pd.firstLayerFillSpeed,
    zHopHeight: pd.zHopHeight,
    supportAngle: pd.supportAngle,
    supportXYOffset: pd.supportXYOffset,
    supportZGap: pd.supportZGap,
    coastDist: pd.coastDist,
    wipeDistance: pd.wipeDistance,
    retractOnLayerChange: pd.retractOnLayerChange,
    arcEnabled: pd.arcEnabled,
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

const INFILL_PATTERNS = [
  { value: 'gyroid', label: 'Gyroid' },
  { value: 'hex', label: 'Honeycomb' },
  { value: 'grid', label: 'Grid' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'linear', label: 'Lines' },
];

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
    processSettings: Record<string, unknown>,
    deviceSettings: Record<string, unknown>,
    tools?: unknown[],
    multiColorMeshes?: MultiColorMesh[],
  ) => Promise<SliceResult>;
  slicerStatus: string;
  slicerProgress: SliceProgress | null;
  slicerError: string | null;
  slicerDebugLog?: string[];
  onUploadGcode: (gcode: string, fileName: string) => Promise<void>;
  onClose: () => void;
  onToast?: (message: string) => void;
}

type DialogPhase = 'configure' | 'slicing' | 'done' | 'error';

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
  onUploadGcode,
  onClose,
  onToast,
}: PrintDialogProps) {
  const hasMulticolor = colorGroups && colorGroups.length > 1;

  const [phase, setPhase] = useState<DialogPhase>('configure');
  const [profile, setProfile] = useState<PrintProfile>(() => {
    const base = printProfileFromProfile(printer.profileId, printer.nozzleDiameter);
    const saved = loadSavedProfile(printer.address);
    return saved ? { ...base, ...saved } : base;
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

  const updateProfile = useCallback(<K extends keyof PrintProfile>(key: K, value: PrintProfile[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updatePrinter = useCallback(<K extends keyof PrinterSettings>(key: K, value: PrinterSettings[K]) => {
    setPrinterSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** Update a filament-derived field — saves as per-printer override */
  const updateFilamentField = useCallback((field: keyof PrinterFilamentOverride, value: number) => {
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
      const processSettings = buildProcessSettings(profile, resolved);
      const deviceSettings = buildDeviceSettings(printerConfig, printerSettings, extruderCount, getFilamentForExtruder, filaments);

      // Build tools array for multi-extruder
      let tools: unknown[] | undefined;
      if (extruderCount > 1) {
        tools = Array.from({ length: extruderCount }, (_, i) => {
          const fil = getFilamentForExtruder(i, filaments);
          return {
            extNozzle: printerConfig?.nozzleDiameter ?? 0.4,
            extFilament: printerConfig?.filamentDiameter ?? 1.75,
            extOffsetX: 0,
            extOffsetY: 0,
            extSelect: [`T${i}`],
            extDeselect: [],
            extTemp: fil.nozzleTemp,
          };
        });
      }

      // Extract per-color meshes from 3MF for multi-material slicing
      let multiColorMeshes: MultiColorMesh[] | undefined;
      if (hasMulticolor && threeMfData) {
        const colorMeshes = extractColorMeshes(threeMfData);
        if (colorMeshes.length > 1) {
          multiColorMeshes = colorMeshes.map((cm) => ({
            vertices: cm.vertices,
            extruder: extruderAssignments[cm.extruder] ?? cm.extruder,
          }));
        }
      }

      const result = await onSlice(stlData, processSettings, deviceSettings, tools, multiColorMeshes);
      setSliceResult(result);
      setPhase('done');
    } catch (err) {
      setPhase('error');
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  }, [profile, resolved, printerConfig, printerSettings, stlData, fileName, onSlice, printer.address, extruderCount, getFilamentForExtruder, filaments, hasMulticolor, threeMfData, extruderAssignments]);

  const gcodeFileName = useMemo(
    () => fileName.replace(/\.(stl|3mf|scad)$/i, '') + '.gcode',
    [fileName],
  );

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
    { id: 'fan', label: 'Fan' },
    { id: 'retraction', label: 'Retract' },
    { id: 'advanced', label: 'Advanced' },
  ];

  return (
    <div className="printer-settings-overlay" onClick={onClose}>
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
                <>
                  <label className="print-dialog-field">
                    <span>Layer Height (mm)</span>
                    <input type="number" value={profile.layerHeight} step={0.05} min={0.05} max={0.6}
                      onChange={(e) => updateProfile('layerHeight', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>First Layer Height (mm)</span>
                    <input type="number" value={profile.firstLayerHeight} step={0.05} min={0.1} max={0.6}
                      onChange={(e) => updateProfile('firstLayerHeight', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Line Width (mm)</span>
                    <input type="number" value={profile.lineWidth} step={0.05} min={0.1} max={1.0}
                      onChange={(e) => updateProfile('lineWidth', Number(e.target.value))} />
                  </label>
                </>
              )}

              {activeSection === 'walls' && (
                <>
                  <label className="print-dialog-field">
                    <span>Wall Count</span>
                    <input type="number" value={profile.shellCount} min={1} max={20}
                      onChange={(e) => updateProfile('shellCount', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Wall Order</span>
                    <select value={profile.shellOrder}
                      onChange={(e) => updateProfile('shellOrder', e.target.value as 'in-out' | 'out-in')}>
                      <option value="in-out">Inner → Outer</option>
                      <option value="out-in">Outer → Inner</option>
                    </select>
                  </label>
                  <label className="print-dialog-field">
                    <span>Top Layers</span>
                    <input type="number" value={profile.topLayers} min={0} max={20}
                      onChange={(e) => updateProfile('topLayers', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Bottom Layers</span>
                    <input type="number" value={profile.bottomLayers} min={0} max={20}
                      onChange={(e) => updateProfile('bottomLayers', Number(e.target.value))} />
                  </label>
                </>
              )}

              {activeSection === 'infill' && (
                <>
                  <label className="print-dialog-field">
                    <span>Infill Density ({Math.round(profile.infillDensity * 100)}%)</span>
                    <input type="range" value={profile.infillDensity} step={0.05} min={0} max={1}
                      onChange={(e) => updateProfile('infillDensity', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Infill Pattern</span>
                    <select value={profile.infillPattern}
                      onChange={(e) => updateProfile('infillPattern', e.target.value)}>
                      {INFILL_PATTERNS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="print-dialog-field">
                    <span>Infill Angle (°)</span>
                    <input type="number" value={profile.infillAngle} min={0} max={180}
                      onChange={(e) => updateProfile('infillAngle', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Infill Overlap ({Math.round(profile.infillOverlap * 100)}%)</span>
                    <input type="range" value={profile.infillOverlap} step={0.05} min={0} max={0.8}
                      onChange={(e) => updateProfile('infillOverlap', Number(e.target.value))} />
                  </label>
                </>
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
                  <label className="print-dialog-field">
                    <span>Outer Wall Speed (mm/s, 0 = same)</span>
                    <input type="number" value={profile.outerWallSpeed} min={0} max={printerConfig?.maxVelocity ?? 500}
                      onChange={(e) => updateProfile('outerWallSpeed', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Travel Speed (mm/s)</span>
                    <input type="number" value={profile.travelSpeed} min={10} max={printerConfig?.maxVelocity ?? 500}
                      onChange={(e) => updateProfile('travelSpeed', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>First Layer Speed (mm/s)</span>
                    <input type="number" value={profile.firstLayerSpeed} min={5} max={100}
                      onChange={(e) => updateProfile('firstLayerSpeed', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>First Layer Infill Speed (mm/s)</span>
                    <input type="number" value={profile.firstLayerFillSpeed} min={5} max={200}
                      onChange={(e) => updateProfile('firstLayerFillSpeed', Number(e.target.value))} />
                  </label>
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
                <>
                  <label className="print-dialog-field print-dialog-field--checkbox">
                    <input type="checkbox" checked={profile.supportEnabled}
                      onChange={(e) => updateProfile('supportEnabled', e.target.checked)} />
                    <span>Enable Supports</span>
                  </label>
                  {profile.supportEnabled && (
                    <>
                      <label className="print-dialog-field">
                        <span>Overhang Angle (°)</span>
                        <input type="number" value={profile.supportAngle} min={0} max={90}
                          onChange={(e) => updateProfile('supportAngle', Number(e.target.value))} />
                      </label>
                      <label className="print-dialog-field">
                        <span>Support Density ({Math.round(profile.supportDensity * 100)}%)</span>
                        <input type="range" value={profile.supportDensity} step={0.05} min={0.05} max={0.5}
                          onChange={(e) => updateProfile('supportDensity', Number(e.target.value))} />
                      </label>
                      <label className="print-dialog-field">
                        <span>XY Offset (mm)</span>
                        <input type="number" value={profile.supportXYOffset} step={0.1} min={0} max={2}
                          onChange={(e) => updateProfile('supportXYOffset', Number(e.target.value))} />
                      </label>
                      <label className="print-dialog-field">
                        <span>Z Gap (layers)</span>
                        <input type="number" value={profile.supportZGap} min={0} max={5}
                          onChange={(e) => updateProfile('supportZGap', Number(e.target.value))} />
                      </label>
                    </>
                  )}
                </>
              )}

              {activeSection === 'adhesion' && (
                <>
                  <label className="print-dialog-field">
                    <span>Adhesion Type</span>
                    <select value={profile.adhesionType}
                      onChange={(e) => updateProfile('adhesionType', e.target.value as PrintProfile['adhesionType'])}>
                      <option value="none">None</option>
                      <option value="skirt">Skirt</option>
                      <option value="brim">Brim</option>
                      <option value="raft">Raft</option>
                    </select>
                  </label>
                  {profile.adhesionType === 'skirt' && (
                    <label className="print-dialog-field">
                      <span>Skirt Loops</span>
                      <input type="number" value={profile.skirtCount} min={0} max={20}
                        onChange={(e) => updateProfile('skirtCount', Number(e.target.value))} />
                    </label>
                  )}
                  {profile.adhesionType === 'brim' && (
                    <label className="print-dialog-field">
                      <span>Brim Width (mm)</span>
                      <input type="number" value={profile.brimWidth} min={1} max={30}
                        onChange={(e) => updateProfile('brimWidth', Number(e.target.value))} />
                    </label>
                  )}
                </>
              )}

              {activeSection === 'fan' && (
                <>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label={`Fan Speed (${resolved.fanSpeed}%)`}
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('fanSpeed')}
                      onReset={() => resetFilamentField('fanSpeed')}
                    />
                    <input type="range" value={resolved.fanSpeed} min={0} max={100}
                      onChange={(e) => updateFilamentField('fanSpeed', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label={`First Layer Fan (${resolved.firstLayerFan}%)`}
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('firstLayerFan')}
                      onReset={() => resetFilamentField('firstLayerFan')}
                    />
                    <input type="range" value={resolved.firstLayerFan} min={0} max={100}
                      onChange={(e) => updateFilamentField('firstLayerFan', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label="Min Speed (mm/s)"
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('minSpeed')}
                      onReset={() => resetFilamentField('minSpeed')}
                    />
                    <input type="number" value={resolved.minSpeed} min={5} max={100}
                      onChange={(e) => updateFilamentField('minSpeed', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label="Min Layer Time (s)"
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('minLayerTime')}
                      onReset={() => resetFilamentField('minLayerTime')}
                    />
                    <input type="number" value={resolved.minLayerTime} min={0} max={30}
                      onChange={(e) => updateFilamentField('minLayerTime', Number(e.target.value))} />
                  </label>
                </>
              )}

              {activeSection === 'retraction' && (
                <>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label="Retract Distance (mm)"
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('retractDist')}
                      onReset={() => resetFilamentField('retractDist')}
                    />
                    <input type="number" value={resolved.retractDist} step={0.5} min={0} max={15}
                      onChange={(e) => updateFilamentField('retractDist', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <OverridableLabel
                      label="Retract Speed (mm/s)"
                      filamentName={primaryFilament.name}
                      isOverridden={isOverridden('retractSpeed')}
                      onReset={() => resetFilamentField('retractSpeed')}
                    />
                    <input type="number" value={resolved.retractSpeed} min={5} max={120}
                      onChange={(e) => updateFilamentField('retractSpeed', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Z-Hop (mm)</span>
                    <input type="number" value={profile.zHopHeight} step={0.1} min={0} max={2}
                      onChange={(e) => updateProfile('zHopHeight', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Coast Distance (mm)</span>
                    <input type="number" value={profile.coastDist} step={0.1} min={0} max={5}
                      onChange={(e) => updateProfile('coastDist', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field">
                    <span>Wipe Distance (mm)</span>
                    <input type="number" value={profile.wipeDistance} step={0.5} min={0} max={10}
                      onChange={(e) => updateProfile('wipeDistance', Number(e.target.value))} />
                  </label>
                  <label className="print-dialog-field print-dialog-field--checkbox">
                    <input type="checkbox" checked={profile.retractOnLayerChange}
                      onChange={(e) => updateProfile('retractOnLayerChange', e.target.checked)} />
                    <span>Retract on Layer Change</span>
                  </label>
                </>
              )}

              {activeSection === 'advanced' && (
                <>
                  <label className="print-dialog-field print-dialog-field--checkbox">
                    <input type="checkbox" checked={profile.arcEnabled}
                      onChange={(e) => updateProfile('arcEnabled', e.target.checked)} />
                    <span>Enable Arc Fitting (G2/G3)</span>
                  </label>
                </>
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
              <pre style={{ fontSize: '0.65rem', opacity: 0.8, marginTop: '0.5rem', maxHeight: '200px', overflow: 'auto', background: '#111', color: '#0f0', padding: '0.5rem', borderRadius: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {slicerDebugLog.join('\n')}
              </pre>
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
            <p className="print-dialog-success">
              Slicing complete
            </p>
            {sliceResult.printTime && (
              <p>Estimated print time: {formatTime(sliceResult.printTime)}</p>
            )}
            {sliceResult.filamentUsed && (
              <p>Filament used: {(sliceResult.filamentUsed / 1000).toFixed(1)}m</p>
            )}
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
  );
}
