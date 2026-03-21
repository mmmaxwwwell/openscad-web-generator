// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintProfile } from '../../types/print-profile';
import type { PrintSettingsTabProps } from './QualityTab';

const INFILL_PATTERNS: Array<{ value: PrintProfile['sparseInfillPattern']; label: string }> = [
  { value: 'gyroid', label: 'Gyroid' },
  { value: 'grid', label: 'Grid' },
  { value: 'monotonic', label: 'Monotonic' },
  { value: 'monotonicline', label: 'Monotonic Line' },
  { value: 'rectilinear', label: 'Rectilinear' },
  { value: 'alignedrectilinear', label: 'Aligned Rectilinear' },
  { value: 'zigzag', label: 'Zigzag' },
  { value: 'crosszag', label: 'Crosszag' },
  { value: 'lockedzag', label: 'Locked Zag' },
  { value: 'triangles', label: 'Triangles' },
  { value: 'tri-hexagon', label: 'Tri-Hexagon' },
  { value: 'cubic', label: 'Cubic' },
  { value: 'adaptivecubic', label: 'Adaptive Cubic' },
  { value: 'quartercubic', label: 'Quarter Cubic' },
  { value: 'supportcubic', label: 'Support Cubic' },
  { value: 'line', label: 'Lines' },
  { value: 'concentric', label: 'Concentric' },
  { value: 'honeycomb', label: 'Honeycomb' },
  { value: '3dhoneycomb', label: '3D Honeycomb' },
  { value: 'lateral-honeycomb', label: 'Lateral Honeycomb' },
  { value: 'lateral-lattice', label: 'Lateral Lattice' },
  { value: 'crosshatch', label: 'Crosshatch' },
  { value: 'tpmsd', label: 'TPMS Diamond' },
  { value: 'tpmsfk', label: 'TPMS FK' },
  { value: 'lightning', label: 'Lightning' },
  { value: 'hilbertcurve', label: 'Hilbert Curve' },
  { value: 'archimedeanchords', label: 'Archimedean Chords' },
  { value: 'octagramspiral', label: 'Octagram Spiral' },
];

export function InfillTab({ profile, onChange }: PrintSettingsTabProps) {
  const lineWidthIsAuto = profile.sparseInfillLineWidth === 0;

  return (
    <>
      <h4 className="print-dialog-subheading">Sparse Infill</h4>
      <label className="print-dialog-field">
        <span>Infill Density ({profile.sparseInfillDensity}%)</span>
        <input type="range" value={profile.sparseInfillDensity} step={1} min={0} max={100}
          onChange={(e) => onChange({ sparseInfillDensity: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Infill Pattern</span>
        <select value={profile.sparseInfillPattern}
          onChange={(e) => onChange({ sparseInfillPattern: e.target.value as PrintProfile['sparseInfillPattern'] })}>
          {INFILL_PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="print-dialog-field">
        <span>Infill Angle (&deg;)</span>
        <input type="number" value={profile.infillAngle} min={0} max={180}
          onChange={(e) => onChange({ infillAngle: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Infill Overlap ({profile.infillOverlap}%)</span>
        <input type="range" value={profile.infillOverlap} step={1} min={0} max={80}
          onChange={(e) => onChange({ infillOverlap: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.infillCombination}
          onChange={(e) => onChange({ infillCombination: e.target.checked })} />
        <span>Infill Combination</span>
      </label>
      <label className="print-dialog-field">
        <span>Sparse Infill Line Width {lineWidthIsAuto ? '(auto)' : `(${profile.sparseInfillLineWidth} mm)`}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" checked={!lineWidthIsAuto}
            onChange={(e) => onChange({ sparseInfillLineWidth: e.target.checked ? 0.4 : 0 })} />
          {!lineWidthIsAuto && (
            <input type="number" value={profile.sparseInfillLineWidth} min={0.1} max={2.0} step={0.01}
              style={{ width: '5rem' }}
              onChange={(e) => onChange({ sparseInfillLineWidth: Number(e.target.value) })} />
          )}
        </span>
      </label>

      <h4 className="print-dialog-subheading">Surface Patterns</h4>
      <label className="print-dialog-field">
        <span>Top Surface Pattern</span>
        <select value={profile.topSurfacePattern}
          onChange={(e) => onChange({ topSurfacePattern: e.target.value as PrintProfile['topSurfacePattern'] })}>
          {INFILL_PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="print-dialog-field">
        <span>Bottom Surface Pattern</span>
        <select value={profile.bottomSurfacePattern}
          onChange={(e) => onChange({ bottomSurfacePattern: e.target.value as PrintProfile['bottomSurfacePattern'] })}>
          {INFILL_PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="print-dialog-field">
        <span>Internal Solid Infill Pattern</span>
        <select value={profile.internalSolidInfillPattern}
          onChange={(e) => onChange({ internalSolidInfillPattern: e.target.value as PrintProfile['internalSolidInfillPattern'] })}>
          {INFILL_PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>

      <h4 className="print-dialog-subheading">Bridge</h4>
      <label className="print-dialog-field">
        <span>Bridge Flow Ratio</span>
        <input type="number" value={profile.bridgeFlow} min={0.5} max={2.0} step={0.05}
          onChange={(e) => onChange({ bridgeFlow: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Internal Bridge Flow Ratio</span>
        <input type="number" value={profile.internalBridgeFlow} min={0.5} max={2.0} step={0.05}
          onChange={(e) => onChange({ internalBridgeFlow: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Bridge Density ({profile.bridgeDensity}%)</span>
        <input type="range" value={profile.bridgeDensity} step={1} min={10} max={100}
          onChange={(e) => onChange({ bridgeDensity: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Internal Bridge Density ({profile.internalBridgeDensity}%)</span>
        <input type="range" value={profile.internalBridgeDensity} step={1} min={10} max={100}
          onChange={(e) => onChange({ internalBridgeDensity: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Bridge Angle (&deg;, 0 = auto)</span>
        <input type="number" value={profile.bridgeAngle} min={0} max={180}
          onChange={(e) => onChange({ bridgeAngle: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Internal Bridge Angle (&deg;, 0 = auto)</span>
        <input type="number" value={profile.internalBridgeAngle} min={0} max={180}
          onChange={(e) => onChange({ internalBridgeAngle: Number(e.target.value) })} />
      </label>
    </>
  );
}
