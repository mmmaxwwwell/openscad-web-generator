// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useMemo } from 'react';
import type { FlushVolumeConfig } from '../types/build-plate';
import type { BuildPlateObject } from '../types/build-plate';

export interface BuildPlateFlushVolumesProps {
  config: FlushVolumeConfig | undefined;
  onChange: (config: FlushVolumeConfig | undefined) => void;
  objects: BuildPlateObject[];
  defaultFlushVolume: number;
}

/**
 * Compute the number of extruders in use on the plate.
 * Accounts for per-volume extruder assignments (multicolor 3MF objects)
 * and per-object extruder assignments (single-color objects).
 */
export function getPlateExtruderCount(objects: BuildPlateObject[]): number {
  let maxExtruder = 0;
  for (const obj of objects) {
    if (obj.colorGroups && obj.colorGroups.length > 1) {
      // Check per-volume assignments, falling back to identity mapping
      for (let i = 0; i < obj.colorGroups.length; i++) {
        const extruder = obj.volumeExtruders?.[i] ?? i;
        maxExtruder = Math.max(maxExtruder, extruder);
      }
    }
    if (obj.extruderAssignment !== undefined) {
      maxExtruder = Math.max(maxExtruder, obj.extruderAssignment);
    }
  }
  // 0-based max index → count
  return maxExtruder + 1;
}

/**
 * Create a default NxN flush volume matrix with the given uniform value.
 * Diagonal = 0, all other cells = defaultVolume.
 */
export function createDefaultMatrix(extruderCount: number, defaultVolume: number): number[] {
  const matrix: number[] = [];
  for (let from = 0; from < extruderCount; from++) {
    for (let to = 0; to < extruderCount; to++) {
      matrix.push(from === to ? 0 : defaultVolume);
    }
  }
  return matrix;
}

/**
 * Resize a flush volume matrix to a new extruder count,
 * preserving existing values and filling new cells with defaults.
 */
function resizeMatrix(
  oldMatrix: number[],
  oldCount: number,
  newCount: number,
  defaultVolume: number,
): number[] {
  const matrix: number[] = [];
  for (let from = 0; from < newCount; from++) {
    for (let to = 0; to < newCount; to++) {
      if (from === to) {
        matrix.push(0);
      } else if (from < oldCount && to < oldCount) {
        matrix.push(oldMatrix[from * oldCount + to]);
      } else {
        matrix.push(defaultVolume);
      }
    }
  }
  return matrix;
}

export function BuildPlateFlushVolumes({
  config,
  onChange,
  objects,
  defaultFlushVolume,
}: BuildPlateFlushVolumesProps) {
  const plateExtruderCount = useMemo(
    () => getPlateExtruderCount(objects),
    [objects],
  );

  // Ensure matrix is sized for current extruder count
  const effectiveConfig = useMemo((): FlushVolumeConfig => {
    if (!config) {
      return {
        matrix: createDefaultMatrix(plateExtruderCount, defaultFlushVolume),
        multiplier: 1.0,
        extruderCount: plateExtruderCount,
      };
    }
    if (config.extruderCount !== plateExtruderCount) {
      return {
        matrix: resizeMatrix(config.matrix, config.extruderCount, plateExtruderCount, defaultFlushVolume),
        multiplier: config.multiplier,
        extruderCount: plateExtruderCount,
      };
    }
    return config;
  }, [config, plateExtruderCount, defaultFlushVolume]);

  // Auto-resize and propagate when extruder count changes
  const { matrix, multiplier, extruderCount } = effectiveConfig;

  const handleCellChange = useCallback(
    (from: number, to: number, value: number) => {
      const newMatrix = [...matrix];
      newMatrix[from * extruderCount + to] = Math.max(0, Math.round(value));
      onChange({ matrix: newMatrix, multiplier, extruderCount });
    },
    [matrix, multiplier, extruderCount, onChange],
  );

  const handleMultiplierChange = useCallback(
    (value: number) => {
      const clamped = Math.max(0, Math.min(3, Math.round(value * 100) / 100));
      onChange({ matrix, multiplier: clamped, extruderCount });
    },
    [matrix, extruderCount, onChange],
  );

  const handleReset = useCallback(() => {
    onChange(undefined);
  }, [onChange]);

  // Extruder labels (colors from objects if available)
  const extruderLabels = useMemo(() => {
    const labels: string[] = [];
    // Collect colors from multicolor objects
    const colors: string[] = [];
    for (const obj of objects) {
      if (obj.colorGroups) {
        for (let i = 0; i < obj.colorGroups.length; i++) {
          if (!colors[i]) colors[i] = obj.colorGroups[i].color;
        }
      }
    }
    for (let i = 0; i < extruderCount; i++) {
      labels.push(colors[i] || `E${i + 1}`);
    }
    return labels;
  }, [objects, extruderCount]);

  // Only show when multiple extruders are in use (after all hooks)
  if (plateExtruderCount < 2) return null;

  return (
    <div className="build-plate-flush-volumes">
      <h4>Flush Volumes</h4>
      <p className="build-plate-override-hint">
        Purge volume (mm³) when switching between extruders.
      </p>

      {/* Matrix grid */}
      <div className="flush-volume-matrix">
        <table className="flush-volume-table">
          <thead>
            <tr>
              <th className="flush-volume-corner">From \ To</th>
              {extruderLabels.map((label, i) => (
                <th key={i} className="flush-volume-header">
                  {label.startsWith('#') ? (
                    <span
                      className="flush-volume-color-dot"
                      style={{ backgroundColor: label }}
                      title={`Extruder ${i + 1}`}
                    />
                  ) : (
                    label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: extruderCount }, (_, from) => (
              <tr key={from}>
                <td className="flush-volume-row-header">
                  {extruderLabels[from].startsWith('#') ? (
                    <span
                      className="flush-volume-color-dot"
                      style={{ backgroundColor: extruderLabels[from] }}
                      title={`Extruder ${from + 1}`}
                    />
                  ) : (
                    extruderLabels[from]
                  )}
                </td>
                {Array.from({ length: extruderCount }, (_, to) => (
                  <td
                    key={to}
                    className={`flush-volume-cell ${from === to ? 'flush-volume-cell--diagonal' : ''}`}
                  >
                    {from === to ? (
                      <span className="flush-volume-diagonal">—</span>
                    ) : (
                      <input
                        type="number"
                        className="flush-volume-input"
                        min={0}
                        max={1000}
                        step={10}
                        value={matrix[from * extruderCount + to]}
                        onChange={(e) =>
                          handleCellChange(from, to, Number(e.target.value))
                        }
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Multiplier */}
      <div className="print-dialog-field flush-volume-multiplier">
        <label>
          <span>Flush Multiplier</span>
          <input
            type="number"
            min={0}
            max={3}
            step={0.1}
            value={multiplier}
            onChange={(e) => handleMultiplierChange(Number(e.target.value))}
          />
        </label>
        <span className="build-plate-override-hint">
          Scales all flush volumes. Effective values = matrix × {multiplier.toFixed(1)}
        </span>
      </div>

      {/* Reset button */}
      {config && (
        <button
          className="build-plate-btn flush-volume-reset"
          onClick={handleReset}
          title="Reset to defaults based on profile flush volume"
        >
          Reset to Defaults
        </button>
      )}
    </div>
  );
}
