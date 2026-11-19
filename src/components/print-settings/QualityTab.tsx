// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react';
import type { PrintProfile } from '../../types/print-profile';
import { createOverrideHelpers, PerObjectWarning } from './override-helpers';

export interface PrintSettingsTabProps {
  profile: PrintProfile;
  onChange: (updates: Partial<PrintProfile>) => void;
  /** Per-object overrides — when present, fields in this object are "overridden" (for visual indicators) */
  overrides?: Partial<PrintProfile>;
  /** Reset a single field's override back to plate default */
  onResetField?: (field: keyof PrintProfile) => void;
  /** Pre-slice auto value approximations (keyed by PrintProfile field name) */
  autoValues?: Record<string, number>;
  /** Post-slice resolved config values from WASM engine (keyed by OrcaSlicer config key name) */
  resolvedConfigs?: Record<string, string>;
  /** Set of PrintProfile field names that have per-object overrides (for plate settings warning indicators) */
  perObjectOverrides?: Set<keyof PrintProfile>;
}

const SEAM_POSITIONS: Array<{ value: PrintProfile['seamPosition']; label: string }> = [
  { value: 'nearest', label: 'Nearest' },
  { value: 'aligned', label: 'Aligned' },
  { value: 'aligned_back', label: 'Aligned Back' },
  { value: 'back', label: 'Rear' },
  { value: 'random', label: 'Random' },
];

const SEAM_SCARF_TYPES: Array<{ value: PrintProfile['seamScarfType']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'external', label: 'External' },
  { value: 'all', label: 'All' },
];

/** Maps PrintProfile line width field names to OrcaSlicer config key names */
const LINE_WIDTH_CONFIG_KEYS: Record<string, string> = {
  lineWidth: 'line_width',
  outerWallLineWidth: 'outer_wall_line_width',
  innerWallLineWidth: 'inner_wall_line_width',
  topSurfaceLineWidth: 'top_surface_line_width',
  internalSolidInfillLineWidth: 'internal_solid_infill_line_width',
  sparseInfillLineWidth: 'sparse_infill_line_width',
  supportLineWidth: 'support_line_width',
  initialLayerLineWidth: 'initial_layer_line_width',
};

interface LineWidthFieldProps {
  label: string;
  value: number;
  autoValue?: number;
  fieldKey: keyof PrintProfile;
  onChange: (updates: Partial<PrintProfile>) => void;
  overrideClass?: string;
  resetBtnEl?: React.ReactElement | null;
  /** Post-slice resolved value from WASM engine (takes priority over autoValue) */
  resolvedValue?: number;
}

function LineWidthField({ label, value, fieldKey, onChange, overrideClass, resetBtnEl, autoValue = 0.4, resolvedValue }: LineWidthFieldProps) {
  const isAuto = value === 0;
  const displayValue = resolvedValue ?? autoValue;
  const isResolved = resolvedValue !== undefined;
  return (
    <label className={`print-dialog-field${overrideClass || ''}`}>
      <span>{label} {isAuto ? '(auto)' : `(${value} mm)`} {resetBtnEl}</span>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="number"
          value={isAuto ? displayValue : value}
          disabled={isAuto}
          step={0.01}
          min={0.05}
          max={2.0}
          style={{ flex: 1, opacity: isAuto ? 0.5 : 1, fontStyle: isAuto ? 'italic' : undefined }}
          onChange={(e) => {
            const val = e.target.value === '' ? 0 : Number(e.target.value);
            onChange({ [fieldKey]: val } as Partial<PrintProfile>);
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={isAuto}
            onChange={(e) => {
              onChange({ [fieldKey]: e.target.checked ? 0 : displayValue } as Partial<PrintProfile>);
            }}
          />
          Auto
          {isAuto && (
            <span style={{ fontSize: '0.8em', opacity: 0.6, marginLeft: '0.15rem' }}>
              {isResolved ? '(resolved)' : '(est.)'}
            </span>
          )}
        </label>
      </div>
    </label>
  );
}

export function QualityTab({ profile, onChange, overrides, onResetField, autoValues, resolvedConfigs, perObjectOverrides }: PrintSettingsTabProps) {
  const { oc, resetBtn } = createOverrideHelpers(overrides, onResetField);
  const [scarfOpen, setScarfOpen] = useState(false);

  /** Get the resolved value for a line width field, if available from post-slice data */
  const getResolvedLineWidth = (fieldKey: string): number | undefined => {
    const configKey = LINE_WIDTH_CONFIG_KEYS[fieldKey];
    if (configKey && resolvedConfigs?.[configKey]) {
      const v = parseFloat(resolvedConfigs[configKey]);
      if (!isNaN(v) && v > 0) return v;
    }
    return undefined;
  };

  /** Get the auto value for a line width field from pre-slice approximation */
  const getAutoLineWidth = (fieldKey: string): number | undefined => {
    if (autoValues?.[fieldKey] !== undefined && autoValues[fieldKey] > 0) {
      return autoValues[fieldKey];
    }
    return undefined;
  };

  return (
    <>
      {/* Layer heights */}
      <label className={`print-dialog-field${oc('layerHeight')}`}>
        <span>Layer Height (mm) {resetBtn('layerHeight')} <PerObjectWarning field="layerHeight" perObjectOverrides={perObjectOverrides} /></span>
        <input type="number" value={profile.layerHeight} step={0.05} min={0.05} max={0.6}
          onChange={(e) => onChange({ layerHeight: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('initialLayerPrintHeight')}`}>
        <span>First Layer Height (mm) {resetBtn('initialLayerPrintHeight')} <PerObjectWarning field="initialLayerPrintHeight" perObjectOverrides={perObjectOverrides} /></span>
        <input type="number" value={profile.initialLayerPrintHeight} step={0.05} min={0.1} max={0.6}
          onChange={(e) => onChange({ initialLayerPrintHeight: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field print-dialog-field--checkbox${oc('adaptiveLayerHeight')}`}>
        <input type="checkbox" checked={profile.adaptiveLayerHeight}
          onChange={(e) => onChange({ adaptiveLayerHeight: e.target.checked })} />
        <span>Adaptive Layer Height {resetBtn('adaptiveLayerHeight')}</span>
      </label>
      <label className={`print-dialog-field print-dialog-field--checkbox${oc('preciseZHeight')}`}>
        <input type="checkbox" checked={profile.preciseZHeight}
          onChange={(e) => onChange({ preciseZHeight: e.target.checked })} />
        <span>Precise Z Height {resetBtn('preciseZHeight')}</span>
      </label>

      {/* Line widths */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Line Widths</h4>
      <LineWidthField label="Default" value={profile.lineWidth} fieldKey="lineWidth" onChange={onChange} overrideClass={oc('lineWidth')} resetBtnEl={resetBtn('lineWidth')} autoValue={getAutoLineWidth('lineWidth')} resolvedValue={getResolvedLineWidth('lineWidth')} />
      <LineWidthField label="Outer Wall" value={profile.outerWallLineWidth} fieldKey="outerWallLineWidth" onChange={onChange} overrideClass={oc('outerWallLineWidth')} resetBtnEl={resetBtn('outerWallLineWidth')} autoValue={getAutoLineWidth('outerWallLineWidth')} resolvedValue={getResolvedLineWidth('outerWallLineWidth')} />
      <LineWidthField label="Inner Wall" value={profile.innerWallLineWidth} fieldKey="innerWallLineWidth" onChange={onChange} overrideClass={oc('innerWallLineWidth')} resetBtnEl={resetBtn('innerWallLineWidth')} autoValue={getAutoLineWidth('innerWallLineWidth')} resolvedValue={getResolvedLineWidth('innerWallLineWidth')} />
      <LineWidthField label="Top Surface" value={profile.topSurfaceLineWidth} fieldKey="topSurfaceLineWidth" onChange={onChange} overrideClass={oc('topSurfaceLineWidth')} resetBtnEl={resetBtn('topSurfaceLineWidth')} autoValue={getAutoLineWidth('topSurfaceLineWidth')} resolvedValue={getResolvedLineWidth('topSurfaceLineWidth')} />
      <LineWidthField label="Internal Solid Infill" value={profile.internalSolidInfillLineWidth} fieldKey="internalSolidInfillLineWidth" onChange={onChange} overrideClass={oc('internalSolidInfillLineWidth')} resetBtnEl={resetBtn('internalSolidInfillLineWidth')} autoValue={getAutoLineWidth('internalSolidInfillLineWidth')} resolvedValue={getResolvedLineWidth('internalSolidInfillLineWidth')} />
      <LineWidthField label="Sparse Infill" value={profile.sparseInfillLineWidth} fieldKey="sparseInfillLineWidth" onChange={onChange} overrideClass={oc('sparseInfillLineWidth')} resetBtnEl={resetBtn('sparseInfillLineWidth')} autoValue={getAutoLineWidth('sparseInfillLineWidth')} resolvedValue={getResolvedLineWidth('sparseInfillLineWidth')} />
      <LineWidthField label="Support" value={profile.supportLineWidth} fieldKey="supportLineWidth" onChange={onChange} overrideClass={oc('supportLineWidth')} resetBtnEl={resetBtn('supportLineWidth')} autoValue={getAutoLineWidth('supportLineWidth')} resolvedValue={getResolvedLineWidth('supportLineWidth')} />
      <LineWidthField label="Initial Layer" value={profile.initialLayerLineWidth} fieldKey="initialLayerLineWidth" onChange={onChange} overrideClass={oc('initialLayerLineWidth')} resetBtnEl={resetBtn('initialLayerLineWidth')} autoValue={getAutoLineWidth('initialLayerLineWidth')} resolvedValue={getResolvedLineWidth('initialLayerLineWidth')} />

      {/* Seam */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Seam</h4>
      <label className={`print-dialog-field${oc('seamPosition')}`}>
        <span>Seam Position {resetBtn('seamPosition')}</span>
        <select value={profile.seamPosition}
          onChange={(e) => onChange({ seamPosition: e.target.value as PrintProfile['seamPosition'] })}>
          {SEAM_POSITIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className={`print-dialog-field${oc('seamGap')}`}>
        <span>Seam Gap (mm) {resetBtn('seamGap')}</span>
        <input type="number" value={profile.seamGap} step={0.05} min={0}
          onChange={(e) => onChange({ seamGap: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field print-dialog-field--checkbox${oc('staggeredInnerSeams')}`}>
        <input type="checkbox" checked={profile.staggeredInnerSeams}
          onChange={(e) => onChange({ staggeredInnerSeams: e.target.checked })} />
        <span>Staggered Inner Seams {resetBtn('staggeredInnerSeams')}</span>
      </label>

      {/* Scarf Joint Seam (collapsible) */}
      <details open={scarfOpen} onToggle={(e) => setScarfOpen((e.target as HTMLDetailsElement).open)}>
        <summary style={{ cursor: 'pointer', fontWeight: 'bold', margin: '0.75rem 0 0.25rem' }}>
          Scarf Joint Seam
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingLeft: '0.5rem' }}>
          <label className={`print-dialog-field${oc('seamScarfType')}`}>
            <span>Slope Type {resetBtn('seamScarfType')}</span>
            <select value={profile.seamScarfType}
              onChange={(e) => onChange({ seamScarfType: e.target.value as PrintProfile['seamScarfType'] })}>
              {SEAM_SCARF_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          {profile.seamScarfType !== 'none' && (
            <>
              <label className={`print-dialog-field print-dialog-field--checkbox${oc('scarfSlopeConditional')}`}>
                <input type="checkbox" checked={profile.scarfSlopeConditional}
                  onChange={(e) => onChange({ scarfSlopeConditional: e.target.checked })} />
                <span>Conditional {resetBtn('scarfSlopeConditional')}</span>
              </label>
              <label className={`print-dialog-field${oc('scarfAngleThreshold')}`}>
                <span>Angle Threshold (&deg;) {resetBtn('scarfAngleThreshold')}</span>
                <input type="number" value={profile.scarfAngleThreshold} step={1} min={0} max={180}
                  onChange={(e) => onChange({ scarfAngleThreshold: Number(e.target.value) })} />
              </label>
              <label className={`print-dialog-field${oc('scarfOverhangThreshold')}`}>
                <span>Overhang Threshold (&deg;) {resetBtn('scarfOverhangThreshold')}</span>
                <input type="number" value={profile.scarfOverhangThreshold} step={1} min={0} max={90}
                  onChange={(e) => onChange({ scarfOverhangThreshold: Number(e.target.value) })} />
              </label>
              <label className={`print-dialog-field${oc('scarfJointSpeed')}`}>
                <span>Joint Speed (mm/s) {resetBtn('scarfJointSpeed')}</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input type="number" value={profile.scarfJointSpeed} step={1} min={0}
                    disabled={profile.scarfJointSpeed === 0}
                    style={{ flex: 1, opacity: profile.scarfJointSpeed === 0 ? 0.5 : 1 }}
                    onChange={(e) => onChange({ scarfJointSpeed: Number(e.target.value) })} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={profile.scarfJointSpeed === 0}
                      onChange={(e) => onChange({ scarfJointSpeed: e.target.checked ? 0 : 50 })} />
                    Auto
                  </label>
                </div>
              </label>
              <label className={`print-dialog-field${oc('scarfJointFlowRatio')}`}>
                <span>Flow Ratio {resetBtn('scarfJointFlowRatio')}</span>
                <input type="number" value={profile.scarfJointFlowRatio} step={0.01} min={0.8} max={1.2}
                  onChange={(e) => onChange({ scarfJointFlowRatio: Number(e.target.value) })} />
              </label>
              <label className={`print-dialog-field${oc('scarfStartHeight')}`}>
                <span>Start Height (mm) {resetBtn('scarfStartHeight')}</span>
                <input type="number" value={profile.scarfStartHeight} step={0.1} min={0}
                  onChange={(e) => onChange({ scarfStartHeight: Number(e.target.value) })} />
              </label>
              <label className={`print-dialog-field print-dialog-field--checkbox${oc('scarfEntireLoop')}`}>
                <input type="checkbox" checked={profile.scarfEntireLoop}
                  onChange={(e) => onChange({ scarfEntireLoop: e.target.checked })} />
                <span>Entire Loop {resetBtn('scarfEntireLoop')}</span>
              </label>
              <label className={`print-dialog-field${oc('scarfMinLength')}`}>
                <span>Min Length (mm) {resetBtn('scarfMinLength')}</span>
                <input type="number" value={profile.scarfMinLength} step={1} min={0}
                  onChange={(e) => onChange({ scarfMinLength: Number(e.target.value) })} />
              </label>
              <label className={`print-dialog-field${oc('scarfSteps')}`}>
                <span>Steps {resetBtn('scarfSteps')}</span>
                <input type="number" value={profile.scarfSteps} step={1} min={1} max={50}
                  onChange={(e) => onChange({ scarfSteps: Number(e.target.value) })} />
              </label>
              <label className={`print-dialog-field print-dialog-field--checkbox${oc('scarfInnerWalls')}`}>
                <input type="checkbox" checked={profile.scarfInnerWalls}
                  onChange={(e) => onChange({ scarfInnerWalls: e.target.checked })} />
                <span>Inner Walls {resetBtn('scarfInnerWalls')}</span>
              </label>
            </>
          )}
        </div>
      </details>
    </>
  );
}
