import { useEffect } from 'react';

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
}

export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div
      className={`toast ${message ? 'toast--visible' : 'toast--hidden'}`}
      onClick={onDismiss}
    >
      {message}
    </div>
  );
}
