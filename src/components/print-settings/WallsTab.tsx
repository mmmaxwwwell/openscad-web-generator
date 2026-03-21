// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintProfile } from '../../types/print-profile';
import type { PrintSettingsTabProps } from './QualityTab';

const WALL_DIRECTIONS: Array<{ value: PrintProfile['wallDirection']; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'ccw', label: 'Counter-Clockwise' },
  { value: 'cw', label: 'Clockwise' },
];

const ENSURE_VERTICAL_SHELL: Array<{ value: PrintProfile['ensureVerticalShellThickness']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'ensure_critical_only', label: 'Critical Only' },
  { value: 'ensure_moderate', label: 'Moderate' },
  { value: 'ensure_all', label: 'All' },
];

const WALL_SEQUENCES: Array<{ value: PrintProfile['wallSequence']; label: string }> = [
  { value: 'inner_outer', label: 'Inner \u2192 Outer' },
  { value: 'outer_inner', label: 'Outer \u2192 Inner' },
  { value: 'inner_outer_inner', label: 'Inner \u2192 Outer \u2192 Inner' },
];

const WALL_GENERATORS: Array<{ value: PrintProfile['wallGenerator']; label: string }> = [
  { value: 'classic', label: 'Classic' },
  { value: 'arachne', label: 'Arachne' },
];

export function WallsTab({ profile, onChange }: PrintSettingsTabProps) {
  return (
    <>
      {/* Basic wall settings */}
      <label className="print-dialog-field">
        <span>Wall Loops</span>
        <input type="number" value={profile.wallLoops} min={1} max={20}
          onChange={(e) => onChange({ wallLoops: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Wall Sequence</span>
        <select value={profile.wallSequence}
          onChange={(e) => onChange({ wallSequence: e.target.value as PrintProfile['wallSequence'] })}>
          {WALL_SEQUENCES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>
      <label className="print-dialog-field">
        <span>Wall Generator</span>
        <select value={profile.wallGenerator}
          onChange={(e) => onChange({ wallGenerator: e.target.value as PrintProfile['wallGenerator'] })}>
          {WALL_GENERATORS.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </label>
      <label className="print-dialog-field">
        <span>Wall Direction</span>
        <select value={profile.wallDirection}
          onChange={(e) => onChange({ wallDirection: e.target.value as PrintProfile['wallDirection'] })}>
          {WALL_DIRECTIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </label>
      <label className="print-dialog-field">
        <span>Ensure Vertical Shell Thickness</span>
        <select value={profile.ensureVerticalShellThickness}
          onChange={(e) => onChange({ ensureVerticalShellThickness: e.target.value as PrintProfile['ensureVerticalShellThickness'] })}>
          {ENSURE_VERTICAL_SHELL.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </select>
      </label>

      {/* Top / Bottom layers */}
      <label className="print-dialog-field">
        <span>Top Layers</span>
        <input type="number" value={profile.topLayers} min={0} max={20}
          onChange={(e) => onChange({ topLayers: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Bottom Layers</span>
        <input type="number" value={profile.bottomLayers} min={0} max={20}
          onChange={(e) => onChange({ bottomLayers: Number(e.target.value) })} />
      </label>

      {/* Toggles */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Wall Options</h4>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.isInfillFirst}
          onChange={(e) => onChange({ isInfillFirst: e.target.checked })} />
        <span>Infill Before Walls</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.preciseOuterWall}
          onChange={(e) => onChange({ preciseOuterWall: e.target.checked })} />
        <span>Precise Outer Wall</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.detectThinWall}
          onChange={(e) => onChange({ detectThinWall: e.target.checked })} />
        <span>Detect Thin Wall</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.detectOverhangWall}
          onChange={(e) => onChange({ detectOverhangWall: e.target.checked })} />
        <span>Detect Overhang Wall</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.onlyOneWallFirstLayer}
          onChange={(e) => onChange({ onlyOneWallFirstLayer: e.target.checked })} />
        <span>Only One Wall on First Layer</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.onlyOneWallTop}
          onChange={(e) => onChange({ onlyOneWallTop: e.target.checked })} />
        <span>Only One Wall on Top</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.extraPerimetersOnOverhangs}
          onChange={(e) => onChange({ extraPerimetersOnOverhangs: e.target.checked })} />
        <span>Extra Perimeters on Overhangs</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.staggeredInnerSeams}
          onChange={(e) => onChange({ staggeredInnerSeams: e.target.checked })} />
        <span>Staggered Inner Seams</span>
      </label>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.slowdownForCurledPerimeters}
          onChange={(e) => onChange({ slowdownForCurledPerimeters: e.target.checked })} />
        <span>Slowdown for Curled Perimeters</span>
      </label>

      {/* Arachne settings (conditional) */}
      {profile.wallGenerator === 'arachne' && (
        <>
          <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Arachne Settings</h4>
          <label className="print-dialog-field">
            <span>Min Bead Width (%)</span>
            <input type="number" value={profile.minBeadWidth} min={0} max={100} step={1}
              onChange={(e) => onChange({ minBeadWidth: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Min Feature Size (%)</span>
            <input type="number" value={profile.minFeatureSize} min={0} max={100} step={1}
              onChange={(e) => onChange({ minFeatureSize: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Wall Transition Angle (&deg;)</span>
            <input type="number" value={profile.wallTransitionAngle} min={1} max={180} step={1}
              onChange={(e) => onChange({ wallTransitionAngle: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Wall Transition Filter Deviation (%)</span>
            <input type="number" value={profile.wallTransitionFilterDeviation} min={0} max={100} step={1}
              onChange={(e) => onChange({ wallTransitionFilterDeviation: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Wall Transition Length (%)</span>
            <input type="number" value={profile.wallTransitionLength} min={0} max={200} step={1}
              onChange={(e) => onChange({ wallTransitionLength: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Wall Distribution Count</span>
            <input type="number" value={profile.wallDistributionCount} min={1} max={10} step={1}
              onChange={(e) => onChange({ wallDistributionCount: Number(e.target.value) })} />
          </label>
        </>
      )}
    </>
  );
}
