// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useState } from 'react';
import type { ScadParamSet, ScadValue } from '../types';

interface ParameterSetSelectorProps {
  /** Default parameter sets parsed from the .scad file. */
  defaultSets: ScadParamSet[];
  /** Custom user-saved parameter sets. */
  customSets: ScadParamSet[];
  /** Apply a parameter set (merges overrides into current values). */
  onApply: (values: Record<string, ScadValue>) => void;
  /** Save current parameters as a named custom set. */
  onSave: (name: string) => void;
  /** Delete a custom parameter set. */
  onDelete: (name: string) => void;
}

export function ParameterSetSelector({
  defaultSets,
  customSets,
  onApply,
  onSave,
  onDelete,
}: ParameterSetSelectorProps) {
  const [newSetName, setNewSetName] = useState('');

  const handleSave = useCallback(() => {
    const name = newSetName.trim();
    if (!name) return;
    onSave(name);
    setNewSetName('');
  }, [newSetName, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
  }, [handleSave]);

  const hasAnySets = defaultSets.length > 0 || customSets.length > 0;

  return (
    <div className="param-set-selector">
      <h3>Parameter Sets</h3>

      {defaultSets.length > 0 && (
        <div className="param-set-group">
          <h4>Defaults (from file)</h4>
          <ul className="param-set-list">
            {defaultSets.map((set) => (
              <li key={`default:${set.name}`} className="param-set-item">
                <button
                  className="param-set-apply-btn"
                  onClick={() => onApply(set.values)}
                  title={`Apply "${set.name}"`}
                >
                  {set.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {customSets.length > 0 && (
        <div className="param-set-group">
          <h4>Custom</h4>
          <ul className="param-set-list">
            {customSets.map((set) => (
              <li key={`custom:${set.name}`} className="param-set-item">
                <button
                  className="param-set-apply-btn"
                  onClick={() => onApply(set.values)}
                  title={`Apply "${set.name}"`}
                >
                  {set.name}
                </button>
                <button
                  className="param-set-delete-btn"
                  onClick={() => onDelete(set.name)}
                  title={`Delete "${set.name}"`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasAnySets && (
        <div className="param-set-empty">No parameter sets available.</div>
      )}

      <div className="param-set-save">
        <input
          type="text"
          placeholder="New set name…"
          value={newSetName}
          onChange={(e) => setNewSetName(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={handleSave} disabled={!newSetName.trim()}>
          Save Current
        </button>
      </div>
    </div>
  );
}
