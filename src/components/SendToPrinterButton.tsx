import { useCallback, useEffect, useRef, useState } from 'react';
import type { Printer } from '../hooks/usePrinters';

interface SendToPrinterButtonProps {
  printers: Printer[];
  onSelectPrinter: (printer: Printer) => void;
  disabled?: boolean;
  label?: string;
}

/**
 * Button with optional printer dropdown. When clicked (single printer)
 * or when a printer is selected (multiple), calls onSelectPrinter.
 */
export function SendToPrinterButton({ printers, onSelectPrinter, disabled, label }: SendToPrinterButtonProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const handleClick = useCallback(() => {
    if (printers.length === 1) {
      onSelectPrinter(printers[0]);
    } else {
      setShowDropdown((prev) => !prev);
    }
  }, [printers, onSelectPrinter]);

  const handleSelect = useCallback((printer: Printer) => {
    setShowDropdown(false);
    onSelectPrinter(printer);
  }, [onSelectPrinter]);

  if (printers.length === 0) return null;

  return (
    <div className="send-to-printer" ref={dropdownRef}>
      <button
        className="send-to-printer-btn"
        onClick={handleClick}
        disabled={disabled}
      >
        {label || 'Slice & Send'}
      </button>
      {showDropdown && (
        <div className="send-to-printer-dropdown">
          {printers.map((printer) => (
            <button
              key={printer.id}
              className="send-to-printer-option"
              onClick={() => handleSelect(printer)}
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
