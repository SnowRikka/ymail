'use client';

import { createContext, useContext, useMemo, useState } from 'react';

type ToastEntry = {
  id: number;
  message: string;
};

type ToastContextValue = {
  notify: (message: string) => void;
  toasts: ToastEntry[];
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const value = useMemo<ToastContextValue>(
    () => ({
      notify: (message) => {
        setToasts((current) => [...current, { id: Date.now(), message }].slice(-3));
      },
      toasts,
    }),
    [toasts],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function ToastRegion() {
  const context = useContext(ToastContext);
  const toasts = context?.toasts ?? [];

  return (
    <div aria-atomic="true" aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-50 space-y-3" data-testid="toast-region">
      {toasts.map((toast) => (
        <div
          className="shell-surface rounded-2xl border border-line/70 px-4 py-3 text-sm text-ink shadow-shell"
          key={toast.id}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }

  return context;
}
