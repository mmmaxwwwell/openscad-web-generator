// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintProfile } from '../../types/print-profile';
import type { PrintSettingsTabProps } from './QualityTab';
import { createOverrideHelpers } from './override-helpers';

const ADHESION_TYPES: Array<{ value: PrintProfile['adhesionType']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'skirt', label: 'Skirt' },
  { value: 'brim', label: 'Brim' },
  { value: 'raft', label: 'Raft' },
];

const BRIM_TYPES: Array<{ value: PrintProfile['brimType']; label: string }> = [
  { value: 'auto_brim', label: 'Auto' },
  { value: 'outer_only', label: 'Outer Only' },
  { value: 'inner_only', label: 'Inner Only' },
  { value: 'outer_and_inner', label: 'Outer and Inner' },
  { value: 'brim_ears', label: 'Brim Ears' },
  { value: 'painted', label: 'Painted' },
];

export function AdhesionTab({ profile, onChange, overrides, onResetField }: PrintSettingsTabProps) {
  const { oc, resetBtn } = createOverrideHelpers(overrides, onResetField);

  return (
    <>
      <label className={`print-dialog-field${oc('adhesionType')}`}>
        <span>Adhesion Type{resetBtn('adhesionType')}</span>
        <select value={profile.adhesionType}
          onChange={(e) => onChange({ adhesionType: e.target.value as PrintProfile['adhesionType'] })}>
          {ADHESION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      {profile.adhesionType === 'skirt' && (
        <>
          <label className={`print-dialog-field${oc('skirtCount')}`}>
            <span>Skirt Loops{resetBtn('skirtCount')}</span>
            <input type="number" value={profile.skirtCount} min={0} max={20}
              onChange={(e) => onChange({ skirtCount: Number(e.target.value) })} />
          </label>
          <label className={`print-dialog-field${oc('skirtDistance')}`}>
            <span>Skirt Distance (mm){resetBtn('skirtDistance')}</span>
            <input type="number" value={profile.skirtDistance} step={0.5} min={0} max={20}
              onChange={(e) => onChange({ skirtDistance: Number(e.target.value) })} />
          </label>
          <label className={`print-dialog-field${oc('skirtSpeed')}`}>
            <span>Skirt Speed (mm/s){resetBtn('skirtSpeed')}</span>
            <input type="number" value={profile.skirtSpeed} step={5} min={0} max={300}
              onChange={(e) => onChange({ skirtSpeed: Number(e.target.value) })} />
          </label>
        </>
      )}

      {profile.adhesionType === 'brim' && (
        <>
          <label className={`print-dialog-field${oc('brimWidth')}`}>
            <span>Brim Width (mm){resetBtn('brimWidth')}</span>
            <input type="number" value={profile.brimWidth} step={0.5} min={0.5} max={30}
              onChange={(e) => onChange({ brimWidth: Number(e.target.value) })} />
          </label>
          <label className={`print-dialog-field${oc('brimType')}`}>
            <span>Brim Type{resetBtn('brimType')}</span>
            <select value={profile.brimType}
              onChange={(e) => onChange({ brimType: e.target.value as PrintProfile['brimType'] })}>
              {BRIM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          {profile.brimType === 'brim_ears' && (
            <>
              <label className={`print-dialog-field${oc('brimEarsDetectionLength')}`}>
                <span>Ears Detection Length (mm){resetBtn('brimEarsDetectionLength')}</span>
                <input type="number" value={profile.brimEarsDetectionLength} step={0.5} min={0.5} max={10}
                  onChange={(e) => onChange({ brimEarsDetectionLength: Number(e.target.value) })} />
              </label>
              <label className={`print-dialog-field${oc('brimEarsMaxAngle')}`}>
                <span>Ears Max Angle (&deg;){resetBtn('brimEarsMaxAngle')}</span>
                <input type="number" value={profile.brimEarsMaxAngle} step={5} min={30} max={180}
                  onChange={(e) => onChange({ brimEarsMaxAngle: Number(e.target.value) })} />
              </label>
            </>
          )}
        </>
      )}

      {profile.adhesionType === 'raft' && (
        <label className={`print-dialog-field${oc('raftLayers')}`}>
          <span>Raft Layers{resetBtn('raftLayers')}</span>
          <input type="number" value={profile.raftLayers} min={1} max={10}
            onChange={(e) => onChange({ raftLayers: Number(e.target.value) })} />
        </label>
      )}
    </>
  );
}
