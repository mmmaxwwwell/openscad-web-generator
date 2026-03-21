// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintSettingsTabProps } from './QualityTab';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';
import type { PrinterFilamentOverride } from '../../hooks/usePrinterFilamentOverrides';

const OVERHANG_FAN_THRESHOLDS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Auto (default)' },
  { value: 25, label: '25% overhang' },
  { value: 50, label: '50% overhang' },
  { value: 75, label: '75% overhang' },
  { value: 95, label: '95% overhang' },
];

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

export interface CoolingTabProps extends PrintSettingsTabProps {
  resolved: ResolvedFilamentSettings;
  filamentName: string;
  isOverridden: (field: keyof PrinterFilamentOverride) => boolean;
  updateFilamentField: (field: keyof PrinterFilamentOverride, value: number | boolean) => void;
  resetFilamentField: (field: keyof PrinterFilamentOverride) => void;
}

/**
 * CoolingTab — fan speed, overhang fan, layer cooling, and slow-down settings.
 *
 * Most cooling settings are filament-level and show "From {filament}" hints.
 * Per-printer overrides are supported via the OverridableLabel pattern.
 * The slow-down layers field is process-level (from PrintProfile).
 */
export function CoolingTab({
  profile,
  onChange,
  resolved,
  filamentName,
  isOverridden,
  updateFilamentField,
  resetFilamentField,
}: CoolingTabProps) {
  return (
    <>
      {/* Fan Speed */}
      <label className="print-dialog-field">
        <OverridableLabel
          label={`Fan Min Speed (${resolved.fanSpeed}%)`}
          filamentName={filamentName}
          isOverridden={isOverridden('fanSpeed')}
          onReset={() => resetFilamentField('fanSpeed')}
        />
        <input type="range" value={resolved.fanSpeed} min={0} max={100}
          onChange={(e) => updateFilamentField('fanSpeed', Number(e.target.value))} />
      </label>
      <label className="print-dialog-field">
        <OverridableLabel
          label={`Fan Max Speed (${resolved.fanMaxSpeed}%)`}
          filamentName={filamentName}
          isOverridden={isOverridden('fanMaxSpeed')}
          onReset={() => resetFilamentField('fanMaxSpeed')}
        />
        <input type="range" value={resolved.fanMaxSpeed} min={0} max={100}
          onChange={(e) => updateFilamentField('fanMaxSpeed', Number(e.target.value))} />
      </label>
      <label className="print-dialog-field">
        <OverridableLabel
          label={`First Layer Fan (${resolved.firstLayerFan}%)`}
          filamentName={filamentName}
          isOverridden={isOverridden('firstLayerFan')}
          onReset={() => resetFilamentField('firstLayerFan')}
        />
        <input type="range" value={resolved.firstLayerFan} min={0} max={100}
          onChange={(e) => updateFilamentField('firstLayerFan', Number(e.target.value))} />
      </label>

      {/* Overhang Fan */}
      <h4 className="print-dialog-subheading">Overhang Fan</h4>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={resolved.enableOverhangBridgeFan}
          onChange={(e) => updateFilamentField('enableOverhangBridgeFan', e.target.checked)} />
        <OverridableLabel
          label="Enable Overhang/Bridge Fan"
          filamentName={filamentName}
          isOverridden={isOverridden('enableOverhangBridgeFan')}
          onReset={() => resetFilamentField('enableOverhangBridgeFan')}
        />
      </label>
      <label className="print-dialog-field">
        <OverridableLabel
          label={`Overhang Fan Speed (${resolved.overhangFanSpeed}%)`}
          filamentName={filamentName}
          isOverridden={isOverridden('overhangFanSpeed')}
          onReset={() => resetFilamentField('overhangFanSpeed')}
        />
        <input type="range" value={resolved.overhangFanSpeed} min={0} max={100}
          onChange={(e) => updateFilamentField('overhangFanSpeed', Number(e.target.value))} />
      </label>
      <label className="print-dialog-field">
        <OverridableLabel
          label="Overhang Fan Threshold"
          filamentName={filamentName}
          isOverridden={isOverridden('overhangFanThreshold')}
          onReset={() => resetFilamentField('overhangFanThreshold')}
        />
        <select value={resolved.overhangFanThreshold}
          onChange={(e) => updateFilamentField('overhangFanThreshold', Number(e.target.value))}>
          {OVERHANG_FAN_THRESHOLDS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      {/* Close Fan First Layers */}
      <label className="print-dialog-field">
        <OverridableLabel
          label="Close Fan First X Layers"
          filamentName={filamentName}
          isOverridden={isOverridden('closeFanFirstLayers')}
          onReset={() => resetFilamentField('closeFanFirstLayers')}
        />
        <input type="number" value={resolved.closeFanFirstLayers} min={0} max={20}
          onChange={(e) => updateFilamentField('closeFanFirstLayers', Number(e.target.value))} />
      </label>

      {/* Layer Cooling / Slow Down */}
      <h4 className="print-dialog-subheading">Layer Cooling</h4>
      <label className="print-dialog-field">
        <OverridableLabel
          label="Fan Cooling Layer Time (s)"
          filamentName={filamentName}
          isOverridden={isOverridden('fanCoolingLayerTime')}
          onReset={() => resetFilamentField('fanCoolingLayerTime')}
        />
        <input type="number" value={resolved.fanCoolingLayerTime} min={0} max={120}
          onChange={(e) => updateFilamentField('fanCoolingLayerTime', Number(e.target.value))} />
      </label>
      <label className="print-dialog-field">
        <OverridableLabel
          label="Slow Down Layer Time (s)"
          filamentName={filamentName}
          isOverridden={isOverridden('slowDownLayerTime')}
          onReset={() => resetFilamentField('slowDownLayerTime')}
        />
        <input type="number" value={resolved.slowDownLayerTime} min={0} max={60}
          onChange={(e) => updateFilamentField('slowDownLayerTime', Number(e.target.value))} />
      </label>
      <label className="print-dialog-field">
        <OverridableLabel
          label="Slow Down Min Speed (mm/s)"
          filamentName={filamentName}
          isOverridden={isOverridden('minSpeed')}
          onReset={() => resetFilamentField('minSpeed')}
        />
        <input type="number" value={resolved.minSpeed} min={5} max={100}
          onChange={(e) => updateFilamentField('minSpeed', Number(e.target.value))} />
      </label>
      <label className="print-dialog-field">
        <OverridableLabel
          label="Min Layer Time (s)"
          filamentName={filamentName}
          isOverridden={isOverridden('minLayerTime')}
          onReset={() => resetFilamentField('minLayerTime')}
        />
        <input type="number" value={resolved.minLayerTime} min={0} max={30}
          onChange={(e) => updateFilamentField('minLayerTime', Number(e.target.value))} />
      </label>

      {/* Process-level slow down layers */}
      <label className="print-dialog-field">
        <span>Slow Down Layers</span>
        <input type="number" value={profile.slowDownLayers} min={0} max={20}
          onChange={(e) => onChange({ slowDownLayers: Number(e.target.value) })} />
      </label>
    </>
  );
}
