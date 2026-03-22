// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintProfile } from '../../types/print-profile';
import type { PrintSettingsTabProps } from './QualityTab';
import { createOverrideHelpers } from './override-helpers';

const SUPPORT_TYPES: Array<{ value: PrintProfile['supportType']; label: string }> = [
  { value: 'normal_auto', label: 'Normal (Auto)' },
  { value: 'tree_auto', label: 'Tree (Auto)' },
  { value: 'normal_manual', label: 'Normal (Manual)' },
  { value: 'tree_manual', label: 'Tree (Manual)' },
];

const SUPPORT_STYLES: Array<{ value: PrintProfile['supportStyle']; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'grid', label: 'Grid' },
  { value: 'snug', label: 'Snug' },
  { value: 'tree_slim', label: 'Tree Slim' },
  { value: 'tree_strong', label: 'Tree Strong' },
  { value: 'tree_hybrid', label: 'Tree Hybrid' },
  { value: 'organic', label: 'Organic' },
];

const SUPPORT_BASE_PATTERNS: Array<{ value: PrintProfile['supportBasePattern']; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'rectilinear', label: 'Rectilinear' },
  { value: 'rectilinear-grid', label: 'Rectilinear Grid' },
  { value: 'honeycomb', label: 'Honeycomb' },
  { value: 'lightning', label: 'Lightning' },
  { value: 'hollow', label: 'Hollow' },
];

const SUPPORT_INTERFACE_PATTERNS: Array<{ value: PrintProfile['supportInterfacePattern']; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'rectilinear', label: 'Rectilinear' },
  { value: 'concentric', label: 'Concentric' },
  { value: 'rectilinear_interlaced', label: 'Rectilinear Interlaced' },
  { value: 'grid', label: 'Grid' },
];

function isTreeType(type: PrintProfile['supportType']): boolean {
  return type.startsWith('tree_');
}

export function SupportTab({ profile, onChange, overrides, onResetField }: PrintSettingsTabProps) {
  const lineWidthIsAuto = profile.supportLineWidth === 0;
  const { oc, resetBtn } = createOverrideHelpers(overrides, onResetField);

  return (
    <>
      <label className={`print-dialog-field print-dialog-field--checkbox${oc('supportEnabled')}`}>
        <input type="checkbox" checked={profile.supportEnabled}
          onChange={(e) => onChange({ supportEnabled: e.target.checked })} />
        <span>Enable Supports{resetBtn('supportEnabled')}</span>
      </label>
      {profile.supportEnabled && (
        <>
          <label className={`print-dialog-field${oc('supportType')}`}>
            <span>Support Type{resetBtn('supportType')}</span>
            <select value={profile.supportType}
              onChange={(e) => onChange({ supportType: e.target.value as PrintProfile['supportType'] })}>
              {SUPPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className={`print-dialog-field${oc('supportStyle')}`}>
            <span>Support Style{resetBtn('supportStyle')}</span>
            <select value={profile.supportStyle}
              onChange={(e) => onChange({ supportStyle: e.target.value as PrintProfile['supportStyle'] })}>
              {SUPPORT_STYLES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className={`print-dialog-field${oc('supportThresholdAngle')}`}>
            <span>Threshold Angle ({profile.supportThresholdAngle}&deg;){resetBtn('supportThresholdAngle')}</span>
            <input type="range" value={profile.supportThresholdAngle} step={1} min={0} max={90}
              onChange={(e) => onChange({ supportThresholdAngle: Number(e.target.value) })} />
          </label>
          <label className={`print-dialog-field${oc('supportDensity')}`}>
            <span>Support Density ({profile.supportDensity}%){resetBtn('supportDensity')}</span>
            <input type="range" value={profile.supportDensity} step={1} min={0} max={100}
              onChange={(e) => onChange({ supportDensity: Number(e.target.value) })} />
          </label>
          <label className={`print-dialog-field${oc('supportXYOffset')}`}>
            <span>XY Offset (mm){resetBtn('supportXYOffset')}</span>
            <input type="number" value={profile.supportXYOffset} step={0.1} min={0} max={5}
              onChange={(e) => onChange({ supportXYOffset: Number(e.target.value) })} />
          </label>
          <label className={`print-dialog-field${oc('supportZGap')}`}>
            <span>Z Gap (layers){resetBtn('supportZGap')}</span>
            <input type="number" value={profile.supportZGap} min={0} max={10}
              onChange={(e) => onChange({ supportZGap: Number(e.target.value) })} />
          </label>
          <label className={`print-dialog-field print-dialog-field--checkbox${oc('supportOnBuildPlateOnly')}`}>
            <input type="checkbox" checked={profile.supportOnBuildPlateOnly}
              onChange={(e) => onChange({ supportOnBuildPlateOnly: e.target.checked })} />
            <span>On Build Plate Only{resetBtn('supportOnBuildPlateOnly')}</span>
          </label>
          <label className={`print-dialog-field${oc('supportSpeed')}`}>
            <span>Support Speed (mm/s){resetBtn('supportSpeed')}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={profile.supportSpeed} min={0} max={500} step={1}
                disabled={profile.supportSpeed === 0}
                style={{ flex: 1, opacity: profile.supportSpeed === 0 ? 0.5 : 1 }}
                onChange={(e) => onChange({ supportSpeed: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={profile.supportSpeed === 0}
                  onChange={(e) => onChange({ supportSpeed: e.target.checked ? 0 : 50 })} />
                Auto
              </label>
            </div>
          </label>
          <label className={`print-dialog-field${oc('supportLineWidth')}`}>
            <span>Support Line Width {lineWidthIsAuto ? '(auto)' : `(${profile.supportLineWidth} mm)`}{resetBtn('supportLineWidth')}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={lineWidthIsAuto ? 0.4 : profile.supportLineWidth}
                disabled={lineWidthIsAuto} min={0.05} max={2.0} step={0.01}
                style={{ flex: 1, opacity: lineWidthIsAuto ? 0.5 : 1 }}
                onChange={(e) => onChange({ supportLineWidth: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={lineWidthIsAuto}
                  onChange={(e) => onChange({ supportLineWidth: e.target.checked ? 0 : 0.4 })} />
                Auto
              </label>
            </div>
          </label>

          <h4 className="print-dialog-subheading">Support Pattern</h4>
          <label className={`print-dialog-field${oc('supportBasePattern')}`}>
            <span>Base Pattern{resetBtn('supportBasePattern')}</span>
            <select value={profile.supportBasePattern}
              onChange={(e) => onChange({ supportBasePattern: e.target.value as PrintProfile['supportBasePattern'] })}>
              {SUPPORT_BASE_PATTERNS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>

          <h4 className="print-dialog-subheading">Support Interface</h4>
          <label className={`print-dialog-field${oc('supportInterfaceLayers')}`}>
            <span>Interface Top Layers{resetBtn('supportInterfaceLayers')}</span>
            <input type="number" value={profile.supportInterfaceLayers} min={0} max={10}
              onChange={(e) => onChange({ supportInterfaceLayers: Number(e.target.value) })} />
          </label>
          <label className={`print-dialog-field${oc('supportInterfaceBottomLayers')}`}>
            <span>Interface Bottom Layers{resetBtn('supportInterfaceBottomLayers')}</span>
            <input type="number" value={profile.supportInterfaceBottomLayers} min={0} max={10}
              onChange={(e) => onChange({ supportInterfaceBottomLayers: Number(e.target.value) })} />
          </label>
          <label className={`print-dialog-field${oc('supportInterfacePattern')}`}>
            <span>Interface Pattern{resetBtn('supportInterfacePattern')}</span>
            <select value={profile.supportInterfacePattern}
              onChange={(e) => onChange({ supportInterfacePattern: e.target.value as PrintProfile['supportInterfacePattern'] })}>
              {SUPPORT_INTERFACE_PATTERNS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className={`print-dialog-field${oc('supportInterfaceSpacing')}`}>
            <span>Interface Spacing (mm){resetBtn('supportInterfaceSpacing')}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={profile.supportInterfaceSpacing} min={0} max={5} step={0.1}
                disabled={profile.supportInterfaceSpacing === 0}
                style={{ flex: 1, opacity: profile.supportInterfaceSpacing === 0 ? 0.5 : 1 }}
                onChange={(e) => onChange({ supportInterfaceSpacing: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={profile.supportInterfaceSpacing === 0}
                  onChange={(e) => onChange({ supportInterfaceSpacing: e.target.checked ? 0 : 0.3 })} />
                Auto
              </label>
            </div>
          </label>
          <label className={`print-dialog-field${oc('supportInterfaceSpeed')}`}>
            <span>Interface Speed (mm/s){resetBtn('supportInterfaceSpeed')}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={profile.supportInterfaceSpeed} min={0} max={500} step={1}
                disabled={profile.supportInterfaceSpeed === 0}
                style={{ flex: 1, opacity: profile.supportInterfaceSpeed === 0 ? 0.5 : 1 }}
                onChange={(e) => onChange({ supportInterfaceSpeed: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={profile.supportInterfaceSpeed === 0}
                  onChange={(e) => onChange({ supportInterfaceSpeed: e.target.checked ? 0 : 50 })} />
                Auto
              </label>
            </div>
          </label>

          {/* Tree-specific settings */}
          {isTreeType(profile.supportType) && (
            <>
              <h4 className="print-dialog-subheading">Tree Support Settings</h4>
              <p style={{ fontSize: '0.85em', color: '#666', margin: '0.25rem 0 0.5rem' }}>
                These settings apply to tree support types ({SUPPORT_TYPES.find(t => t.value === profile.supportType)?.label}).
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
