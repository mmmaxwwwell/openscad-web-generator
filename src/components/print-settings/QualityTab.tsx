// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react';
import type { PrintProfile } from '../../types/print-profile';

export interface PrintSettingsTabProps {
  profile: PrintProfile;
  onChange: (updates: Partial<PrintProfile>) => void;
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
  fieldKey: keyof PrintProfile;
  onChange: (updates: Partial<PrintProfile>) => void;
}

function LineWidthField({ label, value, fieldKey, onChange }: LineWidthFieldProps) {
  const isAuto = value === 0;
  return (
    <label className="print-dialog-field">
      <span>{label} {isAuto ? '(auto)' : `(${value} mm)`}</span>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="number"
          value={isAuto ? '' : value}
          placeholder="auto"
          step={0.01}
          min={0}
          max={2.0}
          style={{ flex: 1 }}
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
              onChange({ [fieldKey]: e.target.checked ? 0 : 0.4 } as Partial<PrintProfile>);
            }}
          />
          Auto
        </label>
      </div>
    </label>
  );
}

export function QualityTab({ profile, onChange }: PrintSettingsTabProps) {
  const [scarfOpen, setScarfOpen] = useState(false);

  return (
    <>
      {/* Layer heights */}
      <label className="print-dialog-field">
        <span>Layer Height ({profile.layerHeight} mm)</span>
        <input type="range" value={profile.layerHeight} step={0.05} min={0.05} max={0.6}
          onChange={(e) => onChange({ layerHeight: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>First Layer Height (mm)</span>
        <input type="number" value={profile.initialLayerPrintHeight} step={0.05} min={0.1} max={0.6}
          onChange={(e) => onChange({ initialLayerPrintHeight: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.adaptiveLayerHeight}
          onChange={(e) => onChange({ adaptiveLayerHeight: e.target.checked })} />
        <span>Adaptive Layer Height</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.preciseZHeight}
          onChange={(e) => onChange({ preciseZHeight: e.target.checked })} />
        <span>Precise Z Height</span>
      </label>

      {/* Line widths */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Line Widths</h4>
      <LineWidthField label="Default" value={profile.lineWidth} fieldKey="lineWidth" onChange={onChange} />
      <LineWidthField label="Outer Wall" value={profile.outerWallLineWidth} fieldKey="outerWallLineWidth" onChange={onChange} />
      <LineWidthField label="Inner Wall" value={profile.innerWallLineWidth} fieldKey="innerWallLineWidth" onChange={onChange} />
      <LineWidthField label="Top Surface" value={profile.topSurfaceLineWidth} fieldKey="topSurfaceLineWidth" onChange={onChange} />
      <LineWidthField label="Internal Solid Infill" value={profile.internalSolidInfillLineWidth} fieldKey="internalSolidInfillLineWidth" onChange={onChange} />
      <LineWidthField label="Sparse Infill" value={profile.sparseInfillLineWidth} fieldKey="sparseInfillLineWidth" onChange={onChange} />
      <LineWidthField label="Support" value={profile.supportLineWidth} fieldKey="supportLineWidth" onChange={onChange} />
      <LineWidthField label="Initial Layer" value={profile.initialLayerLineWidth} fieldKey="initialLayerLineWidth" onChange={onChange} />

      {/* Seam */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Seam</h4>
      <label className="print-dialog-field">
        <span>Seam Position</span>
        <select value={profile.seamPosition}
          onChange={(e) => onChange({ seamPosition: e.target.value as PrintProfile['seamPosition'] })}>
          {SEAM_POSITIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="print-dialog-field">
        <span>Seam Gap (mm)</span>
        <input type="number" value={profile.seamGap} step={0.05} min={0}
          onChange={(e) => onChange({ seamGap: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.staggeredInnerSeams}
          onChange={(e) => onChange({ staggeredInnerSeams: e.target.checked })} />
        <span>Staggered Inner Seams</span>
      </label>

      {/* Scarf Joint Seam (collapsible) */}
      <details open={scarfOpen} onToggle={(e) => setScarfOpen((e.target as HTMLDetailsElement).open)}>
        <summary style={{ cursor: 'pointer', fontWeight: 'bold', margin: '0.75rem 0 0.25rem' }}>
          Scarf Joint Seam
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingLeft: '0.5rem' }}>
          <label className="print-dialog-field">
            <span>Slope Type</span>
            <select value={profile.seamScarfType}
              onChange={(e) => onChange({ seamScarfType: e.target.value as PrintProfile['seamScarfType'] })}>
              {SEAM_SCARF_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          {profile.seamScarfType !== 'none' && (
            <>
              <label className="print-dialog-field print-dialog-field--checkbox">
                <input type="checkbox" checked={profile.scarfSlopeConditional}
                  onChange={(e) => onChange({ scarfSlopeConditional: e.target.checked })} />
                <span>Conditional</span>
              </label>
              <label className="print-dialog-field">
                <span>Angle Threshold (&deg;)</span>
                <input type="number" value={profile.scarfAngleThreshold} step={1} min={0} max={180}
                  onChange={(e) => onChange({ scarfAngleThreshold: Number(e.target.value) })} />
              </label>
              <label className="print-dialog-field">
                <span>Overhang Threshold (&deg;)</span>
                <input type="number" value={profile.scarfOverhangThreshold} step={1} min={0} max={90}
                  onChange={(e) => onChange({ scarfOverhangThreshold: Number(e.target.value) })} />
              </label>
              <label className="print-dialog-field">
                <span>Joint Speed (mm/s, 0 = auto)</span>
                <input type="number" value={profile.scarfJointSpeed} step={1} min={0}
                  onChange={(e) => onChange({ scarfJointSpeed: Number(e.target.value) })} />
              </label>
              <label className="print-dialog-field">
                <span>Flow Ratio</span>
                <input type="number" value={profile.scarfJointFlowRatio} step={0.01} min={0.8} max={1.2}
                  onChange={(e) => onChange({ scarfJointFlowRatio: Number(e.target.value) })} />
              </label>
              <label className="print-dialog-field">
                <span>Start Height (mm)</span>
                <input type="number" value={profile.scarfStartHeight} step={0.1} min={0}
                  onChange={(e) => onChange({ scarfStartHeight: Number(e.target.value) })} />
              </label>
              <label className="print-dialog-field print-dialog-field--checkbox">
                <input type="checkbox" checked={profile.scarfEntireLoop}
                  onChange={(e) => onChange({ scarfEntireLoop: e.target.checked })} />
                <span>Entire Loop</span>
              </label>
              <label className="print-dialog-field">
                <span>Min Length (mm)</span>
                <input type="number" value={profile.scarfMinLength} step={1} min={0}
                  onChange={(e) => onChange({ scarfMinLength: Number(e.target.value) })} />
              </label>
              <label className="print-dialog-field">
                <span>Steps</span>
                <input type="number" value={profile.scarfSteps} step={1} min={1} max={50}
                  onChange={(e) => onChange({ scarfSteps: Number(e.target.value) })} />
              </label>
              <label className="print-dialog-field print-dialog-field--checkbox">
                <input type="checkbox" checked={profile.scarfInnerWalls}
                  onChange={(e) => onChange({ scarfInnerWalls: e.target.checked })} />
                <span>Inner Walls</span>
              </label>
            </>
          )}
        </div>
      </details>
    </>
  );
}
