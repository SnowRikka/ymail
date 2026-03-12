'use client';

import type { MailActionRequest } from '@/lib/jmap/mail-actions';

export interface MailActionAvailability {
  readonly archive: boolean;
  readonly delete: boolean;
  readonly markRead: boolean;
  readonly spam: boolean;
  readonly star: boolean;
}

export interface MailActionStripProps {
  readonly availability?: Partial<MailActionAvailability>;
  readonly disabled?: boolean;
  readonly includeLabels?: boolean;
  readonly onAction: (action: MailActionRequest) => void;
  readonly readLabel?: string;
  readonly starLabel?: string;
  readonly testIdPrefix?: string;
  readonly visibility?: Partial<MailActionAvailability>;
}

const DEFAULT_AVAILABILITY: MailActionAvailability = {
  archive: true,
  delete: true,
  markRead: true,
  spam: true,
  star: true,
};

export function MailActionStrip({ availability, disabled = false, includeLabels = true, onAction, readLabel = '标记已读', starLabel = '加星', testIdPrefix = '', visibility }: MailActionStripProps) {
  const resolvedAvailability = { ...DEFAULT_AVAILABILITY, ...availability };
  const resolvedVisibility = { ...DEFAULT_AVAILABILITY, ...visibility };
  const showArchiveAction = resolvedVisibility.archive && resolvedAvailability.archive;
  const withPrefix = (value: string) => (testIdPrefix.length > 0 ? `${testIdPrefix}-${value}` : value);

  return (
    <div aria-label="邮件操作" className="flex flex-wrap gap-2" role="toolbar">
      {resolvedVisibility.markRead ? <ActionButton ariaLabel={readLabel} dataTestId={withPrefix('action-mark-read')} disabled={disabled || !resolvedAvailability.markRead} label={readLabel} onClick={() => onAction(readLabel === '标记未读' ? { type: 'mark-unread' } : { type: 'mark-read' })} /> : null}
      {resolvedVisibility.star ? <ActionButton ariaLabel={starLabel} dataTestId={withPrefix('action-star')} disabled={disabled || !resolvedAvailability.star} label={starLabel} onClick={() => onAction(starLabel === '取消星标' ? { type: 'unstar' } : { type: 'star' })} /> : null}
      {showArchiveAction ? <ActionButton ariaLabel={includeLabels ? '归档当前邮件' : '移至归档'} dataTestId={withPrefix('action-move')} disabled={disabled} label={includeLabels ? '归档' : '移至归档'} onClick={() => onAction({ type: 'archive' })} /> : null}
      <ActionButton ariaLabel="删除当前邮件" dataTestId={withPrefix('action-delete')} disabled={disabled || !resolvedAvailability.delete} label="删除" onClick={() => onAction({ type: 'delete' })} />
      {resolvedVisibility.spam ? <ActionButton ariaLabel="标记为垃圾邮件" dataTestId={withPrefix('action-spam')} disabled={disabled || !resolvedAvailability.spam} label="垃圾邮件" onClick={() => onAction({ type: 'spam' })} /> : null}
    </div>
  );
}

function ActionButton({ ariaLabel, dataTestId, disabled, label, onClick }: { readonly ariaLabel: string; readonly dataTestId: string; readonly disabled: boolean; readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      aria-label={ariaLabel}
      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line/80 bg-panel/84 px-4 py-3 text-sm font-medium text-ink transition hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
      data-testid={dataTestId}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
