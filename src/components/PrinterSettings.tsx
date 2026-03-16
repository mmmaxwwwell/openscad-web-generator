// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useState } from 'react';
import type { Printer } from '../hooks/usePrinters';
import { PRINTER_PROFILES } from '../data/printer-profiles';

interface PrinterSettingsProps {
  printers: Printer[];
  onAdd: (name: string, address: string, profileId?: string, nozzleDiameter?: number) => void;
  onUpdate: (id: string, name: string, address: string, profileId?: string, nozzleDiameter?: number) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

interface DiscoveredPrinter {
  name: string;
  host: string;
  port: number;
  type: string;
}

// Check if Android mDNS bridge is available
function isNativeDiscoveryAvailable(): boolean {
  return typeof (window as any).AndroidPrinterDiscovery?.isAvailable === 'function'
    && (window as any).AndroidPrinterDiscovery.isAvailable();
}

function startNativeDiscovery(): Promise<DiscoveredPrinter[]> {
  return new Promise((resolve) => {
    const callbackName = '__onPrintersDiscovered_' + Date.now();
    (window as any)[callbackName] = (results: DiscoveredPrinter[]) => {
      delete (window as any)[callbackName];
      resolve(results);
    };
    (window as any).AndroidPrinterDiscovery.discoverPrinters(callbackName);
    // Fallback timeout in case native side never calls back
    setTimeout(() => {
      if ((window as any)[callbackName]) {
        delete (window as any)[callbackName];
        resolve([]);
      }
    }, 8000);
  });
}

// Accept either host:port or full URL (http://host:port)
const ADDRESS_PATTERN = /^(https?:\/\/)?[\w.\-]+(:\d+)?(\/.*)?$/;

/** Dropdown for selecting a printer profile (model) */
function ProfileSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Generic / Other</option>
      {PRINTER_PROFILES.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

/** Dropdown for selecting a nozzle size within a printer profile */
function NozzleSelect({
  profileId,
  value,
  onChange,
}: {
  profileId: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const profile = PRINTER_PROFILES.find((p) => p.id === profileId);
  if (!profile) return null;

  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {profile.nozzles.map((n) => (
        <option key={n.diameter} value={n.diameter}>
          {n.diameter}mm nozzle
        </option>
      ))}
    </select>
  );
}

export function PrinterSettings({ printers, onAdd, onUpdate, onDelete, onClose }: PrinterSettingsProps) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [profileId, setProfileId] = useState('');
  const [nozzleDiameter, setNozzleDiameter] = useState(0.4);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editProfileId, setEditProfileId] = useState('');
  const [editNozzleDiameter, setEditNozzleDiameter] = useState(0.4);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredPrinter[]>([]);

  const validate = (n: string, addr: string): string | null => {
    if (!n.trim()) return 'Name is required';
    if (!addr.trim()) return 'Address is required';
    if (!ADDRESS_PATTERN.test(addr.trim())) return 'Address must be host:port or full URL (e.g. 192.168.1.100:7125 or http://192.168.1.100:7125)';
    return null;
  };

  const handleProfileChange = (newProfileId: string) => {
    setProfileId(newProfileId);
    // Auto-select default nozzle for the profile
    const profile = PRINTER_PROFILES.find((p) => p.id === newProfileId);
    if (profile) {
      setNozzleDiameter(profile.defaultNozzle);
    }
  };

  const handleEditProfileChange = (newProfileId: string) => {
    setEditProfileId(newProfileId);
    const profile = PRINTER_PROFILES.find((p) => p.id === newProfileId);
    if (profile) {
      setEditNozzleDiameter(profile.defaultNozzle);
    }
  };

  const handleAdd = useCallback(() => {
    const err = validate(name, address);
    if (err) {
      setValidationError(err);
      return;
    }
    onAdd(
      name.trim(),
      address.trim(),
      profileId || undefined,
      profileId ? nozzleDiameter : undefined,
    );
    setName('');
    setAddress('');
    setProfileId('');
    setNozzleDiameter(0.4);
    setValidationError(null);
  }, [name, address, profileId, nozzleDiameter, onAdd]);

  const handleStartEdit = useCallback((printer: Printer) => {
    setEditingId(printer.id);
    setEditName(printer.name);
    setEditAddress(printer.address);
    setEditProfileId(printer.profileId ?? '');
    setEditNozzleDiameter(printer.nozzleDiameter ?? 0.4);
    setValidationError(null);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const err = validate(editName, editAddress);
    if (err) {
      setValidationError(err);
      return;
    }
    onUpdate(
      editingId,
      editName.trim(),
      editAddress.trim(),
      editProfileId || undefined,
      editProfileId ? editNozzleDiameter : undefined,
    );
    setEditingId(null);
    setValidationError(null);
  }, [editingId, editName, editAddress, editProfileId, editNozzleDiameter, onUpdate]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setValidationError(null);
  }, []);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setDiscovered([]);
    try {
      const results = await startNativeDiscovery();
      // Deduplicate by host:port and filter out already-added printers
      const existing = new Set(printers.map((p) => p.address.replace(/^https?:\/\//, '')));
      const unique = new Map<string, DiscoveredPrinter>();
      for (const r of results) {
        const key = `${r.host}:${r.port}`;
        if (!existing.has(key) && !unique.has(key)) {
          unique.set(key, r);
        }
      }
      setDiscovered(Array.from(unique.values()));
    } catch {
      setDiscovered([]);
    } finally {
      setScanning(false);
    }
  }, [printers]);

  const handleAddDiscovered = useCallback((d: DiscoveredPrinter) => {
    onAdd(d.name, `${d.host}:${d.port}`);
    setDiscovered((prev) => prev.filter((p) => !(p.host === d.host && p.port === d.port)));
  }, [onAdd]);

  /** Helper to show profile/nozzle info for a saved printer */
  const profileLabel = (printer: Printer) => {
    if (!printer.profileId) return null;
    const profile = PRINTER_PROFILES.find((p) => p.id === printer.profileId);
    if (!profile) return null;
    const nozzle = printer.nozzleDiameter ?? profile.defaultNozzle;
    return `${profile.name} / ${nozzle}mm`;
  };

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
                    <label className="printer-profile-field">
                      <span>Printer Model</span>
                      <ProfileSelect value={editProfileId} onChange={handleEditProfileChange} />
                    </label>
                    {editProfileId && (
                      <label className="printer-profile-field">
                        <span>Nozzle Size</span>
                        <NozzleSelect
                          profileId={editProfileId}
                          value={editNozzleDiameter}
                          onChange={setEditNozzleDiameter}
                        />
                      </label>
                    )}
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
                      {profileLabel(printer) && (
                        <span className="printer-profile-label">{profileLabel(printer)}</span>
                      )}
                    </div>
                    <div className="printer-actions">
                      <button onClick={() => handleStartEdit(printer)} className="printer-edit-btn">Edit</button>
                      <button onClick={() => { if (window.confirm(`Delete printer "${printer.name}"?`)) onDelete(printer.id); }} className="printer-delete-btn">Delete</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {isNativeDiscoveryAvailable() && (
          <div className="printer-scan-section">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="printer-scan-btn"
            >
              {scanning ? 'Scanning...' : 'Scan Network'}
            </button>
            {discovered.length > 0 && (
              <ul className="printer-scan-results">
                {discovered.map((d) => (
                  <li key={`${d.host}:${d.port}`} className="printer-scan-item">
                    <div className="printer-info">
                      <span className="printer-name">{d.name}</span>
                      <span className="printer-address">{d.host}:{d.port}</span>
                    </div>
                    <button onClick={() => handleAddDiscovered(d)} className="printer-add-btn">Add</button>
                  </li>
                ))}
              </ul>
            )}
            {!scanning && discovered.length === 0 && (
              <p className="printer-scan-empty">No new printers found on the network.</p>
            )}
          </div>
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
            <label className="printer-profile-field">
              <span>Printer Model</span>
              <ProfileSelect value={profileId} onChange={handleProfileChange} />
            </label>
            {profileId && (
              <label className="printer-profile-field">
                <span>Nozzle Size</span>
                <NozzleSelect
                  profileId={profileId}
                  value={nozzleDiameter}
                  onChange={setNozzleDiameter}
                />
              </label>
            )}
            <button onClick={handleAdd} className="printer-add-btn">Add Printer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
