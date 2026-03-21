// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintSettingsTabProps } from './QualityTab';
import type { FuzzySkinType, FuzzySkinMode, FuzzySkinNoiseType, IroningType, TimelapseType } from '../../types/print-profile';

const FUZZY_SKIN_TYPES: Array<{ value: FuzzySkinType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'external', label: 'External Only' },
  { value: 'all', label: 'All' },
  { value: 'allwalls', label: 'All Walls' },
];

const FUZZY_SKIN_MODES: Array<{ value: FuzzySkinMode; label: string }> = [
  { value: 'displacement', label: 'Displacement' },
  { value: 'extrusion', label: 'Extrusion' },
  { value: 'combined', label: 'Combined' },
];

const FUZZY_SKIN_NOISE_TYPES: Array<{ value: FuzzySkinNoiseType; label: string }> = [
  { value: 'classic', label: 'Classic' },
  { value: 'perlin', label: 'Perlin' },
  { value: 'billow', label: 'Billow' },
  { value: 'ridged_multi', label: 'Ridged Multi' },
  { value: 'voronoi', label: 'Voronoi' },
];

const IRONING_TYPES: Array<{ value: IroningType; label: string }> = [
  { value: 'no ironing', label: 'No Ironing' },
  { value: 'top', label: 'Top Surfaces' },
  { value: 'topmost', label: 'Topmost Surface Only' },
  { value: 'solid', label: 'All Solid Surfaces' },
];

const TIMELAPSE_TYPES: Array<{ value: TimelapseType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'smooth', label: 'Smooth' },
];


export function AdvancedTab({ profile, onChange }: PrintSettingsTabProps) {
  return (
    <>
      {/* Pressure Advance */}
      <h4 className="print-dialog-subheading">Pressure Advance</h4>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.pressureAdvanceEnable}
          onChange={(e) => onChange({ pressureAdvanceEnable: e.target.checked })} />
        <span>Enable Pressure Advance</span>
      </label>
      {profile.pressureAdvanceEnable && (
        <>
          <label className="print-dialog-field">
            <span>PA Value</span>
            <input type="number" value={profile.pressureAdvanceValue} step={0.001} min={0} max={2}
              onChange={(e) => onChange({ pressureAdvanceValue: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field print-dialog-field--checkbox">
            <input type="checkbox" checked={profile.adaptivePressureAdvance}
              onChange={(e) => onChange({ adaptivePressureAdvance: e.target.checked })} />
            <span>Adaptive Pressure Advance</span>
          </label>
          {profile.adaptivePressureAdvance && (
            <>
              <label className="print-dialog-field">
                <span>Adaptive PA Model Coefficient</span>
                <input type="number" value={profile.adaptivePAModel} step={0.001} min={0} max={1}
                  onChange={(e) => onChange({ adaptivePAModel: Number(e.target.value) })} />
              </label>
              <label className="print-dialog-field print-dialog-field--checkbox">
                <input type="checkbox" checked={profile.adaptivePAOverhangs}
                  onChange={(e) => onChange({ adaptivePAOverhangs: e.target.checked })} />
                <span>Adaptive PA for Overhangs</span>
              </label>
              <label className="print-dialog-field">
                <span>PA Value for Bridges</span>
                <input type="number" value={profile.adaptivePABridges} step={0.001} min={0} max={2}
                  onChange={(e) => onChange({ adaptivePABridges: Number(e.target.value) })} />
              </label>
            </>
          )}
        </>
      )}

      {/* Arc Fitting */}
      <h4 className="print-dialog-subheading">Arc Fitting</h4>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.arcFittingEnable}
          onChange={(e) => onChange({ arcFittingEnable: e.target.checked })} />
        <span>Enable Arc Fitting (G2/G3)</span>
      </label>
      {profile.arcFittingEnable && (
        <label className="print-dialog-field">
          <span>GCode Resolution (mm)</span>
          <input type="number" value={profile.gcodeResolution} step={0.001} min={0.001} max={1}
            onChange={(e) => onChange({ gcodeResolution: Number(e.target.value) })} />
        </label>
      )}

      {/* Fuzzy Skin */}
      <h4 className="print-dialog-subheading">Fuzzy Skin</h4>
      <label className="print-dialog-field">
        <span>Fuzzy Skin Type</span>
        <select value={profile.fuzzySkinType}
          onChange={(e) => onChange({ fuzzySkinType: e.target.value as FuzzySkinType })}>
          {FUZZY_SKIN_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>
      {profile.fuzzySkinType !== 'none' && (
        <>
          <label className="print-dialog-field">
            <span>Fuzzy Skin Mode</span>
            <select value={profile.fuzzySkinMode}
              onChange={(e) => onChange({ fuzzySkinMode: e.target.value as FuzzySkinMode })}>
              {FUZZY_SKIN_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="print-dialog-field">
            <span>Noise Type</span>
            <select value={profile.fuzzySkinNoiseType}
              onChange={(e) => onChange({ fuzzySkinNoiseType: e.target.value as FuzzySkinNoiseType })}>
              {FUZZY_SKIN_NOISE_TYPES.map((n) => (
                <option key={n.value} value={n.value}>{n.label}</option>
              ))}
            </select>
          </label>
          <label className="print-dialog-field">
            <span>Thickness (mm)</span>
            <input type="number" value={profile.fuzzySkinThickness} step={0.05} min={0.01} max={2}
              onChange={(e) => onChange({ fuzzySkinThickness: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Point Distance (mm)</span>
            <input type="number" value={profile.fuzzySkinPointDistance} step={0.1} min={0.1} max={5}
              onChange={(e) => onChange({ fuzzySkinPointDistance: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field print-dialog-field--checkbox">
            <input type="checkbox" checked={profile.fuzzySkinFirstLayer}
              onChange={(e) => onChange({ fuzzySkinFirstLayer: e.target.checked })} />
            <span>Apply to First Layer</span>
          </label>
          <label className="print-dialog-field">
            <span>Scale</span>
            <input type="number" value={profile.fuzzySkinScale} step={0.1} min={0.1} max={10}
              onChange={(e) => onChange({ fuzzySkinScale: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Octaves</span>
            <input type="number" value={profile.fuzzySkinOctaves} step={1} min={1} max={10}
              onChange={(e) => onChange({ fuzzySkinOctaves: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Persistence</span>
            <input type="number" value={profile.fuzzySkinPersistence} step={0.05} min={0} max={1}
              onChange={(e) => onChange({ fuzzySkinPersistence: Number(e.target.value) })} />
          </label>
        </>
      )}

      {/* Ironing */}
      <h4 className="print-dialog-subheading">Ironing</h4>
      <label className="print-dialog-field">
        <span>Ironing Type</span>
        <select value={profile.ironingType}
          onChange={(e) => onChange({ ironingType: e.target.value as IroningType })}>
          {IRONING_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>
      {profile.ironingType !== 'no ironing' && (
        <>
          <label className="print-dialog-field">
            <span>Ironing Flow (%)</span>
            <input type="number" value={profile.ironingFlow} step={1} min={0} max={100}
              onChange={(e) => onChange({ ironingFlow: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Ironing Spacing (mm)</span>
            <input type="number" value={profile.ironingSpacing} step={0.01} min={0.01} max={2}
              onChange={(e) => onChange({ ironingSpacing: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Ironing Speed (mm/s)</span>
            <input type="number" value={profile.ironingSpeed} step={1} min={1} max={100}
              onChange={(e) => onChange({ ironingSpeed: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Ironing Angle (°)</span>
            <input type="number" value={profile.ironingAngle} step={1} min={0} max={359}
              onChange={(e) => onChange({ ironingAngle: Number(e.target.value) })} />
          </label>
        </>
      )}

      {/* Hole-to-Polyhole */}
      <h4 className="print-dialog-subheading">Hole-to-Polyhole</h4>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.holeToPolyhole}
          onChange={(e) => onChange({ holeToPolyhole: e.target.checked })} />
        <span>Enable Hole-to-Polyhole</span>
      </label>
      {profile.holeToPolyhole && (
        <>
          <label className="print-dialog-field">
            <span>Threshold (%)</span>
            <input type="number" value={profile.holeToPolyholeThreshold} step={1} min={0} max={100}
              onChange={(e) => onChange({ holeToPolyholeThreshold: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field print-dialog-field--checkbox">
            <input type="checkbox" checked={profile.holeToPoleholeTwisted}
              onChange={(e) => onChange({ holeToPoleholeTwisted: e.target.checked })} />
            <span>Twisted Polyhole</span>
          </label>
        </>
      )}

      {/* Other Advanced Settings */}
      <h4 className="print-dialog-subheading">Other</h4>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.excludeObject}
          onChange={(e) => onChange({ excludeObject: e.target.checked })} />
        <span>Exclude Object (M486)</span>
      </label>

      {/* Make Overhang Printable */}
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.makeOverhangPrintable}
          onChange={(e) => onChange({ makeOverhangPrintable: e.target.checked })} />
        <span>Make Overhang Printable</span>
      </label>
      {profile.makeOverhangPrintable && (
        <>
          <label className="print-dialog-field">
            <span>Overhang Angle (°)</span>
            <input type="number" value={profile.makeOverhangPrintableAngle} step={1} min={0} max={90}
              onChange={(e) => onChange({ makeOverhangPrintableAngle: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>Overhang Hole Size (mm)</span>
            <input type="number" value={profile.makeOverhangPrintableHoleSize} step={0.1} min={0} max={20}
              onChange={(e) => onChange({ makeOverhangPrintableHoleSize: Number(e.target.value) })} />
          </label>
        </>
      )}

      {/* Max Volumetric Flow Smoothing */}
      <label className="print-dialog-field">
        <span>Max Volumetric Flow Smoothing Rate (mm³/s)</span>
        <input type="number" value={profile.maxVolumetricFlowSmoothingRate} step={0.5} min={0} max={50}
          onChange={(e) => onChange({ maxVolumetricFlowSmoothingRate: Number(e.target.value) })} />
        <small style={{ color: 'var(--text-dim, #888)' }}>0 = disabled</small>
      </label>
      {profile.maxVolumetricFlowSmoothingRate > 0 && (
        <label className="print-dialog-field">
          <span>Smoothing Segment Length (mm)</span>
          <input type="number" value={profile.maxVolumetricFlowSmoothingSegment} step={0.5} min={0.5} max={20}
            onChange={(e) => onChange({ maxVolumetricFlowSmoothingSegment: Number(e.target.value) })} />
        </label>
      )}

      <label className="print-dialog-field">
        <span>Print Flow Ratio</span>
        <input type="number" value={profile.printFlowRatio} step={0.01} min={0.5} max={2}
          onChange={(e) => onChange({ printFlowRatio: Number(e.target.value) })} />
      </label>

      <label className="print-dialog-field">
        <span>Timelapse Type</span>
        <select value={profile.timelapseType}
          onChange={(e) => onChange({ timelapseType: e.target.value as TimelapseType })}>
          {TIMELAPSE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.spiralMode}
          onChange={(e) => onChange({ spiralMode: e.target.checked })} />
        <span>Spiral / Vase Mode</span>
      </label>

      {/* Overhang Reverse */}
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.overhangReverse}
          onChange={(e) => onChange({ overhangReverse: e.target.checked })} />
        <span>Overhang Reverse</span>
      </label>
      {profile.overhangReverse && (
        <label className="print-dialog-field">
          <span>Overhang Reverse Threshold (%)</span>
          <input type="number" value={profile.overhangReverseThreshold} step={5} min={0} max={100}
            onChange={(e) => onChange({ overhangReverseThreshold: Number(e.target.value) })} />
        </label>
      )}

      <label className="print-dialog-field">
        <span>Slow Down for First N Layers</span>
        <input type="number" value={profile.slowDownLayers} step={1} min={0} max={100}
          onChange={(e) => onChange({ slowDownLayers: Number(e.target.value) })} />
      </label>
    </>
  );
}
