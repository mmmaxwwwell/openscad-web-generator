// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintSettingsTabProps } from './QualityTab';

export interface SpeedTabProps extends PrintSettingsTabProps {
  maxVelocity?: number;
}

export function SpeedTab({ profile, onChange, maxVelocity }: SpeedTabProps) {
  const max = maxVelocity ?? 500;
  return (
    <>
      {/* Per-feature Speeds */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Speeds</h4>
      <label className="print-dialog-field">
        <span>Outer Wall (mm/s)</span>
        <input type="number" value={profile.outerWallSpeed} min={1} max={max}
          onChange={(e) => onChange({ outerWallSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Inner Wall (mm/s)</span>
        <input type="number" value={profile.innerWallSpeed} min={1} max={max}
          onChange={(e) => onChange({ innerWallSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Top Surface (mm/s)</span>
        <input type="number" value={profile.topSurfaceSpeed} min={1} max={max}
          onChange={(e) => onChange({ topSurfaceSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Internal Solid Infill (mm/s)</span>
        <input type="number" value={profile.internalSolidInfillSpeed} min={1} max={max}
          onChange={(e) => onChange({ internalSolidInfillSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Sparse Infill (mm/s)</span>
        <input type="number" value={profile.sparseInfillSpeed} min={1} max={max}
          onChange={(e) => onChange({ sparseInfillSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Gap Fill (mm/s)</span>
        <input type="number" value={profile.gapFillSpeed} min={1} max={max}
          onChange={(e) => onChange({ gapFillSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Support (mm/s)</span>
        <input type="number" value={profile.supportSpeed} min={1} max={max}
          onChange={(e) => onChange({ supportSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Bridge (mm/s)</span>
        <input type="number" value={profile.bridgeSpeed} min={1} max={max}
          onChange={(e) => onChange({ bridgeSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Internal Bridge (mm/s)</span>
        <input type="number" value={profile.internalBridgeSpeed} min={1} max={max}
          onChange={(e) => onChange({ internalBridgeSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Small Perimeter (mm/s)</span>
        <input type="number" value={profile.smallPerimeterSpeed} min={1} max={max}
          onChange={(e) => onChange({ smallPerimeterSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Small Perimeter Threshold (mm)</span>
        <input type="number" value={profile.smallPerimeterThreshold} step={0.5} min={0}
          onChange={(e) => onChange({ smallPerimeterThreshold: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Initial Layer (mm/s)</span>
        <input type="number" value={profile.initialLayerSpeed} min={1} max={100}
          onChange={(e) => onChange({ initialLayerSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Initial Layer Infill (mm/s)</span>
        <input type="number" value={profile.initialLayerInfillSpeed} min={1} max={200}
          onChange={(e) => onChange({ initialLayerInfillSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Initial Layer Travel (mm/s)</span>
        <input type="number" value={profile.initialLayerTravelSpeed} min={1} max={max}
          onChange={(e) => onChange({ initialLayerTravelSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Skirt (mm/s)</span>
        <input type="number" value={profile.skirtSpeed} min={1} max={max}
          onChange={(e) => onChange({ skirtSpeed: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Travel (mm/s)</span>
        <input type="number" value={profile.travelSpeed} min={10} max={max}
          onChange={(e) => onChange({ travelSpeed: Number(e.target.value) })} />
      </label>

      {/* Overhang Speed */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Overhang Speed</h4>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.enableOverhangSpeed}
          onChange={(e) => onChange({ enableOverhangSpeed: e.target.checked })} />
        <span>Enable Overhang Speed</span>
      </label>
      {profile.enableOverhangSpeed && (
        <>
          <label className="print-dialog-field">
            <span>25% Overhang (mm/s, 0=auto)</span>
            <input type="number" value={profile.overhang1_4Speed} min={0} max={max} step={1}
              onChange={(e) => onChange({ overhang1_4Speed: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>50% Overhang (mm/s, 0=auto)</span>
            <input type="number" value={profile.overhang2_4Speed} min={0} max={max} step={1}
              onChange={(e) => onChange({ overhang2_4Speed: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>75% Overhang (mm/s, 0=auto)</span>
            <input type="number" value={profile.overhang3_4Speed} min={0} max={max} step={1}
              onChange={(e) => onChange({ overhang3_4Speed: Number(e.target.value) })} />
          </label>
          <label className="print-dialog-field">
            <span>100% Overhang (mm/s, 0=auto)</span>
            <input type="number" value={profile.overhang4_4Speed} min={0} max={max} step={1}
              onChange={(e) => onChange({ overhang4_4Speed: Number(e.target.value) })} />
          </label>
        </>
      )}

      {/* Per-feature Accelerations */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Acceleration</h4>
      <label className="print-dialog-field">
        <span>Default (mm/s&sup2;)</span>
        <input type="number" value={profile.defaultAcceleration} min={0} step={100}
          onChange={(e) => onChange({ defaultAcceleration: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Outer Wall (mm/s&sup2;)</span>
        <input type="number" value={profile.outerWallAcceleration} min={0} step={100}
          onChange={(e) => onChange({ outerWallAcceleration: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Inner Wall (mm/s&sup2;)</span>
        <input type="number" value={profile.innerWallAcceleration} min={0} step={100}
          onChange={(e) => onChange({ innerWallAcceleration: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Top Surface (mm/s&sup2;)</span>
        <input type="number" value={profile.topSurfaceAcceleration} min={0} step={100}
          onChange={(e) => onChange({ topSurfaceAcceleration: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Bridge (mm/s&sup2;)</span>
        <input type="number" value={profile.bridgeAcceleration} min={0} step={100}
          onChange={(e) => onChange({ bridgeAcceleration: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Sparse Infill (mm/s&sup2;)</span>
        <input type="number" value={profile.sparseInfillAcceleration} min={0} step={100}
          onChange={(e) => onChange({ sparseInfillAcceleration: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Internal Solid Infill (mm/s&sup2;)</span>
        <input type="number" value={profile.internalSolidInfillAcceleration} min={0} step={100}
          onChange={(e) => onChange({ internalSolidInfillAcceleration: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Initial Layer (mm/s&sup2;)</span>
        <input type="number" value={profile.initialLayerAcceleration} min={0} step={100}
          onChange={(e) => onChange({ initialLayerAcceleration: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Travel (mm/s&sup2;)</span>
        <input type="number" value={profile.travelAcceleration} min={0} step={100}
          onChange={(e) => onChange({ travelAcceleration: Number(e.target.value) })} />
      </label>

      {/* Per-feature Jerk */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Jerk</h4>
      <label className="print-dialog-field">
        <span>Default (mm/s)</span>
        <input type="number" value={profile.defaultJerk} min={0} step={1}
          onChange={(e) => onChange({ defaultJerk: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Outer Wall (mm/s)</span>
        <input type="number" value={profile.outerWallJerk} min={0} step={1}
          onChange={(e) => onChange({ outerWallJerk: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Inner Wall (mm/s)</span>
        <input type="number" value={profile.innerWallJerk} min={0} step={1}
          onChange={(e) => onChange({ innerWallJerk: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Top Surface (mm/s)</span>
        <input type="number" value={profile.topSurfaceJerk} min={0} step={1}
          onChange={(e) => onChange({ topSurfaceJerk: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Infill (mm/s)</span>
        <input type="number" value={profile.infillJerk} min={0} step={1}
          onChange={(e) => onChange({ infillJerk: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Travel (mm/s)</span>
        <input type="number" value={profile.travelJerk} min={0} step={1}
          onChange={(e) => onChange({ travelJerk: Number(e.target.value) })} />
      </label>
      <label className="print-dialog-field">
        <span>Initial Layer (mm/s)</span>
        <input type="number" value={profile.initialLayerJerk} min={0} step={1}
          onChange={(e) => onChange({ initialLayerJerk: Number(e.target.value) })} />
      </label>

      {/* Klipper Accel-to-Decel */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Klipper Accel-to-Decel</h4>
      <label className="print-dialog-field print-dialog-field--checkbox">
        <input type="checkbox" checked={profile.accelToDecelEnable}
          onChange={(e) => onChange({ accelToDecelEnable: e.target.checked })} />
        <span>Enable Accel-to-Decel</span>
      </label>
      {profile.accelToDecelEnable && (
        <label className="print-dialog-field">
          <span>Accel-to-Decel Factor (%)</span>
          <input type="number" value={profile.accelToDecelFactor} min={1} max={100} step={1}
            onChange={(e) => onChange({ accelToDecelFactor: Number(e.target.value) })} />
        </label>
      )}
    </>
  );
}
