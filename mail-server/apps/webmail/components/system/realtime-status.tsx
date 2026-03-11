'use client';

import type { RealtimeStatusState } from '@/lib/realtime/status';

export function RealtimeStatus({ state }: { readonly state: RealtimeStatusState }) {
  return (
    <div aria-atomic="true" aria-live="polite" className="contents">
      <span className="rounded-full border border-line/70 bg-panel/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted" data-testid="sync-status">
        {state.statusLabel}
      </span>
      {state.phase === 'reconnecting' ? (
        <p className="mt-3 text-xs text-accent/90" data-testid="sync-reconnecting">实时通道恢复后会重新执行权威对账。</p>
      ) : null}
      {state.phase === 'error' && state.errorMessage ? (
        <p className="mt-3 text-xs text-amber-300" data-testid="sync-error">{state.errorMessage}</p>
      ) : null}
      {state.toastMessage ? (
        <div className="mt-3 rounded-[20px] border border-accent/25 bg-accent/10 px-4 py-3 text-sm text-ink" data-testid="live-update-toast">
          {state.toastMessage}
        </div>
      ) : null}
    </div>
  );
}
