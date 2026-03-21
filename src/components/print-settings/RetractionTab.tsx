// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintSettingsTabProps } from './QualityTab';
import type { ResolvedFilamentSettings } from '../../hooks/usePrinterFilamentOverrides';
import type { PrinterFilamentOverride } from '../../hooks/usePrinterFilamentOverrides';

const Z_HOP_TYPES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'normal', label: 'Normal' },
  { value: 'slope', label: 'Slope' },
  { value: 'spiral', label: 'Spiral' },
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

export interface RetractionTabProps extends PrintSettingsTabProps {
  resolved: ResolvedFilamentSettings;
  filamentName: string;
  isOverridden: (field: keyof PrinterFilamentOverride) => boolean;
  updateFilamentField: (field: keyof PrinterFilamentOverride, value: number | boolean) => void;
  resetFilamentField: (field: keyof PrinterFilamentOverride) => void;
}

/**
 * RetractionTab — retraction settings combining filament-level overridable
 * fields (retract distance, speed, deretraction speed) with process-level
 * fields (z-hop, wipe, coast, layer change toggle, toolchange retract).
 *
 * Filament-level fields show "From {filament}" hints and allow per-printer
 * overrides via the OverridableLabel pattern (same as CoolingTab).
 */
export function RetractionTab({
  profile,
  onChange,
  resolved,
  filamentName,
  isOverridden,
  updateFilamentField,
  resetFilamentField,
}: RetractionTabProps) {
  return (
    <>
      {/* Filament-level retraction fields */}
      <label className="print-dialog-field">
        <OverridableLabel
          label="Retraction Length (mm)"
          filamentName={filamentName}
          isOverridden={isOverridden('retractDist')}
          onReset={() => resetFilamentField('retractDist')}
        />
        <input type="number" value={resolved.retractDist} step={0.1} min={0} max={15}
          onChange={(e) => updateFilamentField('retractDist', Number(e.target.value))} />
      </label>
      <label className="print-dialog-field">
        <OverridableLabel
          label="Retraction Speed (mm/s)"
          filamentName={filamentName}
          isOverridden={isOverridden('retractSpeed')}
          onReset={() => resetFilamentField('retractSpeed')}
        />
        <input type="number" value={resolved.retractSpeed} min={5} max={120}
          onChange={(e) => updateFilamentField('retractSpeed', Number(e.target.value))} />
      </label>
      <label className="print-dialog-field">
        <OverridableLabel
          label="Deretraction Speed (mm/s)"
          filamentName={filamentName}
          isOverridden={isOverridden('deretractionSpeed')}
          onReset={() => resetFilamentField('deretractionSpeed')}
        />
        <input type="number" value={resolved.deretractionSpeed} min={0} max={120}
          onChange={(e) => updateFilamentField('deretractionSpeed', Number(e.target.value))} />
        <small style={{ color: 'var(--text-dim, #888)' }}>0 = same as retraction speed</small>
      </label>

      {/* Process-level retraction fields */}
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.retractOnLayerChange}
          onChange={(e) => onChange({ retractOnLayerChange: e.target.checked })} />
        <span>Retract on Layer Change</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.useFirmwareRetraction}
          onChange={(e) => onChange({ useFirmwareRetraction: e.target.checked })} />
        <span>Use Firmware Retraction</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.reduceInfillRetraction}
          onChange={(e) => onChange({ reduceInfillRetraction: e.target.checked })} />
        <span>Reduce Infill Retraction</span>
      </label>

      <h4 className="print-dialog-subheading">Z-Hop</h4>
      <label className="print-dialog-field">
        <span>Z-Hop Height (mm)</span>
        <input type="number" value={profile.zHopHeight} step={0.1} min={0} max={5}
          onChange={(e) => onChange({ zHopHeight: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Z-Hop Type</span>
        <select value={profile.zHopType}
          onChange={(e) => onChange({ zHopType: e.target.value as 'auto' | 'normal' | 'slope' | 'spiral' })}>
          {Z_HOP_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      <h4 className="print-dialog-subheading">Wipe &amp; Coast</h4>
      <label className="print-dialog-field">
        <span>Wipe Distance (mm)</span>
        <input type="number" value={profile.wipeDistance} step={0.5} min={0} max={10}
          onChange={(e) => onChange({ wipeDistance: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Coast Distance (mm)</span>
        <input type="number" value={profile.coastDistance} step={0.1} min={0} max={5}
          onChange={(e) => onChange({ coastDistance: Number(e.target.value) })} />
      </label>

      <h4 className="print-dialog-subheading">Toolchange</h4>
      <label className="print-dialog-field">
        <span>Retract Length Toolchange (mm)</span>
        <input type="number" value={profile.retractLengthToolchange} step={0.5} min={0} max={30}
          onChange={(e) => onChange({ retractLengthToolchange: Number(e.target.value) })} />
      </label>
    </>
  );
}
