import { useEffect } from 'react';
import type { ToastMessage } from '../types';

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export default function Toast({ toasts, onDismiss }: ToastProps) {
  useEffect(() => {
    const timers = toasts.map((toast) =>
      setTimeout(() => {
        onDismiss(toast.id);
      }, 2200)
    );
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return <div aria-live="polite" aria-atomic="true" />;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-3 px-3" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto w-[min(90%,320px)] rounded-2xl px-4 py-3 text-sm shadow-lg ${
            toast.tone === 'success'
              ? 'bg-mint-500 text-night'
              : toast.tone === 'warning'
              ? 'bg-amber-500 text-night'
              : toast.tone === 'error'
              ? 'bg-coral-500 text-night'
              : 'bg-night/85 text-textDark'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{toast.message}</span>
            <button
              type="button"
              className="rounded-full bg-white/15 px-2 py-1 text-xs text-night focus:outline-none focus-visible:ring-2 focus-visible:ring-night"
              onClick={() => onDismiss(toast.id)}
            >
              Close
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
