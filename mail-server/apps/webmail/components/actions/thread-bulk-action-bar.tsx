'use client';

import { MailActionStrip } from '@/components/actions/mail-action-strip';
import type { MailActionRequest } from '@/lib/jmap/mail-actions';
import type { MailboxNavigationItem } from '@/lib/jmap/mailbox-shell';

function isDeleteOnlyMailboxRole(role: MailboxNavigationItem['role']) {
  return role === 'drafts' || role === 'sent' || role === 'trash';
}

export interface ThreadBulkActionBarProps {
  readonly archiveMailboxId: string | null;
  readonly currentMailboxRole: MailboxNavigationItem['role'] | null;
  readonly disabled?: boolean;
  readonly onAction: (action: MailActionRequest) => void;
  readonly selectedCount: number;
}

export function ThreadBulkActionBar({ archiveMailboxId, currentMailboxRole, disabled = false, onAction, selectedCount }: ThreadBulkActionBarProps) {
  if (selectedCount <= 0) {
    return null;
  }

  const deleteOnlyActions = isDeleteOnlyMailboxRole(currentMailboxRole);

  return (
    <div aria-live="polite" className="rounded-[20px] border border-accent/25 bg-accent/8 px-4 py-3" data-testid="thread-bulk-bar">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-accent/80">批量操作</p>
          <p className="mt-2 text-sm text-ink">已选择 {selectedCount} 个线程</p>
        </div>
        <MailActionStrip availability={{ archive: Boolean(archiveMailboxId) }} disabled={disabled} onAction={onAction} visibility={deleteOnlyActions ? { archive: false, markRead: false, spam: false, star: false } : undefined} />
      </div>
    </div>
  );
}
