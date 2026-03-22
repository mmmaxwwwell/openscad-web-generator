// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react';
import type { PrintProfile } from '../../types/print-profile';
import { createOverrideHelpers } from './override-helpers';

export interface PrintSettingsTabProps {
  profile: PrintProfile;
  onChange: (updates: Partial<PrintProfile>) => void;
  /** Per-object overrides — when present, fields in this object are "overridden" (for visual indicators) */
  overrides?: Partial<PrintProfile>;
  /** Reset a single field's override back to plate default */
  onResetField?: (field: keyof PrintProfile) => void;
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

interface LineWidthFieldProps {
  label: string;
  value: number;
  autoValue?: number;
  fieldKey: keyof PrintProfile;
  onChange: (updates: Partial<PrintProfile>) => void;
  overrideClass?: string;
  resetBtnEl?: React.ReactElement | null;
}

function LineWidthField({ label, value, fieldKey, onChange, overrideClass, resetBtnEl, autoValue = 0.4 }: LineWidthFieldProps) {
  const isAuto = value === 0;
  return (
    <label className={`print-dialog-field${overrideClass || ''}`}>
      <span>{label} {isAuto ? '(auto)' : `(${value} mm)`} {resetBtnEl}</span>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="number"
          value={isAuto ? autoValue : value}
          disabled={isAuto}
          step={0.01}
          min={0.05}
          max={2.0}
          style={{ flex: 1, opacity: isAuto ? 0.5 : 1 }}
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
              onChange({ [fieldKey]: e.target.checked ? 0 : autoValue } as Partial<PrintProfile>);
            }}
          />
          Auto
        </label>
      </div>
    </label>
  );
}

export function QualityTab({ profile, onChange, overrides, onResetField }: PrintSettingsTabProps) {
  const { oc, resetBtn } = createOverrideHelpers(overrides, onResetField);
  const [scarfOpen, setScarfOpen] = useState(false);

  return (
    <>
      {/* Layer heights */}
      <label className={`print-dialog-field${oc('layerHeight')}`}>
        <span>Layer Height ({profile.layerHeight} mm) {resetBtn('layerHeight')}</span>
        <input type="range" value={profile.layerHeight} step={0.05} min={0.05} max={0.6}
          onChange={(e) => onChange({ layerHeight: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('initialLayerPrintHeight')}`}>
        <span>First Layer Height (mm) {resetBtn('initialLayerPrintHeight')}</span>
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
      <LineWidthField label="Default" value={profile.lineWidth} fieldKey="lineWidth" onChange={onChange} overrideClass={oc('lineWidth')} resetBtnEl={resetBtn('lineWidth')} />
      <LineWidthField label="Outer Wall" value={profile.outerWallLineWidth} fieldKey="outerWallLineWidth" onChange={onChange} overrideClass={oc('outerWallLineWidth')} resetBtnEl={resetBtn('outerWallLineWidth')} />
      <LineWidthField label="Inner Wall" value={profile.innerWallLineWidth} fieldKey="innerWallLineWidth" onChange={onChange} overrideClass={oc('innerWallLineWidth')} resetBtnEl={resetBtn('innerWallLineWidth')} />
      <LineWidthField label="Top Surface" value={profile.topSurfaceLineWidth} fieldKey="topSurfaceLineWidth" onChange={onChange} overrideClass={oc('topSurfaceLineWidth')} resetBtnEl={resetBtn('topSurfaceLineWidth')} />
      <LineWidthField label="Internal Solid Infill" value={profile.internalSolidInfillLineWidth} fieldKey="internalSolidInfillLineWidth" onChange={onChange} overrideClass={oc('internalSolidInfillLineWidth')} resetBtnEl={resetBtn('internalSolidInfillLineWidth')} />
      <LineWidthField label="Sparse Infill" value={profile.sparseInfillLineWidth} fieldKey="sparseInfillLineWidth" onChange={onChange} overrideClass={oc('sparseInfillLineWidth')} resetBtnEl={resetBtn('sparseInfillLineWidth')} />
      <LineWidthField label="Support" value={profile.supportLineWidth} fieldKey="supportLineWidth" onChange={onChange} overrideClass={oc('supportLineWidth')} resetBtnEl={resetBtn('supportLineWidth')} />
      <LineWidthField label="Initial Layer" value={profile.initialLayerLineWidth} fieldKey="initialLayerLineWidth" onChange={onChange} overrideClass={oc('initialLayerLineWidth')} resetBtnEl={resetBtn('initialLayerLineWidth')} />

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
