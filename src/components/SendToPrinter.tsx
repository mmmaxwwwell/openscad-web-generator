import { useCallback, useEffect, useRef, useState } from 'react';
import type { Printer } from '../hooks/usePrinters';

interface SendToPrinterProps {
  printers: Printer[];
  fileBlob: Blob;
  fileName: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

function buildUploadUrl(address: string): string {
  // If the user already provided a protocol, use as-is
  if (/^https?:\/\//.test(address)) {
    // Strip trailing slash then append path
    return `${address.replace(/\/+$/, '')}/server/files/upload`;
  }
  // Default to http:// for bare host:port
  return `http://${address}/server/files/upload`;
}

export async function uploadToMoonraker(address: string, blob: Blob, fileName: string): Promise<void> {
  const url = buildUploadUrl(address);

  // Warn early about mixed content (HTTPS page → HTTP API).
  // The Android WebView injects a native bridge that explicitly permits cleartext traffic,
  // so we check that rather than sniffing the origin string.
  const nativeBridge = (window as any).AndroidPrinterDiscovery;
  const cleartextAllowed = typeof nativeBridge?.allowsCleartextTraffic === 'function'
    && nativeBridge.allowsCleartextTraffic();
  if (!cleartextAllowed && window.location.protocol === 'https:' && url.startsWith('http://')) {
    throw new Error(
      'Mixed content blocked: cannot send to an HTTP printer from an HTTPS page. ' +
      'Either access this app over HTTP, or put Moonraker behind an HTTPS reverse proxy.',
    );
  }

  const formData = new FormData();
  formData.append('file', blob, fileName);

  const response = await fetch(url, {
    method: 'POST',
    mode: 'cors',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Upload failed (${response.status}): ${text || response.statusText}`);
  }
}

export function SendToPrinter({ printers, fileBlob, fileName, onSuccess, onError }: SendToPrinterProps) {
  const [sending, setSending] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  const handleSend = useCallback(async (printer: Printer) => {
    setShowDropdown(false);
    setSending(true);
    try {
      await uploadToMoonraker(printer.address, fileBlob, fileName);
      onSuccess(`Sent "${fileName}" to ${printer.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      const isCors = message.includes('Failed to fetch') || message.includes('NetworkError');
      const hint = isCors
        ? `\n\nThis may be a CORS issue. Add your origin to cors_domains in moonraker.conf:\ncors_domains:\n  ${window.location.origin}`
        : '';
      onError(`Failed to send to ${printer.name}: ${message}${hint}`);
    } finally {
      setSending(false);
    }
  }, [fileBlob, fileName, onSuccess, onError]);

  const handleClick = useCallback(() => {
    if (printers.length === 1) {
      handleSend(printers[0]);
    } else {
      setShowDropdown((prev) => !prev);
    }
  }, [printers, handleSend]);

  if (printers.length === 0) return null;

  return (
    <div className="send-to-printer" ref={dropdownRef}>
      <button
        className="send-to-printer-btn"
        onClick={handleClick}
        disabled={sending}
      >
        {sending ? 'Sending…' : 'Send to Printer'}
      </button>
      {showDropdown && (
        <div className="send-to-printer-dropdown">
          {printers.map((printer) => (
            <button
              key={printer.id}
              className="send-to-printer-option"
              onClick={() => handleSend(printer)}
            >
              <span className="send-to-printer-option-name">{printer.name}</span>
              <span className="send-to-printer-option-address">{printer.address}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
