import { useCallback, useState } from 'react';
import type { FilamentProfile } from '../hooks/useFilaments';

interface FilamentManagerProps {
  filaments: FilamentProfile[];
  onAdd: (profile: Omit<FilamentProfile, 'id' | 'builtin'>) => void;
  onUpdate: (id: string, updates: Partial<Omit<FilamentProfile, 'id' | 'builtin'>>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onClose: () => void;
}

const FILAMENT_TYPES = ['pla', 'petg', 'tpu', 'asa', 'abs', 'other'] as const;

const EMPTY_PROFILE: Omit<FilamentProfile, 'id' | 'builtin'> = {
  name: '',
  type: 'pla',
  nozzleTemp: 210,
  bedTemp: 60,
  fanSpeed: 100,
  printSpeed: 50,
  retractDist: 4,
  retractSpeed: 45,
  firstLayerNozzleTemp: 210,
  firstLayerBedTemp: 60,
  minSpeed: 20,
  minLayerTime: 6,
  notes: '',
};

function FilamentForm({
  values,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  values: Omit<FilamentProfile, 'id' | 'builtin'>;
  onChange: (updates: Partial<Omit<FilamentProfile, 'id' | 'builtin'>>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="filament-form">
      <div className="filament-form-row">
        <label className="filament-form-field">
          <span>Name</span>
          <input
            type="text"
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. PLA Silk Gold"
          />
        </label>
        <label className="filament-form-field">
          <span>Type</span>
          <select
            value={values.type}
            onChange={(e) => onChange({ type: e.target.value })}
          >
            {FILAMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t.toUpperCase()}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="filament-form-row">
        <label className="filament-form-field">
          <span>Nozzle Temp (°C)</span>
          <input
            type="number"
            value={values.nozzleTemp}
            onChange={(e) => onChange({ nozzleTemp: Number(e.target.value) })}
            min={150}
            max={350}
          />
        </label>
        <label className="filament-form-field">
          <span>Bed Temp (°C)</span>
          <input
            type="number"
            value={values.bedTemp}
            onChange={(e) => onChange({ bedTemp: Number(e.target.value) })}
            min={0}
            max={150}
          />
        </label>
      </div>
      <div className="filament-form-row">
        <label className="filament-form-field">
          <span>Fan Speed (%)</span>
          <input
            type="number"
            value={values.fanSpeed}
            onChange={(e) => onChange({ fanSpeed: Number(e.target.value) })}
            min={0}
            max={100}
          />
        </label>
        <label className="filament-form-field">
          <span>Print Speed (mm/s)</span>
          <input
            type="number"
            value={values.printSpeed}
            onChange={(e) => onChange({ printSpeed: Number(e.target.value) })}
            min={5}
            max={500}
          />
        </label>
      </div>
      <div className="filament-form-row">
        <label className="filament-form-field">
          <span>Retract Dist (mm)</span>
          <input
            type="number"
            value={values.retractDist}
            onChange={(e) => onChange({ retractDist: Number(e.target.value) })}
            min={0}
            max={15}
            step={0.5}
          />
        </label>
        <label className="filament-form-field">
          <span>Retract Speed (mm/s)</span>
          <input
            type="number"
            value={values.retractSpeed}
            onChange={(e) => onChange({ retractSpeed: Number(e.target.value) })}
            min={5}
            max={120}
          />
        </label>
      </div>
      <label className="filament-form-field">
        <span>Notes</span>
        <input
          type="text"
          value={values.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Optional notes"
        />
      </label>
      <div className="filament-form-actions">
        <button onClick={onSubmit} className="filament-save-btn">{submitLabel}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function FilamentManager({ filaments, onAdd, onUpdate, onDelete, onDuplicate, onClose }: FilamentManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Omit<FilamentProfile, 'id' | 'builtin'>>(EMPTY_PROFILE);
  const [addingNew, setAddingNew] = useState(false);
  const [newValues, setNewValues] = useState<Omit<FilamentProfile, 'id' | 'builtin'>>(EMPTY_PROFILE);

  const handleStartEdit = useCallback((f: FilamentProfile) => {
    setEditingId(f.id);
    setEditValues({
      name: f.name,
      type: f.type,
      nozzleTemp: f.nozzleTemp,
      bedTemp: f.bedTemp,
      fanSpeed: f.fanSpeed,
      printSpeed: f.printSpeed,
      retractDist: f.retractDist,
      retractSpeed: f.retractSpeed,
      firstLayerNozzleTemp: f.firstLayerNozzleTemp,
      firstLayerBedTemp: f.firstLayerBedTemp,
      minSpeed: f.minSpeed,
      minLayerTime: f.minLayerTime,
      notes: f.notes,
    });
    setAddingNew(false);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !editValues.name.trim()) return;
    onUpdate(editingId, { ...editValues, name: editValues.name.trim() });
    setEditingId(null);
  }, [editingId, editValues, onUpdate]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleStartAdd = useCallback(() => {
    setAddingNew(true);
    setNewValues(EMPTY_PROFILE);
    setEditingId(null);
  }, []);

  const handleSaveNew = useCallback(() => {
    if (!newValues.name.trim()) return;
    onAdd({ ...newValues, name: newValues.name.trim() });
    setAddingNew(false);
    setNewValues(EMPTY_PROFILE);
  }, [newValues, onAdd]);

  const handleCancelAdd = useCallback(() => {
    setAddingNew(false);
  }, []);

  return (
    <div className="printer-settings-overlay" onClick={onClose}>
      <div className="printer-settings-dialog filament-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="printer-settings-header">
          <h3>Filament Profiles</h3>
          <button className="printer-settings-close" onClick={onClose}>&times;</button>
        </div>

        <ul className="filament-list">
          {filaments.map((f) => (
            <li key={f.id} className="filament-list-item">
              {editingId === f.id ? (
                <FilamentForm
                  values={editValues}
                  onChange={(u) => setEditValues((prev) => ({ ...prev, ...u }))}
                  onSubmit={handleSaveEdit}
                  onCancel={handleCancelEdit}
                  submitLabel="Save"
                />
              ) : (
                <>
                  <div className="filament-info">
                    <div className="filament-header-row">
                      <span className="filament-name">
                        {f.name}
                        {f.builtin && <span className="filament-builtin-badge">built-in</span>}
                      </span>
                    </div>
                    <span className="filament-details">
                      {f.nozzleTemp}°C / {f.bedTemp}°C bed · {f.fanSpeed}% fan · {f.printSpeed} mm/s
                    </span>
                    {f.notes && <span className="filament-notes">{f.notes}</span>}
                  </div>
                  <div className="filament-actions">
                    {!f.builtin && (
                      <button onClick={() => handleStartEdit(f)} className="printer-edit-btn">Edit</button>
                    )}
                    <button onClick={() => onDuplicate(f.id)} className="printer-edit-btn">Copy</button>
                    {!f.builtin && (
                      <button onClick={() => onDelete(f.id)} className="printer-delete-btn">Delete</button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>

        {addingNew ? (
          <div className="filament-add-section">
            <h4>New Filament</h4>
            <FilamentForm
              values={newValues}
              onChange={(u) => setNewValues((prev) => ({ ...prev, ...u }))}
              onSubmit={handleSaveNew}
              onCancel={handleCancelAdd}
              submitLabel="Add"
            />
          </div>
        ) : (
          <button onClick={handleStartAdd} className="printer-add-btn filament-add-btn">
            Add Custom Filament
          </button>
        )}
      </div>
    </div>
  );
}
