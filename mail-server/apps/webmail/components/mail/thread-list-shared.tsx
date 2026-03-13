'use client';

import { cn } from '@/lib/utils';

type SharedThreadRow = {
  readonly hasAttachment: boolean;
  readonly id: string;
  readonly isFlagged: boolean;
  readonly isUnread: boolean;
  readonly messageCount: number;
  readonly preview: string;
  readonly relativeTimeLabel: string;
  readonly senderLabel: string;
  readonly subject: string;
};

export interface ThreadRowCardProps<Row extends SharedThreadRow = SharedThreadRow> {
  readonly actions?: React.ReactNode;
  readonly contextLabel?: string | null;
  readonly index: number;
  readonly isSelected: boolean;
  readonly isSelectionChecked?: boolean;
  readonly onSelect: (threadId: string) => void;
  readonly onMoveFocus?: (threadId: string, direction: 'first' | 'last' | 'next' | 'previous') => void;
  readonly onToggleSelection?: (threadId: string, checked: boolean) => void;
  readonly row: Row;
}

export function ThreadRowCard<Row extends SharedThreadRow>({ actions, contextLabel, index, isSelected, isSelectionChecked = false, onMoveFocus, onSelect, onToggleSelection, row }: ThreadRowCardProps<Row>) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!onMoveFocus) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMoveFocus(row.id, 'next');
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMoveFocus(row.id, 'previous');
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      onMoveFocus(row.id, 'first');
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      onMoveFocus(row.id, 'last');
    }
  };

  return (
    <div className="stage-reveal" style={{ ['--stage-delay' as string]: `${0.18 + index * 0.02}s` }}>
      <div className={cn('group relative flex flex-wrap items-start gap-3 overflow-hidden rounded-[22px] border px-4 py-4 transition', isSelected ? 'border-accent/30 bg-[linear-gradient(90deg,rgba(0,122,255,0.12),rgba(10,10,10,0.92))] text-ink shadow-[inset_1px_0_0_rgba(0,122,255,0.18)]' : 'border-line/70 bg-canvas/72 text-ink hover:border-line hover:bg-canvas/90')}>
        <span className={cn('absolute inset-y-3 left-0 w-[3px] rounded-full bg-accent transition-opacity', isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />
        {onToggleSelection ? (
          <label className="relative z-10 mt-1 inline-flex shrink-0 cursor-pointer items-center">
            <input
              aria-label={`选择线程 ${row.subject}`}
              checked={isSelectionChecked}
              className="h-4 w-4 rounded border-line/80 bg-panel/90 text-accent"
              data-testid={`thread-select-${row.id}`}
              onChange={(event) => onToggleSelection(row.id, event.target.checked)}
              type="checkbox"
            />
          </label>
        ) : null}
        <button
          aria-label={`打开线程：${row.subject}`}
          aria-current={isSelected ? 'true' : undefined}
          className="relative min-w-0 flex-1 basis-[15rem] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          data-testid={`thread-row-${row.id}`}
          onKeyDown={handleKeyDown}
          onClick={() => onSelect(row.id)}
          type="button"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                {row.isUnread ? <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_10px_rgba(0,122,255,0.45)]" /> : null}
                <span className="truncate">{row.senderLabel}</span>
              </div>
              <p className="mt-2 truncate pr-2 text-sm font-medium text-ink">{row.subject}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-6 text-muted">{row.preview}</p>
              {contextLabel ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full border border-line/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{contextLabel}</span>
                </div>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{row.relativeTimeLabel}</p>
              <div className="mt-3 flex justify-end gap-2">
                {row.isFlagged ? <IndicatorBadge label="星标" /> : null}
                {row.hasAttachment ? <IndicatorBadge label="附件" /> : null}
              </div>
            </div>
          </div>
        </button>
        {actions ? <div className="relative z-10 flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ThreadListSkeleton() {
  return (
    <div aria-busy="true" className="mt-3 space-y-3">
      {['thread-skeleton-1', 'thread-skeleton-2', 'thread-skeleton-3', 'thread-skeleton-4'].map((key) => (
        <div className="loading-shimmer h-[110px] rounded-[22px] border border-line/70 bg-canvas/55" key={key} />
      ))}
    </div>
  );
}

export function ThreadListMessageCard({ actions, children, dataTestId, eyebrow, title }: { readonly actions?: React.ReactNode; readonly children: React.ReactNode; readonly dataTestId?: string; readonly eyebrow: string; readonly title: string }) {
  return (
    <div className="mt-3 rounded-[24px] border border-dashed border-line/70 bg-canvas/74 p-6" data-testid={dataTestId}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-accent/80">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        {eyebrow}
      </div>
      <h3 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-ink">{title}</h3>
      <p className="mt-3 max-w-lg text-sm leading-7 text-muted">{children}</p>
      {actions ? <div className="mt-5">{actions}</div> : null}
    </div>
  );
}

function IndicatorBadge({ label }: { readonly label: string }) {
  return <span className="rounded-full border border-accent/25 bg-accent/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{label}</span>;
}
