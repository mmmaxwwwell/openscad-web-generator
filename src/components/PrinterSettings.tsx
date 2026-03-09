import { useCallback, useState } from 'react';
import type { Printer } from '../hooks/usePrinters';

interface PrinterSettingsProps {
  printers: Printer[];
  onAdd: (name: string, address: string) => void;
  onUpdate: (id: string, name: string, address: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

// Accept either host:port or full URL (http://host:port)
const ADDRESS_PATTERN = /^(https?:\/\/)?[\w.\-]+(:\d+)?(\/.*)?$/;

export function PrinterSettings({ printers, onAdd, onUpdate, onDelete, onClose }: PrinterSettingsProps) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const validate = (n: string, addr: string): string | null => {
    if (!n.trim()) return 'Name is required';
    if (!addr.trim()) return 'Address is required';
    if (!ADDRESS_PATTERN.test(addr.trim())) return 'Address must be host:port or full URL (e.g. 192.168.1.100:7125 or http://192.168.1.100:7125)';
    return null;
  };

  const handleAdd = useCallback(() => {
    const err = validate(name, address);
    if (err) {
      setValidationError(err);
      return;
    }
    onAdd(name.trim(), address.trim());
    setName('');
    setAddress('');
    setValidationError(null);
  }, [name, address, onAdd]);

  const handleStartEdit = useCallback((printer: Printer) => {
    setEditingId(printer.id);
    setEditName(printer.name);
    setEditAddress(printer.address);
    setValidationError(null);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const err = validate(editName, editAddress);
    if (err) {
      setValidationError(err);
      return;
    }
    onUpdate(editingId, editName.trim(), editAddress.trim());
    setEditingId(null);
    setValidationError(null);
  }, [editingId, editName, editAddress, onUpdate]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setValidationError(null);
  }, []);

  return (
    <div className="printer-settings-overlay" onClick={onClose}>
      <div className="printer-settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="printer-settings-header">
          <h3>Moonraker Printers</h3>
          <button className="printer-settings-close" onClick={onClose}>&times;</button>
        </div>

        {printers.length === 0 ? (
          <p className="printer-settings-empty">No printers configured. Add one below.</p>
        ) : (
          <ul className="printer-list">
            {printers.map((printer) => (
              <li key={printer.id} className="printer-list-item">
                {editingId === printer.id ? (
                  <div className="printer-edit-form">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Printer name"
                    />
                    <input
                      type="text"
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      placeholder="host:port"
                    />
                    <div className="printer-edit-actions">
                      <button onClick={handleSaveEdit}>Save</button>
                      <button onClick={handleCancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="printer-info">
                      <span className="printer-name">{printer.name}</span>
                      <span className="printer-address">{printer.address}</span>
                    </div>
                    <div className="printer-actions">
                      <button onClick={() => handleStartEdit(printer)} className="printer-edit-btn">Edit</button>
                      <button onClick={() => onDelete(printer.id)} className="printer-delete-btn">&times;</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {validationError && (
          <div className="printer-validation-error">{validationError}</div>
        )}

        <div className="printer-add-form">
          <h4>Add Printer</h4>
          <div className="printer-add-fields">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Printer name (e.g. Voron 2.4)"
            />
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 192.168.1.100:7125 or http://printer.local:7125"
            />
            <button onClick={handleAdd} className="printer-add-btn">Add Printer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
