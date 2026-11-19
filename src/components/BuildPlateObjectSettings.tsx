// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useMemo, useState } from 'react';
import type { BuildPlateObject } from '../types/build-plate';
import type { PrintProfile } from '../types/print-profile';
import { mergeObjectSettings } from '../lib/plate-slicer';
import {
  QualityTab,
  WallsTab,
  InfillTab,
  SpeedTab,
  SupportTab,
  AdhesionTab,
  AdvancedTab,
} from './print-settings';

// ── Types ────────────────────────────────────────────────────────────────

export interface BuildPlateObjectSettingsProps {
  object: BuildPlateObject;
  plateProfile: PrintProfile;
  onUpdateOverrides: (updates: Partial<PrintProfile>) => void;
  onClearOverrides: () => void;
  onResetField: (field: keyof PrintProfile) => void;
  onUpdateTransform: (id: string, transform: {
    position?: { x: number; y: number };
    rotation?: number;
    scale?: { x: number; y: number; z: number };
  }) => void;
  onSetExtruder?: (id: string, extruder: number) => void;
  onSetVolumeExtruder?: (id: string, volumeIndex: number, extruder: number) => void;
}

// ── Tab definitions ──────────────────────────────────────────────────────

// Cooling and Retraction tabs are excluded — they require filament-level context
// (ResolvedFilamentSettings, per-printer overrides) which isn't available in
// the build plate per-object flow. Those settings are managed via the filament
// profile and per-printer overrides in the main PrintDialog.
const SETTINGS_TABS = [
  { key: 'quality', label: 'Quality' },
  { key: 'walls', label: 'Walls' },
  { key: 'infill', label: 'Infill' },
  { key: 'speed', label: 'Speed' },
  { key: 'support', label: 'Support' },
  { key: 'adhesion', label: 'Adhesion' },
  { key: 'advanced', label: 'Advanced' },
] as const;

type SettingsTabKey = (typeof SETTINGS_TABS)[number]['key'];

// ── Component ────────────────────────────────────────────────────────────

export function BuildPlateObjectSettings({
  object,
  plateProfile,
  onUpdateOverrides,
  onClearOverrides,
  onResetField,
  onUpdateTransform,
  onSetExtruder,
  onSetVolumeExtruder,
}: BuildPlateObjectSettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('quality');
  const [uniformScale, setUniformScale] = useState(true);

  // Merge plate profile + per-object overrides for display
  const mergedProfile = useMemo(
    () => mergeObjectSettings(plateProfile, object.printOverrides),
    [plateProfile, object.printOverrides],
  );

  // onChange from tab components → only store the override
  const handleOverrideChange = useCallback(
    (updates: Partial<PrintProfile>) => {
      onUpdateOverrides(updates);
    },
    [onUpdateOverrides],
  );

  const overrideCount = object.printOverrides
    ? Object.keys(object.printOverrides).length
    : 0;

  // ── Transform handlers ─────────────────────────────────────────────

  const handlePositionX = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateTransform(object.id, {
        position: { x: parseFloat(e.target.value) || 0, y: object.position.y },
      });
    },
    [object.id, object.position.y, onUpdateTransform],
  );

  const handlePositionY = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateTransform(object.id, {
        position: { x: object.position.x, y: parseFloat(e.target.value) || 0 },
      });
    },
    [object.id, object.position.x, onUpdateTransform],
  );

  const handleRotation = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateTransform(object.id, {
        rotation: parseFloat(e.target.value) || 0,
      });
    },
    [object.id, onUpdateTransform],
  );

  const handleScaleX = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value) || 1;
      onUpdateTransform(object.id, {
        scale: uniformScale
          ? { x: v, y: v, z: v }
          : { x: v, y: object.scale.y, z: object.scale.z },
      });
    },
    [object.id, object.scale, uniformScale, onUpdateTransform],
  );

  const handleScaleY = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value) || 1;
      onUpdateTransform(object.id, {
        scale: { x: object.scale.x, y: v, z: object.scale.z },
      });
    },
    [object.id, object.scale, onUpdateTransform],
  );

  const handleScaleZ = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value) || 1;
      onUpdateTransform(object.id, {
        scale: { x: object.scale.x, y: object.scale.y, z: v },
      });
    },
    [object.id, object.scale, onUpdateTransform],
  );

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="build-plate-object-settings">
      {/* Transform section */}
      <div className="build-plate-transform-section">
        <h4>Position &amp; Transform</h4>
        <div className="build-plate-transform-grid">
          <label>
            X
            <input
              type="number"
              value={Math.round(object.position.x * 10) / 10}
              onChange={handlePositionX}
              step={1}
            />
          </label>
          <label>
            Y
            <input
              type="number"
              value={Math.round(object.position.y * 10) / 10}
              onChange={handlePositionY}
              step={1}
            />
          </label>
          <label>
            Rot
            <input
              type="number"
              value={Math.round(object.rotation * 10) / 10}
              onChange={handleRotation}
              step={15}
            />
          </label>
        </div>
        <div className="build-plate-scale-section">
          <div className="build-plate-scale-header">
            <span>Scale</span>
            <label className="build-plate-uniform-toggle">
              <input
                type="checkbox"
                checked={uniformScale}
                onChange={(e) => setUniformScale(e.target.checked)}
              />
              Uniform
            </label>
          </div>
          <div className="build-plate-transform-grid">
            <label>
              X
              <input
                type="number"
                value={Math.round(object.scale.x * 100) / 100}
                onChange={handleScaleX}
                step={0.1}
                min={0.1}
                max={10}
              />
            </label>
            {!uniformScale && (
              <>
                <label>
                  Y
                  <input
                    type="number"
                    value={Math.round(object.scale.y * 100) / 100}
                    onChange={handleScaleY}
                    step={0.1}
                    min={0.1}
                    max={10}
                  />
                </label>
                <label>
                  Z
                  <input
                    type="number"
                    value={Math.round(object.scale.z * 100) / 100}
                    onChange={handleScaleZ}
                    step={0.1}
                    min={0.1}
                    max={10}
                  />
                </label>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Extruder assignment */}
      {object.colorGroups && object.colorGroups.length > 1 && onSetVolumeExtruder ? (
        <div className="build-plate-extruder-section">
          <h4>Color → Extruder</h4>
          {object.colorGroups.map((cg, i) => {
            const extruder = object.volumeExtruders?.[i] ?? i;
            return (
              <label key={i} className="print-dialog-field print-dialog-extruder-row">
                <span className="print-dialog-color-label">
                  <span
                    className="print-dialog-color-swatch"
                    style={{ backgroundColor: cg.color?.slice(0, 7) || '#888' }}
                  />
                  Color {i + 1}
                </span>
                <select
                  value={extruder}
                  onChange={(e) => onSetVolumeExtruder(object.id, i, Number(e.target.value))}
                >
                  {Array.from({ length: Math.max(object.colorGroups!.length, 4) }, (_, ei) => (
                    <option key={ei} value={ei}>Extruder {ei + 1} (T{ei})</option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      ) : object.colorGroups && onSetExtruder ? (
        <div className="build-plate-extruder-section">
          <h4>Extruder Assignment</h4>
          <label className="print-dialog-field">
            <span>Extruder</span>
            <select
              value={object.extruderAssignment ?? 0}
              onChange={(e) => onSetExtruder(object.id, Number(e.target.value))}
            >
              <option value={0}>Extruder 1 (T0)</option>
              <option value={1}>Extruder 2 (T1)</option>
              <option value={2}>Extruder 3 (T2)</option>
              <option value={3}>Extruder 4 (T3)</option>
            </select>
          </label>
        </div>
      ) : null}

      {/* Override summary + reset */}
      <div className="build-plate-override-summary">
        <div className="build-plate-override-summary-row">
          <span>
            {overrideCount > 0
              ? `${overrideCount} field${overrideCount !== 1 ? 's' : ''} overridden`
              : 'Using plate defaults'}
          </span>
          {overrideCount > 0 && (
            <button
              className="build-plate-btn build-plate-btn--small"
              onClick={onClearOverrides}
            >
              Reset All
            </button>
          )}
        </div>
      </div>

      {/* Settings tabs */}
      <div className="build-plate-settings-tabs">
        <div className="build-plate-settings-tab-bar">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`build-plate-settings-tab ${activeTab === tab.key ? 'build-plate-settings-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="build-plate-settings-tab-content">
          {activeTab === 'quality' && (
            <QualityTab
              profile={mergedProfile}
              onChange={handleOverrideChange}
              overrides={object.printOverrides}
              onResetField={onResetField}
            />
          )}
          {activeTab === 'walls' && (
            <WallsTab
              profile={mergedProfile}
              onChange={handleOverrideChange}
              overrides={object.printOverrides}
              onResetField={onResetField}
            />
          )}
          {activeTab === 'infill' && (
            <InfillTab
              profile={mergedProfile}
              onChange={handleOverrideChange}
              overrides={object.printOverrides}
              onResetField={onResetField}
            />
          )}
          {activeTab === 'speed' && (
            <SpeedTab
              profile={mergedProfile}
              onChange={handleOverrideChange}
              overrides={object.printOverrides}
              onResetField={onResetField}
            />
          )}
          {activeTab === 'support' && (
            <SupportTab
              profile={mergedProfile}
              onChange={handleOverrideChange}
              overrides={object.printOverrides}
              onResetField={onResetField}
            />
          )}
          {activeTab === 'adhesion' && (
            <AdhesionTab
              profile={mergedProfile}
              onChange={handleOverrideChange}
              overrides={object.printOverrides}
              onResetField={onResetField}
            />
          )}
          {activeTab === 'advanced' && (
            <AdvancedTab
              profile={mergedProfile}
              onChange={handleOverrideChange}
              overrides={object.printOverrides}
              onResetField={onResetField}
            />
          )}
        </div>
      </div>
    </div>
  );
}
