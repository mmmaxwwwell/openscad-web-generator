// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrintSettingsTabProps } from './QualityTab';
import { createOverrideHelpers } from './override-helpers';

export interface SpeedTabProps extends PrintSettingsTabProps {
  maxVelocity?: number;
}

export function SpeedTab({ profile, onChange, overrides, onResetField, maxVelocity }: SpeedTabProps) {
  const max = maxVelocity ?? 500;
  const { oc, resetBtn } = createOverrideHelpers(overrides, onResetField);
  return (
    <>
      {/* Per-feature Speeds */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Speeds</h4>
      <label className={`print-dialog-field${oc('outerWallSpeed')}`}>
        <span>Outer Wall (mm/s){resetBtn('outerWallSpeed')}</span>
        <input type="number" value={profile.outerWallSpeed} min={1} max={max}
          onChange={(e) => onChange({ outerWallSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('innerWallSpeed')}`}>
        <span>Inner Wall (mm/s){resetBtn('innerWallSpeed')}</span>
        <input type="number" value={profile.innerWallSpeed} min={1} max={max}
          onChange={(e) => onChange({ innerWallSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('topSurfaceSpeed')}`}>
        <span>Top Surface (mm/s){resetBtn('topSurfaceSpeed')}</span>
        <input type="number" value={profile.topSurfaceSpeed} min={1} max={max}
          onChange={(e) => onChange({ topSurfaceSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('internalSolidInfillSpeed')}`}>
        <span>Internal Solid Infill (mm/s){resetBtn('internalSolidInfillSpeed')}</span>
        <input type="number" value={profile.internalSolidInfillSpeed} min={1} max={max}
          onChange={(e) => onChange({ internalSolidInfillSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('sparseInfillSpeed')}`}>
        <span>Sparse Infill (mm/s){resetBtn('sparseInfillSpeed')}</span>
        <input type="number" value={profile.sparseInfillSpeed} min={1} max={max}
          onChange={(e) => onChange({ sparseInfillSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('gapFillSpeed')}`}>
        <span>Gap Fill (mm/s){resetBtn('gapFillSpeed')}</span>
        <input type="number" value={profile.gapFillSpeed} min={1} max={max}
          onChange={(e) => onChange({ gapFillSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('supportSpeed')}`}>
        <span>Support (mm/s){resetBtn('supportSpeed')}</span>
        <input type="number" value={profile.supportSpeed} min={1} max={max}
          onChange={(e) => onChange({ supportSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('bridgeSpeed')}`}>
        <span>Bridge (mm/s){resetBtn('bridgeSpeed')}</span>
        <input type="number" value={profile.bridgeSpeed} min={1} max={max}
          onChange={(e) => onChange({ bridgeSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('internalBridgeSpeed')}`}>
        <span>Internal Bridge (mm/s){resetBtn('internalBridgeSpeed')}</span>
        <input type="number" value={profile.internalBridgeSpeed} min={1} max={max}
          onChange={(e) => onChange({ internalBridgeSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('smallPerimeterSpeed')}`}>
        <span>Small Perimeter (mm/s){resetBtn('smallPerimeterSpeed')}</span>
        <input type="number" value={profile.smallPerimeterSpeed} min={1} max={max}
          onChange={(e) => onChange({ smallPerimeterSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('smallPerimeterThreshold')}`}>
        <span>Small Perimeter Threshold (mm){resetBtn('smallPerimeterThreshold')}</span>
        <input type="number" value={profile.smallPerimeterThreshold} step={0.5} min={0}
          onChange={(e) => onChange({ smallPerimeterThreshold: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('initialLayerSpeed')}`}>
        <span>Initial Layer (mm/s){resetBtn('initialLayerSpeed')}</span>
        <input type="number" value={profile.initialLayerSpeed} min={1} max={100}
          onChange={(e) => onChange({ initialLayerSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('initialLayerInfillSpeed')}`}>
        <span>Initial Layer Infill (mm/s){resetBtn('initialLayerInfillSpeed')}</span>
        <input type="number" value={profile.initialLayerInfillSpeed} min={1} max={200}
          onChange={(e) => onChange({ initialLayerInfillSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('initialLayerTravelSpeed')}`}>
        <span>Initial Layer Travel (mm/s){resetBtn('initialLayerTravelSpeed')}</span>
        <input type="number" value={profile.initialLayerTravelSpeed} min={1} max={max}
          onChange={(e) => onChange({ initialLayerTravelSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('skirtSpeed')}`}>
        <span>Skirt (mm/s){resetBtn('skirtSpeed')}</span>
        <input type="number" value={profile.skirtSpeed} min={1} max={max}
          onChange={(e) => onChange({ skirtSpeed: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('travelSpeed')}`}>
        <span>Travel (mm/s){resetBtn('travelSpeed')}</span>
        <input type="number" value={profile.travelSpeed} min={10} max={max}
          onChange={(e) => onChange({ travelSpeed: Number(e.target.value) })} />
      </label>

      {/* Overhang Speed */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Overhang Speed</h4>
      <label className={`print-dialog-field print-dialog-field--checkbox${oc('enableOverhangSpeed')}`}>
        <input type="checkbox" checked={profile.enableOverhangSpeed}
          onChange={(e) => onChange({ enableOverhangSpeed: e.target.checked })} />
        <span>Enable Overhang Speed{resetBtn('enableOverhangSpeed')}</span>
      </label>
      {profile.enableOverhangSpeed && (
        <>
          <label className={`print-dialog-field${oc('overhang1_4Speed')}`}>
            <span>25% Overhang (mm/s){resetBtn('overhang1_4Speed')}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={profile.overhang1_4Speed} min={0} max={max} step={1}
                disabled={profile.overhang1_4Speed === 0}
                style={{ flex: 1, opacity: profile.overhang1_4Speed === 0 ? 0.5 : 1 }}
                onChange={(e) => onChange({ overhang1_4Speed: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={profile.overhang1_4Speed === 0}
                  onChange={(e) => onChange({ overhang1_4Speed: e.target.checked ? 0 : 50 })} />
                Auto
              </label>
            </div>
          </label>
          <label className={`print-dialog-field${oc('overhang2_4Speed')}`}>
            <span>50% Overhang (mm/s){resetBtn('overhang2_4Speed')}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={profile.overhang2_4Speed} min={0} max={max} step={1}
                disabled={profile.overhang2_4Speed === 0}
                style={{ flex: 1, opacity: profile.overhang2_4Speed === 0 ? 0.5 : 1 }}
                onChange={(e) => onChange({ overhang2_4Speed: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={profile.overhang2_4Speed === 0}
                  onChange={(e) => onChange({ overhang2_4Speed: e.target.checked ? 0 : 40 })} />
                Auto
              </label>
            </div>
          </label>
          <label className={`print-dialog-field${oc('overhang3_4Speed')}`}>
            <span>75% Overhang (mm/s){resetBtn('overhang3_4Speed')}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={profile.overhang3_4Speed} min={0} max={max} step={1}
                disabled={profile.overhang3_4Speed === 0}
                style={{ flex: 1, opacity: profile.overhang3_4Speed === 0 ? 0.5 : 1 }}
                onChange={(e) => onChange({ overhang3_4Speed: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={profile.overhang3_4Speed === 0}
                  onChange={(e) => onChange({ overhang3_4Speed: e.target.checked ? 0 : 30 })} />
                Auto
              </label>
            </div>
          </label>
          <label className={`print-dialog-field${oc('overhang4_4Speed')}`}>
            <span>100% Overhang (mm/s){resetBtn('overhang4_4Speed')}</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="number" value={profile.overhang4_4Speed} min={0} max={max} step={1}
                disabled={profile.overhang4_4Speed === 0}
                style={{ flex: 1, opacity: profile.overhang4_4Speed === 0 ? 0.5 : 1 }}
                onChange={(e) => onChange({ overhang4_4Speed: Number(e.target.value) })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={profile.overhang4_4Speed === 0}
                  onChange={(e) => onChange({ overhang4_4Speed: e.target.checked ? 0 : 20 })} />
                Auto
              </label>
            </div>
          </label>
        </>
      )}

      {/* Per-feature Accelerations */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Acceleration</h4>
      <label className={`print-dialog-field${oc('defaultAcceleration')}`}>
        <span>Default (mm/s&sup2;){resetBtn('defaultAcceleration')}</span>
        <input type="number" value={profile.defaultAcceleration} min={0} step={100}
          onChange={(e) => onChange({ defaultAcceleration: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('outerWallAcceleration')}`}>
        <span>Outer Wall (mm/s&sup2;){resetBtn('outerWallAcceleration')}</span>
        <input type="number" value={profile.outerWallAcceleration} min={0} step={100}
          onChange={(e) => onChange({ outerWallAcceleration: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('innerWallAcceleration')}`}>
        <span>Inner Wall (mm/s&sup2;){resetBtn('innerWallAcceleration')}</span>
        <input type="number" value={profile.innerWallAcceleration} min={0} step={100}
          onChange={(e) => onChange({ innerWallAcceleration: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('topSurfaceAcceleration')}`}>
        <span>Top Surface (mm/s&sup2;){resetBtn('topSurfaceAcceleration')}</span>
        <input type="number" value={profile.topSurfaceAcceleration} min={0} step={100}
          onChange={(e) => onChange({ topSurfaceAcceleration: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('bridgeAcceleration')}`}>
        <span>Bridge (mm/s&sup2;){resetBtn('bridgeAcceleration')}</span>
        <input type="number" value={profile.bridgeAcceleration} min={0} step={100}
          onChange={(e) => onChange({ bridgeAcceleration: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('sparseInfillAcceleration')}`}>
        <span>Sparse Infill (mm/s&sup2;){resetBtn('sparseInfillAcceleration')}</span>
        <input type="number" value={profile.sparseInfillAcceleration} min={0} step={100}
          onChange={(e) => onChange({ sparseInfillAcceleration: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('internalSolidInfillAcceleration')}`}>
        <span>Internal Solid Infill (mm/s&sup2;){resetBtn('internalSolidInfillAcceleration')}</span>
        <input type="number" value={profile.internalSolidInfillAcceleration} min={0} step={100}
          onChange={(e) => onChange({ internalSolidInfillAcceleration: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('initialLayerAcceleration')}`}>
        <span>Initial Layer (mm/s&sup2;){resetBtn('initialLayerAcceleration')}</span>
        <input type="number" value={profile.initialLayerAcceleration} min={0} step={100}
          onChange={(e) => onChange({ initialLayerAcceleration: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('travelAcceleration')}`}>
        <span>Travel (mm/s&sup2;){resetBtn('travelAcceleration')}</span>
        <input type="number" value={profile.travelAcceleration} min={0} step={100}
          onChange={(e) => onChange({ travelAcceleration: Number(e.target.value) })} />
      </label>

      {/* Per-feature Jerk */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Jerk</h4>
      <label className={`print-dialog-field${oc('defaultJerk')}`}>
        <span>Default (mm/s){resetBtn('defaultJerk')}</span>
        <input type="number" value={profile.defaultJerk} min={0} step={1}
          onChange={(e) => onChange({ defaultJerk: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('outerWallJerk')}`}>
        <span>Outer Wall (mm/s){resetBtn('outerWallJerk')}</span>
        <input type="number" value={profile.outerWallJerk} min={0} step={1}
          onChange={(e) => onChange({ outerWallJerk: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('innerWallJerk')}`}>
        <span>Inner Wall (mm/s){resetBtn('innerWallJerk')}</span>
        <input type="number" value={profile.innerWallJerk} min={0} step={1}
          onChange={(e) => onChange({ innerWallJerk: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('topSurfaceJerk')}`}>
        <span>Top Surface (mm/s){resetBtn('topSurfaceJerk')}</span>
        <input type="number" value={profile.topSurfaceJerk} min={0} step={1}
          onChange={(e) => onChange({ topSurfaceJerk: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('infillJerk')}`}>
        <span>Infill (mm/s){resetBtn('infillJerk')}</span>
        <input type="number" value={profile.infillJerk} min={0} step={1}
          onChange={(e) => onChange({ infillJerk: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('travelJerk')}`}>
        <span>Travel (mm/s){resetBtn('travelJerk')}</span>
        <input type="number" value={profile.travelJerk} min={0} step={1}
          onChange={(e) => onChange({ travelJerk: Number(e.target.value) })} />
      </label>
      <label className={`print-dialog-field${oc('initialLayerJerk')}`}>
        <span>Initial Layer (mm/s){resetBtn('initialLayerJerk')}</span>
        <input type="number" value={profile.initialLayerJerk} min={0} step={1}
          onChange={(e) => onChange({ initialLayerJerk: Number(e.target.value) })} />
      </label>

      {/* Klipper Accel-to-Decel */}
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Klipper Accel-to-Decel</h4>
      <label className={`print-dialog-field print-dialog-field--checkbox${oc('accelToDecelEnable')}`}>
        <input type="checkbox" checked={profile.accelToDecelEnable}
          onChange={(e) => onChange({ accelToDecelEnable: e.target.checked })} />
        <span>Enable Accel-to-Decel{resetBtn('accelToDecelEnable')}</span>
      </label>
      {profile.accelToDecelEnable && (
        <label className={`print-dialog-field${oc('accelToDecelFactor')}`}>
          <span>Accel-to-Decel Factor (%){resetBtn('accelToDecelFactor')}</span>
          <input type="number" value={profile.accelToDecelFactor} min={1} max={100} step={1}
            onChange={(e) => onChange({ accelToDecelFactor: Number(e.target.value) })} />
        </label>
      )}
    </>
  );
}
