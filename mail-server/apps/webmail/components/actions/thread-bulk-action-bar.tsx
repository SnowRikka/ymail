'use client';

import { MailActionStrip } from '@/components/actions/mail-action-strip';
import { isDeleteOnlyMailboxRole, shouldHideSpamActionForMailboxRole, type MailActionRequest } from '@/lib/jmap/mail-actions';
import type { MailboxNavigationItem } from '@/lib/jmap/mailbox-shell';

export interface ThreadBulkActionBarProps {
  readonly archiveMailboxId: string | null;
  readonly currentMailboxRole: MailboxNavigationItem['role'] | null;
  readonly disabled?: boolean;
  readonly onAction: (action: MailActionRequest) => void;
  readonly selectedCount: number;
}

export function ThreadBulkActionBar({ archiveMailboxId, currentMailboxRole, disabled = false, onAction, selectedCount }: ThreadBulkActionBarProps) {
  if (selectedCount < 2) {
    return null;
  }

  const deleteOnlyActions = isDeleteOnlyMailboxRole(currentMailboxRole);
  const hideReadAction = deleteOnlyActions || currentMailboxRole === 'archive';
  const hideSpamAction = shouldHideSpamActionForMailboxRole(currentMailboxRole);
  const visibility = deleteOnlyActions
    ? { archive: false, markRead: false, spam: false, star: false }
    : hideReadAction || hideSpamAction
      ? {
          ...(hideReadAction ? { markRead: false } : {}),
          ...(hideSpamAction ? { spam: false } : {}),
        }
      : undefined;

  return (
    <div aria-live="polite" className="rounded-[20px] border border-accent/25 bg-accent/8 px-4 py-3" data-testid="thread-bulk-bar">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] uppercase tracking-[0.28em] text-accent/80">批量操作</p>
          <p className="text-sm text-ink">已选择 {selectedCount} 个邮件</p>
        </div>
        <MailActionStrip availability={{ archive: Boolean(archiveMailboxId) }} disabled={disabled} onAction={onAction} visibility={visibility} />
      </div>
    </div>
  );
}
