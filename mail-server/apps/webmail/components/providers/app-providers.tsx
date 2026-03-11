'use client';

import { JmapClientProvider } from '@/lib/jmap/provider';

import { ToastRegion, ToastProvider } from '../system/toast-region';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <JmapClientProvider>
      <ToastProvider>
        {children}
        <ToastRegion />
      </ToastProvider>
    </JmapClientProvider>
  );
}
