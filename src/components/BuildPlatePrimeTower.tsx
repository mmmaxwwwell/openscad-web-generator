// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { PrimeTowerConfig, FlushVolumeConfig } from '../types/build-plate';
import type { BuildPlateObject } from '../types/build-plate';
import {
  computeRecommendedPrimeTowerWidth,
  computePrimeTowerDepth,
  getMaxFlushVolume,
} from '../lib/plate-slicer';

export interface BuildPlatePrimeTowerProps {
  config: PrimeTowerConfig;
  onChange: (updates: Partial<PrimeTowerConfig>) => void;
  objects: BuildPlateObject[];
  bedWidth: number;
  bedDepth: number;
  /** Flush volume config (from build plate) — used to auto-compute tower size */
  flushVolumeConfig?: FlushVolumeConfig;
  /** Default flush volume from print profile (used when no custom matrix) */
  defaultFlushVolume: number;
  /** Layer height from print profile */
  layerHeight: number;
  /** Line width from print profile */
  lineWidth: number;
  /** Number of extruders in use on the plate */
  extruderCount: number;
}

/** Check if the prime tower overlaps any object (simple bounding box check) */
function checkPrimeTowerCollisions(
  config: PrimeTowerConfig,
  objects: BuildPlateObject[],
): string[] {
  if (!config.enabled) return [];

  const warnings: string[] = [];
  const halfWidth = config.width / 2;
  const towerMinX = config.position.x - halfWidth;
  const towerMaxX = config.position.x + halfWidth;
  const towerMinY = config.position.y - halfWidth;
  const towerMaxY = config.position.y + halfWidth;

  // Estimated object size (same as autoArrangeObjects default)
  const estimatedSize = 30;
  const halfObj = estimatedSize / 2;

  for (const obj of objects) {
    const objMinX = obj.position.x - halfObj * obj.scale.x;
    const objMaxX = obj.position.x + halfObj * obj.scale.x;
    const objMinY = obj.position.y - halfObj * obj.scale.y;
    const objMaxY = obj.position.y + halfObj * obj.scale.y;

    const overlaps =
      towerMinX < objMaxX &&
      towerMaxX > objMinX &&
      towerMinY < objMaxY &&
      towerMaxY > objMinY;

    if (overlaps) {
      warnings.push(`Prime tower overlaps "${obj.name}"`);
    }
  }

  return warnings;
}

export function BuildPlatePrimeTower({
  config,
  onChange,
  objects,
  bedWidth,
  bedDepth,
  flushVolumeConfig,
  defaultFlushVolume,
  layerHeight,
  lineWidth,
  extruderCount,
}: BuildPlatePrimeTowerProps) {
  const collisionWarnings = useMemo(
    () => checkPrimeTowerCollisions(config, objects),
    [config, objects],
  );

  // Compute max flush volume from the matrix (or default)
  const maxFlushVolume = useMemo(() => {
    if (flushVolumeConfig && flushVolumeConfig.extruderCount >= 2) {
      return getMaxFlushVolume(
        flushVolumeConfig.matrix,
        flushVolumeConfig.extruderCount,
        flushVolumeConfig.multiplier,
      );
    }
    // No custom matrix — use profile default
    return extruderCount >= 2 ? defaultFlushVolume : 0;
  }, [flushVolumeConfig, defaultFlushVolume, extruderCount]);

  // Compute recommended width and estimated depth
  const recommendedWidth = useMemo(
    () => computeRecommendedPrimeTowerWidth(maxFlushVolume, layerHeight, lineWidth),
    [maxFlushVolume, layerHeight, lineWidth],
  );

  const estimatedDepth = useMemo(
    () => computePrimeTowerDepth(maxFlushVolume, config.width, layerHeight, lineWidth),
    [maxFlushVolume, config.width, layerHeight, lineWidth],
  );

  // Track whether user has manually set the width (don't auto-update if so)
  const userSetWidthRef = useRef(false);

  // Auto-update width when flush volumes change (unless user manually set it)
  const prevRecommendedRef = useRef(recommendedWidth);
  useEffect(() => {
    if (
      config.enabled &&
      extruderCount >= 2 &&
      !userSetWidthRef.current &&
      recommendedWidth !== prevRecommendedRef.current
    ) {
      prevRecommendedRef.current = recommendedWidth;
      onChange({ width: recommendedWidth });
    }
  }, [config.enabled, extruderCount, recommendedWidth, onChange]);

  const handleWidthChange = useCallback(
    (value: number) => {
      userSetWidthRef.current = true;
      onChange({ width: Math.max(10, value) });
    },
    [onChange],
  );

  const handleAutoSize = useCallback(() => {
    userSetWidthRef.current = false;
    onChange({ width: recommendedWidth });
  }, [onChange, recommendedWidth]);

  return (
    <div className="build-plate-prime-tower-config">
      <h4>Prime Tower</h4>

      <div className="print-dialog-field">
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          {' '}Enable prime tower
        </label>
      </div>

      {config.enabled && (
        <>
          <div className="print-dialog-field">
            <label>
              <span>Width (mm)</span>
              <input
                type="number"
                min={10}
                max={Math.min(bedWidth, bedDepth)}
                step={1}
                value={config.width}
                onChange={(e) => handleWidthChange(Number(e.target.value))}
              />
            </label>
            {extruderCount >= 2 && config.width !== recommendedWidth && (
              <button
                className="build-plate-btn"
                onClick={handleAutoSize}
                title={`Auto-size based on flush volumes (${recommendedWidth}mm)`}
                style={{ marginLeft: 8, fontSize: '0.85em', padding: '2px 8px' }}
              >
                Auto ({recommendedWidth}mm)
              </button>
            )}
          </div>

          {extruderCount >= 2 && maxFlushVolume > 0 && (
            <p className="build-plate-override-hint">
              Max flush: {Math.round(maxFlushVolume)} mm³ → est. depth: {estimatedDepth.toFixed(1)} mm
            </p>
          )}

          <div className="print-dialog-field">
            <label>
              <span>Brim Width (mm)</span>
              <input
                type="number"
                min={0}
                max={20}
                step={0.5}
                value={config.brimWidth}
                onChange={(e) => onChange({ brimWidth: Math.max(0, Number(e.target.value)) })}
              />
            </label>
          </div>

          <div className="print-dialog-field">
            <label>
              <span>Position X (mm)</span>
              <input
                type="number"
                step={1}
                value={Math.round(config.position.x * 10) / 10}
                onChange={(e) =>
                  onChange({ position: { ...config.position, x: Number(e.target.value) } })
                }
              />
            </label>
          </div>

          <div className="print-dialog-field">
            <label>
              <span>Position Y (mm)</span>
              <input
                type="number"
                step={1}
                value={Math.round(config.position.y * 10) / 10}
                onChange={(e) =>
                  onChange({ position: { ...config.position, y: Number(e.target.value) } })
                }
              />
            </label>
          </div>

          <p className="build-plate-override-hint">
            Tip: drag the prime tower on the canvas to reposition it.
          </p>

          {collisionWarnings.length > 0 && (
            <div className="build-plate-prime-tower-warnings">
              {collisionWarnings.map((w, i) => (
                <div key={i} className="build-plate-prime-tower-warning">
                  {w}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
