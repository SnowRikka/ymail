import type { QueryClient } from '@tanstack/react-query';

import type { ReaderThread } from '@/lib/jmap/message-reader';
import type { JmapClient, JmapPatchObject, JmapSetInvocationError } from '@/lib/jmap/types';
import type { MailboxNavigationItem } from '@/lib/jmap/mailbox-shell';
import type { ThreadListRow } from '@/lib/jmap/thread-list';

const KEYWORD_FLAGGED = '$flagged';
const KEYWORD_DRAFT = '$draft';
const KEYWORD_JUNK = '$junk';
const KEYWORD_NOT_JUNK = '$notjunk';
const KEYWORD_SEEN = '$seen';

export type MailActionName = 'archive' | 'delete' | 'mark-read' | 'mark-unread' | 'move' | 'not-spam' | 'spam' | 'star' | 'unstar';

export interface MailActionThreadRef {
  readonly emailIds: readonly string[];
  readonly id: string;
  readonly isFlagged: boolean;
  readonly isUnread: boolean;
  readonly mailboxIds: Readonly<Record<string, boolean>>;
}

export interface MailActionMailboxRoleTargets {
  readonly archiveId: string | null;
  readonly draftsId: string | null;
  readonly inboxId: string | null;
  readonly junkId: string | null;
  readonly trashId: string | null;
}

export type MailActionRequest =
  | { readonly type: 'mark-read' }
  | { readonly type: 'mark-unread' }
  | { readonly type: 'star' }
  | { readonly type: 'unstar' }
  | { readonly type: 'archive' }
  | { readonly targetMailboxId: string; readonly type: 'move' }
  | { readonly type: 'delete' }
  | { readonly type: 'spam' }
  | { readonly type: 'not-spam' };

export interface MailActionExecutionInput {
  readonly accountId: string;
  readonly action: MailActionRequest;
  readonly client: JmapClient;
  readonly currentMailboxId: string;
  readonly roleTargets: MailActionMailboxRoleTargets;
  readonly threads: readonly MailActionThreadRef[];
}

export type MailActionExecutionResult =
  | { readonly kind: 'success'; readonly updatedEmailIds: readonly string[] }
  | { readonly kind: 'failure'; readonly message: string };

export interface ProjectedThreadListResult {
  readonly nextFocusedThreadId: string | null;
  readonly rows: readonly ThreadListRow[];
}

export interface ProjectedReaderThreadResult {
  readonly thread: ReaderThread | null;
}

export interface MailActionQuerySyncInput {
  readonly accountId: string;
  readonly currentMailboxId: string | null;
  readonly queryClient: QueryClient;
}

export function isDeleteOnlyMailboxRole(role: MailboxNavigationItem['role']) {
  return role === 'drafts' || role === 'sent' || role === 'trash';
}

export function shouldHideSpamActionForMailboxRole(role: MailboxNavigationItem['role']) {
  return isDeleteOnlyMailboxRole(role) || role === 'junk';
}

function isSuccessfulMailboxId(value: boolean | undefined) {
  return value === true;
}

function normalizeInvocationError(error: JmapSetInvocationError | undefined, fallback: string) {
  return typeof error?.description === 'string' && error.description.length > 0 ? error.description : fallback;
}

function setBooleanPatch(key: string, enabled: boolean): JmapPatchObject {
  return enabled ? { [key]: true } : { [key]: null };
}

function toMailboxIdsPatch(mailboxIds: Readonly<Record<string, boolean>>) {
  return Object.fromEntries(Object.entries(mailboxIds).map(([mailboxId, enabled]) => [`mailboxIds/${mailboxId}`, enabled ? true : null]));
}

function withMailboxId(mailboxIds: Readonly<Record<string, boolean>>, mailboxId: string) {
  return { ...mailboxIds, [mailboxId]: true };
}

function withoutMailboxId(mailboxIds: Readonly<Record<string, boolean>>, mailboxId: string) {
  return Object.fromEntries(Object.entries(mailboxIds).filter(([id, enabled]) => id !== mailboxId && isSuccessfulMailboxId(enabled)));
}

function isPermanentDeleteAction(action: MailActionRequest, currentMailboxId: string, roleTargets: MailActionMailboxRoleTargets) {
  return action.type === 'delete' && roleTargets.trashId !== null && currentMailboxId === roleTargets.trashId;
}

function clearsJunkSemantics(action: MailActionRequest, currentMailboxId: string, roleTargets: MailActionMailboxRoleTargets) {
  return action.type === 'delete' && roleTargets.junkId !== null && currentMailboxId === roleTargets.junkId;
}

function resolveTargetMailboxId(action: MailActionRequest, currentMailboxId: string, roleTargets: MailActionMailboxRoleTargets) {
  switch (action.type) {
    case 'archive':
      return roleTargets.archiveId;
    case 'delete':
      return roleTargets.trashId;
    case 'move':
      return action.targetMailboxId;
    case 'not-spam':
      return roleTargets.inboxId;
    case 'spam':
      return roleTargets.junkId;
    default:
      return currentMailboxId;
  }
}

export function resolveMailboxRoleTargets(mailboxes: readonly MailboxNavigationItem[]): MailActionMailboxRoleTargets {
  return {
    archiveId: mailboxes.find((mailbox) => mailbox.role === 'archive')?.id ?? null,
    draftsId: mailboxes.find((mailbox) => mailbox.role === 'drafts')?.id ?? null,
    inboxId: mailboxes.find((mailbox) => mailbox.role === 'inbox')?.id ?? null,
    junkId: mailboxes.find((mailbox) => mailbox.role === 'junk')?.id ?? null,
    trashId: mailboxes.find((mailbox) => mailbox.role === 'trash')?.id ?? null,
  };
}

function isDraftMailboxThread(thread: MailActionThreadRef, roleTargets: MailActionMailboxRoleTargets) {
  return !!roleTargets.draftsId && isSuccessfulMailboxId(thread.mailboxIds[roleTargets.draftsId]);
}

export function createMailActionLabel(action: MailActionRequest) {
  switch (action.type) {
    case 'archive':
      return '归档';
    case 'delete':
      return '移入废纸篓';
    case 'mark-read':
      return '标记已读';
    case 'mark-unread':
      return '标记未读';
    case 'move':
      return '移动邮件';
    case 'not-spam':
      return '移出垃圾邮件';
    case 'spam':
      return '标记垃圾邮件';
    case 'star':
      return '加星';
    case 'unstar':
      return '取消星标';
  }
}

export function isDeterministicOptimisticAction(action: MailActionRequest) {
  return action.type !== 'move' || action.targetMailboxId.length > 0;
}

export function applyOptimisticActionToRows(input: {
  readonly action: MailActionRequest;
  readonly currentMailboxId: string;
  readonly rows: readonly ThreadListRow[];
  readonly targetThreadIds: readonly string[];
}): ProjectedThreadListResult {
  const targetIds = new Set(input.targetThreadIds);
  const firstTargetIndex = input.rows.findIndex((row) => targetIds.has(row.id));

  if (input.action.type === 'mark-read' || input.action.type === 'mark-unread' || input.action.type === 'star' || input.action.type === 'unstar') {
    return {
      nextFocusedThreadId: null,
      rows: input.rows.map((row) => {
        if (!targetIds.has(row.id)) {
          return row;
        }

        if (input.action.type === 'mark-read') {
          return { ...row, isUnread: false };
        }

        if (input.action.type === 'mark-unread') {
          return { ...row, isUnread: true };
        }

        if (input.action.type === 'star') {
          return { ...row, isFlagged: true };
        }

        return { ...row, isFlagged: false };
      }),
    };
  }

  const rows = input.rows.filter((row) => !targetIds.has(row.id));
  const focusIndex = firstTargetIndex < 0 ? -1 : Math.min(firstTargetIndex, Math.max(rows.length - 1, 0));

  return {
    nextFocusedThreadId: focusIndex >= 0 ? rows[focusIndex]?.id ?? null : null,
    rows,
  };
}

export function toMailActionThreadRef(row: ThreadListRow): MailActionThreadRef {
  return {
    emailIds: row.emailIds,
    id: row.id,
    isFlagged: row.isFlagged,
    isUnread: row.isUnread,
    mailboxIds: row.mailboxIds,
  };
}

export function toReaderMailActionThreadRef(thread: Pick<ReaderThread, 'emailIds' | 'id' | 'isFlagged' | 'isUnread' | 'mailboxIds'>): MailActionThreadRef {
  return {
    emailIds: thread.emailIds,
    id: thread.id,
    isFlagged: thread.isFlagged,
    isUnread: thread.isUnread,
    mailboxIds: thread.mailboxIds,
  };
}

export function applyOptimisticActionToReaderThread(input: {
  readonly action: MailActionRequest;
  readonly thread: ReaderThread;
}): ProjectedReaderThreadResult {
  if (input.action.type === 'mark-read' || input.action.type === 'mark-unread') {
    const isUnread = input.action.type === 'mark-unread';
    return {
      thread: {
        ...input.thread,
        isUnread,
        messages: input.thread.messages.map((message) => ({ ...message, isUnread })),
      },
    };
  }

  if (input.action.type === 'star' || input.action.type === 'unstar') {
    const isFlagged = input.action.type === 'star';
    return {
      thread: {
        ...input.thread,
        isFlagged,
        messages: input.thread.messages.map((message) => ({ ...message, isFlagged })),
      },
    };
  }

  return {
    thread: null,
  };
}

export function buildMailActionPatch(input: {
  readonly action: MailActionRequest;
  readonly currentMailboxId: string;
  readonly roleTargets: MailActionMailboxRoleTargets;
  readonly thread: MailActionThreadRef;
}): JmapPatchObject | null {
  if (input.thread.emailIds.length === 0) {
    return null;
  }

  if (isPermanentDeleteAction(input.action, input.currentMailboxId, input.roleTargets)) {
    return null;
  }

  switch (input.action.type) {
    case 'mark-read':
      return setBooleanPatch(`keywords/${KEYWORD_SEEN}`, true);
    case 'mark-unread':
      return setBooleanPatch(`keywords/${KEYWORD_SEEN}`, false);
    case 'star':
      return setBooleanPatch(`keywords/${KEYWORD_FLAGGED}`, true);
    case 'unstar':
      return setBooleanPatch(`keywords/${KEYWORD_FLAGGED}`, false);
    case 'archive':
    case 'delete':
    case 'move':
    case 'not-spam':
    case 'spam': {
      const targetMailboxId = resolveTargetMailboxId(input.action, input.currentMailboxId, input.roleTargets);

      if (!targetMailboxId) {
        return null;
      }

      const currentMailboxIds = withoutMailboxId(input.thread.mailboxIds, input.currentMailboxId);
      const nextMailboxIds = withMailboxId(currentMailboxIds, targetMailboxId);
      const clearsDraftSemantics = input.action.type === 'delete' && isDraftMailboxThread(input.thread, input.roleTargets);
      const draftMailboxId = clearsDraftSemantics ? input.roleTargets.draftsId : null;
      const junkMailboxId = clearsJunkSemantics(input.action, input.currentMailboxId, input.roleTargets) ? input.roleTargets.junkId : null;

      return {
        ...toMailboxIdsPatch(nextMailboxIds),
        ...(draftMailboxId ? { [`mailboxIds/${draftMailboxId}`]: null, [`keywords/${KEYWORD_DRAFT}`]: null } : {}),
        ...(junkMailboxId ? { [`mailboxIds/${junkMailboxId}`]: null, [`keywords/${KEYWORD_JUNK}`]: null, [`keywords/${KEYWORD_NOT_JUNK}`]: true } : {}),
        ...(input.action.type === 'spam' ? { [`keywords/${KEYWORD_JUNK}`]: true, [`keywords/${KEYWORD_NOT_JUNK}`]: null } : {}),
        ...(input.action.type === 'not-spam' ? { [`keywords/${KEYWORD_JUNK}`]: null, [`keywords/${KEYWORD_NOT_JUNK}`]: true } : {}),
      };
    }
  }
}

export async function executeMailAction(input: MailActionExecutionInput): Promise<MailActionExecutionResult> {
  const destroyEmailIds: string[] = [];
  const updateEntries: Array<[string, JmapPatchObject]> = [];

  for (const thread of input.threads) {
    if (isPermanentDeleteAction(input.action, input.currentMailboxId, input.roleTargets)) {
      destroyEmailIds.push(...thread.emailIds);
      continue;
    }

    const patch = buildMailActionPatch({
      action: input.action,
      currentMailboxId: input.currentMailboxId,
      roleTargets: input.roleTargets,
      thread,
    });

    if (!patch) {
      return {
        kind: 'failure',
        message: `${createMailActionLabel(input.action)}缺少目标邮箱或线程数据。`,
      };
    }

    for (const emailId of thread.emailIds) {
      updateEntries.push([emailId, patch]);
    }
  }

  if (destroyEmailIds.length === 0 && updateEntries.length === 0) {
    return {
      kind: 'failure',
      message: '没有可更新的邮件。',
    };
  }

  const result = await input.client.email.set({
    accountId: input.accountId,
    ...(destroyEmailIds.length > 0 ? { destroy: destroyEmailIds } : {}),
    ...(updateEntries.length > 0 ? { update: Object.fromEntries(updateEntries) } : {}),
  });

  if (!result.ok) {
    return {
      kind: 'failure',
      message: result.error.message,
    };
  }

  if (result.result.kind !== 'success') {
    return {
      kind: 'failure',
      message: typeof result.result.error.description === 'string' && result.result.error.description.length > 0 ? result.result.error.description : `${createMailActionLabel(input.action)}失败。`,
    };
  }

  const notUpdatedEntries = Object.entries(result.result.response.notUpdated ?? {});
  if (notUpdatedEntries.length > 0) {
    return {
      kind: 'failure',
      message: normalizeInvocationError(notUpdatedEntries[0]?.[1], `${createMailActionLabel(input.action)}失败。`),
    };
  }

  const notDestroyedEntries = Object.entries(result.result.response.notDestroyed ?? {});
  if (notDestroyedEntries.length > 0) {
    return {
      kind: 'failure',
      message: normalizeInvocationError(notDestroyedEntries[0]?.[1], `${createMailActionLabel(input.action)}失败。`),
    };
  }

  return {
    kind: 'success',
    updatedEmailIds: [...destroyEmailIds, ...updateEntries.map(([emailId]) => emailId)],
  };
}

export async function syncMailActionQueries(input: MailActionQuerySyncInput) {
  await input.queryClient.invalidateQueries({ queryKey: ['mailbox-shell', input.accountId] });

  if (input.currentMailboxId) {
    await input.queryClient.invalidateQueries({ queryKey: ['thread-list', input.accountId, input.currentMailboxId] });
  }
}
