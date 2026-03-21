// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintProfile } from '../../types/print-profile';
import type { PrintSettingsTabProps } from './QualityTab';

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

export function SupportTab({ profile, onChange }: PrintSettingsTabProps) {
  const lineWidthIsAuto = profile.supportLineWidth === 0;

  return (
    <>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.supportEnabled}
          onChange={(e) => onChange({ supportEnabled: e.target.checked })} />
        <span>Enable Supports</span>
      </label>
      {profile.supportEnabled && (
        <>
          <label className="print-dialog-field">
            <span>Support Type</span>
            <select value={profile.supportType}
              onChange={(e) => onChange({ supportType: e.target.value as PrintProfile['supportType'] })}>
              {SUPPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="print-dialog-field">
            <span>Support Style</span>
            <select value={profile.supportStyle}
              onChange={(e) => onChange({ supportStyle: e.target.value as PrintProfile['supportStyle'] })}>
              {SUPPORT_STYLES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="print-dialog-field">
            <span>Threshold Angle ({profile.supportThresholdAngle}&deg;)</span>
            <input type="range" value={profile.supportThresholdAngle} step={1} min={0} max={90}
              onChange={(e) => onChange({ supportThresholdAngle: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Support Density ({profile.supportDensity}%)</span>
            <input type="range" value={profile.supportDensity} step={1} min={0} max={100}
              onChange={(e) => onChange({ supportDensity: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>XY Offset (mm)</span>
            <input type="number" value={profile.supportXYOffset} step={0.1} min={0} max={5}
              onChange={(e) => onChange({ supportXYOffset: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Z Gap (layers)</span>
            <input type="number" value={profile.supportZGap} min={0} max={10}
              onChange={(e) => onChange({ supportZGap: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field print-dialog-field--checkbox">
            <input type="checkbox" checked={profile.supportOnBuildPlateOnly}
              onChange={(e) => onChange({ supportOnBuildPlateOnly: e.target.checked })} />
            <span>On Build Plate Only</span>
          </label>
          <label className="print-dialog-field">
            <span>Support Speed (mm/s, 0=auto)</span>
            <input type="number" value={profile.supportSpeed} min={0} max={500} step={1}
              onChange={(e) => onChange({ supportSpeed: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Support Line Width {lineWidthIsAuto ? '(auto)' : `(${profile.supportLineWidth} mm)`}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={!lineWidthIsAuto}
                onChange={(e) => onChange({ supportLineWidth: e.target.checked ? 0.4 : 0 })} />
              {!lineWidthIsAuto && (
                <input type="number" value={profile.supportLineWidth} min={0.1} max={2.0} step={0.01}
                  style={{ width: '5rem' }}
                  onChange={(e) => onChange({ supportLineWidth: Number(e.target.value) })} />
              )}
            </span>
          </label>

          <h4 className="print-dialog-subheading">Support Pattern</h4>
          <label className="print-dialog-field">
            <span>Base Pattern</span>
            <select value={profile.supportBasePattern}
              onChange={(e) => onChange({ supportBasePattern: e.target.value as PrintProfile['supportBasePattern'] })}>
              {SUPPORT_BASE_PATTERNS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>

          <h4 className="print-dialog-subheading">Support Interface</h4>
          <label className="print-dialog-field">
            <span>Interface Top Layers</span>
            <input type="number" value={profile.supportInterfaceLayers} min={0} max={10}
              onChange={(e) => onChange({ supportInterfaceLayers: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Interface Bottom Layers</span>
            <input type="number" value={profile.supportInterfaceBottomLayers} min={0} max={10}
              onChange={(e) => onChange({ supportInterfaceBottomLayers: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Interface Pattern</span>
            <select value={profile.supportInterfacePattern}
              onChange={(e) => onChange({ supportInterfacePattern: e.target.value as PrintProfile['supportInterfacePattern'] })}>
              {SUPPORT_INTERFACE_PATTERNS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="print-dialog-field">
            <span>Interface Spacing (mm, 0=auto)</span>
            <input type="number" value={profile.supportInterfaceSpacing} min={0} max={5} step={0.1}
              onChange={(e) => onChange({ supportInterfaceSpacing: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Interface Speed (mm/s, 0=auto)</span>
            <input type="number" value={profile.supportInterfaceSpeed} min={0} max={500} step={1}
              onChange={(e) => onChange({ supportInterfaceSpeed: Number(e.target.value) })} />
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
