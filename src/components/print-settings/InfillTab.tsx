// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintProfile } from '../../types/print-profile';
import type { PrintSettingsTabProps } from './QualityTab';
import { createOverrideHelpers } from './override-helpers';

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

/** Maps InfillTab auto field names to OrcaSlicer config key names */
const INFILL_CONFIG_KEYS: Record<string, string> = {
  sparseInfillLineWidth: 'sparse_infill_line_width',
  bridgeAngle: 'bridge_angle',
  internalBridgeAngle: 'internal_bridge_angle',
};

export function InfillTab({ profile, onChange, overrides, onResetField, autoValues, resolvedConfigs }: PrintSettingsTabProps) {
  const { oc, resetBtn } = createOverrideHelpers(overrides, onResetField);
  const lineWidthIsAuto = profile.sparseInfillLineWidth === 0;

  /** Get post-slice resolved value for an auto field */
  const getResolved = (fieldKey: string): number | undefined => {
    const configKey = INFILL_CONFIG_KEYS[fieldKey];
    if (configKey && resolvedConfigs?.[configKey]) {
      const v = parseFloat(resolvedConfigs[configKey]);
      if (!isNaN(v) && v > 0) return v;
    }
    return undefined;
  };

  /** Get pre-slice auto value approximation */
  const getAuto = (fieldKey: string): number | undefined => {
    if (autoValues?.[fieldKey] !== undefined && autoValues[fieldKey] > 0) {
      return autoValues[fieldKey];
    }
    return undefined;
  };

  return (
    <>
      <h4 className="print-dialog-subheading">Sparse Infill</h4>
      <label className={`print-dialog-field${oc('sparseInfillDensity')}`}>
        <span>Infill Density ({profile.sparseInfillDensity}%){resetBtn('sparseInfillDensity')}</span>
        <input type="range" value={profile.sparseInfillDensity} step={1} min={0} max={100}
          onChange={(e) => onChange({ sparseInfillDensity: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('sparseInfillPattern')}`}>
        <span>Infill Pattern{resetBtn('sparseInfillPattern')}</span>
        <select value={profile.sparseInfillPattern}
          onChange={(e) => onChange({ sparseInfillPattern: e.target.value as PrintProfile['sparseInfillPattern'] })}>
          {INFILL_PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className={`print-dialog-field${oc('infillAngle')}`}>
        <span>Infill Angle (&deg;){resetBtn('infillAngle')}</span>
        <input type="number" value={profile.infillAngle} min={0} max={180}
          onChange={(e) => onChange({ infillAngle: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('infillOverlap')}`}>
        <span>Infill Overlap ({profile.infillOverlap}%){resetBtn('infillOverlap')}</span>
        <input type="range" value={profile.infillOverlap} step={1} min={0} max={80}
          onChange={(e) => onChange({ infillOverlap: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field print-dialog-field--checkbox${oc('infillCombination')}`}>
        <input type="checkbox" checked={profile.infillCombination}
          onChange={(e) => onChange({ infillCombination: e.target.checked })} />
        <span>Infill Combination{resetBtn('infillCombination')}</span>
      </label>
      <label className={`print-dialog-field${oc('sparseInfillLineWidth')}`}>
        <span>Sparse Infill Line Width {lineWidthIsAuto ? '(auto)' : `(${profile.sparseInfillLineWidth} mm)`}{resetBtn('sparseInfillLineWidth')}</span>
        {(() => {
          const resolvedLW = getResolved('sparseInfillLineWidth');
          const autoLW = getAuto('sparseInfillLineWidth') ?? 0.4;
          const displayValue = resolvedLW ?? autoLW;
          const isResolved = resolvedLW !== undefined;
          return (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={lineWidthIsAuto ? displayValue : profile.sparseInfillLineWidth}
                disabled={lineWidthIsAuto} min={0.05} max={2.0} step={0.01}
                style={{ flex: 1, opacity: lineWidthIsAuto ? 0.5 : 1, fontStyle: lineWidthIsAuto ? 'italic' : 'normal' }}
                onChange={(e) => onChange({ sparseInfillLineWidth: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={lineWidthIsAuto}
                  onChange={(e) => onChange({ sparseInfillLineWidth: e.target.checked ? 0 : displayValue })} />
                Auto
                {lineWidthIsAuto && <span style={{ opacity: 0.6, fontSize: '0.85em' }}>{isResolved ? '(resolved)' : '(est.)'}</span>}
              </label>
            </div>
          );
        })()}
      </label>

      <h4 className="print-dialog-subheading">Surface Patterns</h4>
      <label className={`print-dialog-field${oc('topSurfacePattern')}`}>
        <span>Top Surface Pattern{resetBtn('topSurfacePattern')}</span>
        <select value={profile.topSurfacePattern}
          onChange={(e) => onChange({ topSurfacePattern: e.target.value as PrintProfile['topSurfacePattern'] })}>
          {INFILL_PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className={`print-dialog-field${oc('bottomSurfacePattern')}`}>
        <span>Bottom Surface Pattern{resetBtn('bottomSurfacePattern')}</span>
        <select value={profile.bottomSurfacePattern}
          onChange={(e) => onChange({ bottomSurfacePattern: e.target.value as PrintProfile['bottomSurfacePattern'] })}>
          {INFILL_PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className={`print-dialog-field${oc('internalSolidInfillPattern')}`}>
        <span>Internal Solid Infill Pattern{resetBtn('internalSolidInfillPattern')}</span>
        <select value={profile.internalSolidInfillPattern}
          onChange={(e) => onChange({ internalSolidInfillPattern: e.target.value as PrintProfile['internalSolidInfillPattern'] })}>
          {INFILL_PATTERNS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>

      <h4 className="print-dialog-subheading">Bridge</h4>
      <label className={`print-dialog-field${oc('bridgeFlow')}`}>
        <span>Bridge Flow Ratio{resetBtn('bridgeFlow')}</span>
        <input type="number" value={profile.bridgeFlow} min={0.5} max={2.0} step={0.05}
          onChange={(e) => onChange({ bridgeFlow: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('internalBridgeFlow')}`}>
        <span>Internal Bridge Flow Ratio{resetBtn('internalBridgeFlow')}</span>
        <input type="number" value={profile.internalBridgeFlow} min={0.5} max={2.0} step={0.05}
          onChange={(e) => onChange({ internalBridgeFlow: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('bridgeDensity')}`}>
        <span>Bridge Density ({profile.bridgeDensity}%){resetBtn('bridgeDensity')}</span>
        <input type="range" value={profile.bridgeDensity} step={1} min={10} max={100}
          onChange={(e) => onChange({ bridgeDensity: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('internalBridgeDensity')}`}>
        <span>Internal Bridge Density ({profile.internalBridgeDensity}%){resetBtn('internalBridgeDensity')}</span>
        <input type="range" value={profile.internalBridgeDensity} step={1} min={10} max={100}
          onChange={(e) => onChange({ internalBridgeDensity: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('bridgeAngle')}`}>
        <span>Bridge Angle (&deg;){resetBtn('bridgeAngle')}</span>
        {(() => {
          const isAuto = profile.bridgeAngle === 0;
          const resolved = getResolved('bridgeAngle');
          return (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={isAuto ? (resolved ?? '') : profile.bridgeAngle} min={0} max={180}
                disabled={isAuto}
                placeholder={isAuto && !resolved ? 'auto' : undefined}
                style={{ flex: 1, opacity: isAuto ? 0.5 : 1, fontStyle: isAuto ? 'italic' : 'normal' }}
                onChange={(e) => onChange({ bridgeAngle: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={isAuto}
                  onChange={(e) => onChange({ bridgeAngle: e.target.checked ? 0 : (resolved ?? 45) })} />
                Auto
                {isAuto && resolved !== undefined && <span style={{ opacity: 0.6, fontSize: '0.85em' }}>(resolved)</span>}
              </label>
            </div>
          );
        })()}
      </label>
      <label className={`print-dialog-field${oc('internalBridgeAngle')}`}>
        <span>Internal Bridge Angle (&deg;){resetBtn('internalBridgeAngle')}</span>
        {(() => {
          const isAuto = profile.internalBridgeAngle === 0;
          const resolved = getResolved('internalBridgeAngle');
          return (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={isAuto ? (resolved ?? '') : profile.internalBridgeAngle} min={0} max={180}
                disabled={isAuto}
                placeholder={isAuto && !resolved ? 'auto' : undefined}
                style={{ flex: 1, opacity: isAuto ? 0.5 : 1, fontStyle: isAuto ? 'italic' : 'normal' }}
                onChange={(e) => onChange({ internalBridgeAngle: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={isAuto}
                  onChange={(e) => onChange({ internalBridgeAngle: e.target.checked ? 0 : (resolved ?? 45) })} />
                Auto
                {isAuto && resolved !== undefined && <span style={{ opacity: 0.6, fontSize: '0.85em' }}>(resolved)</span>}
              </label>
            </div>
          );
        })()}
      </label>
    </>
  );
}
