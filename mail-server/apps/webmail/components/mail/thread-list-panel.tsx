'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ThreadBulkActionBar } from '@/components/actions/thread-bulk-action-bar';
import { ThreadListMessageCard, ThreadListSkeleton, ThreadRowCard } from '@/components/mail/thread-list-shared';
import { useToast } from '@/components/system/toast-region';
import { buildFreshComposeRouteHref } from '@/lib/jmap/compose-core';
import { applyOptimisticActionToRows, createMailActionLabel, executeMailAction, resolveMailboxRoleTargets, syncMailActionQueries, toMailActionThreadRef, type MailActionRequest } from '@/lib/jmap/mail-actions';
import { useJmapClient } from '@/lib/jmap/provider';
import { getQueryClient } from '@/lib/query/client';
import { buildThreadRouteHref, queryMailboxThreads, resolveThreadListRouteState, type ThreadListPageData, type ThreadListRow } from '@/lib/jmap/thread-list';
import type { MailboxNavigationItem } from '@/lib/jmap/mailbox-shell';

export interface ThreadListPanelProps {
  readonly activeAccountId: string | null;
  readonly activeMailbox: MailboxNavigationItem | null;
  readonly activeMailboxName: string;
  readonly isShellLoading: boolean;
  readonly mailboxItems: readonly MailboxNavigationItem[];
  readonly shellErrorMessage: string | null;
  readonly topline: string;
}

interface PendingRollbackState {
  readonly checkedThreadIds: readonly string[];
  readonly href: string;
  readonly rows: readonly ThreadListRow[];
}

function focusThreadButton(threadId: string | null) {
  if (!threadId || typeof document === 'undefined') {
    return;
  }

  const selector = `[data-testid="thread-row-${threadId}"]`;
  const button = document.querySelector<HTMLButtonElement>(selector);
  button?.focus();
}

function isRemovalAction(action: MailActionRequest) {
  return action.type === 'archive' || action.type === 'delete' || action.type === 'move' || action.type === 'not-spam' || action.type === 'spam';
}

function isDeleteOnlyMailboxRole(role: MailboxNavigationItem['role']) {
  return role === 'drafts' || role === 'sent' || role === 'trash';
}

export function ThreadListPanel({ activeAccountId, activeMailbox, activeMailboxName, isShellLoading, mailboxItems, shellErrorMessage, topline }: ThreadListPanelProps) {
  const client = useJmapClient();
  const queryClient = useMemo(() => getQueryClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { notify } = useToast();
  const routeState = resolveThreadListRouteState(searchParams);
  const activeMailboxId = activeMailbox?.id ?? null;
  const baseHref = activeMailbox?.href ?? '/mail/inbox';
  const [checkedThreadIds, setCheckedThreadIds] = useState<readonly string[]>([]);
  const [optimisticRows, setOptimisticRows] = useState<readonly ThreadListRow[] | null>(null);
  const [pendingActionLabel, setPendingActionLabel] = useState<string | null>(null);
  const rollbackStateRef = useRef<PendingRollbackState | null>(null);
  const roleTargets = useMemo(() => resolveMailboxRoleTargets(mailboxItems), [mailboxItems]);

  const threadQuery = useQuery<ThreadListPageData>({
    enabled: Boolean(activeAccountId && activeMailboxId) && !isShellLoading && shellErrorMessage === null,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      if (!activeAccountId || !activeMailboxId) {
        return {
          accountId: activeAccountId ?? '',
          mailboxId: activeMailboxId ?? '',
          pagination: {
            hasMore: false,
            page: routeState.page,
            pageSize: 24,
            totalLoaded: 0,
          },
          rows: [],
          sync: {
            emailQueryState: '',
            threadState: null,
          },
        } satisfies ThreadListPageData;
      }

      return queryMailboxThreads({
        accountId: activeAccountId,
        client,
        mailboxId: activeMailboxId,
        page: routeState.page,
      });
    },
    queryKey: ['thread-list', activeAccountId, activeMailboxId, routeState.page],
    staleTime: 1000 * 30,
  });

  const selectedThreadId = routeState.selectedThreadId;
  const currentRoute = buildThreadRouteHref(baseHref, { page: routeState.page, selectedThreadId });
  const rows = optimisticRows ?? threadQuery.data?.rows ?? [];
  const checkedThreadIdSet = useMemo(() => new Set(checkedThreadIds), [checkedThreadIds]);
  const deleteOnlyRowActions = isDeleteOnlyMailboxRole(activeMailbox?.role ?? null);

  const openFreshCompose = () => {
    router.push(buildFreshComposeRouteHref({ accountId: activeAccountId, returnTo: currentRoute }));
  };

  useEffect(() => {
    if (optimisticRows) {
      return;
    }

    const rowIds = new Set((threadQuery.data?.rows ?? []).map((row) => row.id));
    setCheckedThreadIds((current) => current.filter((threadId) => rowIds.has(threadId)));
  }, [optimisticRows, threadQuery.data?.rows]);

  const handleThreadSelect = (threadId: string) => {
    router.push(buildThreadRouteHref(baseHref, { page: routeState.page, selectedThreadId: threadId }));
  };

  const handleLoadMore = () => {
    router.replace(buildThreadRouteHref(baseHref, { page: routeState.page + 1, selectedThreadId }));
  };

  const handleToggleSelection = (threadId: string, checked: boolean) => {
    setCheckedThreadIds((current) => checked ? [...current.filter((value) => value !== threadId), threadId] : current.filter((value) => value !== threadId));
  };

  const handleMoveFocus = (threadId: string, direction: 'first' | 'last' | 'next' | 'previous') => {
    const currentIndex = rows.findIndex((row) => row.id === threadId);
    if (currentIndex < 0) {
      return;
    }

    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? rows.length - 1
        : direction === 'next'
          ? Math.min(rows.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);

    focusThreadButton(rows[nextIndex]?.id ?? null);
  };

  const toggleAllVisible = () => {
    if (rows.length === 0) {
      return;
    }

    setCheckedThreadIds((current) => current.length === rows.length ? [] : rows.map((row) => row.id));
  };

  const runAction = async (action: MailActionRequest, targetThreadIds: readonly string[]) => {
    if (!activeAccountId || !activeMailboxId || targetThreadIds.length === 0 || pendingActionLabel) {
      return;
    }

    const targetRows = rows.filter((row) => targetThreadIds.includes(row.id));
    if (targetRows.length === 0) {
      return;
    }

    const projected = applyOptimisticActionToRows({
      action,
      currentMailboxId: activeMailboxId,
      rows,
      targetThreadIds,
    });
    const currentHref = buildThreadRouteHref(baseHref, { page: routeState.page, selectedThreadId });
    const nextSelectedThreadId = isRemovalAction(action) && selectedThreadId && targetThreadIds.includes(selectedThreadId) ? projected.nextFocusedThreadId : selectedThreadId;
    const nextHref = buildThreadRouteHref(baseHref, { page: routeState.page, selectedThreadId: nextSelectedThreadId });

    rollbackStateRef.current = {
      checkedThreadIds,
      href: currentHref,
      rows,
    };
    setPendingActionLabel(createMailActionLabel(action));
    setOptimisticRows(projected.rows);

    if (nextHref !== currentHref) {
      router.replace(nextHref);
    }

    if (isRemovalAction(action)) {
      setCheckedThreadIds((current) => current.filter((threadId) => !targetThreadIds.includes(threadId)));
    }

    const result = await executeMailAction({
      accountId: activeAccountId,
      action,
      client,
      currentMailboxId: activeMailboxId,
      roleTargets,
      threads: targetRows.map(toMailActionThreadRef),
    });

    if (result.kind === 'failure') {
      const rollbackState = rollbackStateRef.current;
      if (rollbackState) {
        setCheckedThreadIds(rollbackState.checkedThreadIds);
        setOptimisticRows(null);
        router.replace(rollbackState.href);
      }
      notify(result.message);
      setPendingActionLabel(null);
      rollbackStateRef.current = null;
      return;
    }

    if (!isRemovalAction(action)) {
      setCheckedThreadIds((current) => current.filter((threadId) => targetThreadIds.includes(threadId)));
    }

    await threadQuery.refetch();
    if (isRemovalAction(action)) {
      await syncMailActionQueries({
        accountId: activeAccountId,
        currentMailboxId: activeMailboxId,
        queryClient,
      });
    }
    router.refresh();
    setOptimisticRows(null);
    setPendingActionLabel(null);
    rollbackStateRef.current = null;
  };

  const handleBulkAction = (action: MailActionRequest) => void runAction(action, checkedThreadIds);
  const handleRowStarAction = (row: ThreadListRow) => void runAction({ type: row.isFlagged ? 'unstar' : 'star' }, [row.id]);
  const handleRowReadAction = (row: ThreadListRow) => void runAction({ type: row.isUnread ? 'mark-read' : 'mark-unread' }, [row.id]);
  const handleRowArchiveAction = (row: ThreadListRow) => void runAction({ type: 'archive' }, [row.id]);
  const handleRowDeleteAction = (row: ThreadListRow) => void runAction({ type: 'delete' }, [row.id]);
  const handleRowSpamAction = (row: ThreadListRow) => void runAction({ type: 'spam' }, [row.id]);

  return (
    <>
      <div className="rounded-[20px] border border-line/70 bg-canvas/82 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-muted">{topline}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-ink">{activeMailboxName}</h2>
          </div>
          <div className="text-right text-xs text-muted">
            <p>{activeMailbox?.unreadCount ?? 0} 未读</p>
            <p className="mt-1">{activeMailbox?.totalCount ?? 0} 个线程</p>
            <button
              aria-pressed={checkedThreadIds.length === rows.length && rows.length > 0}
              className="mt-3 inline-flex min-h-9 items-center justify-center rounded-xl border border-line/70 px-3 py-2 text-xs text-ink transition hover:border-accent/40 hover:text-accent"
              onClick={toggleAllVisible}
              type="button"
            >
              {checkedThreadIds.length === rows.length && rows.length > 0 ? '清空选择' : '选择当前页'}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span className="rounded-full border border-line/70 px-2.5 py-1 font-mono uppercase tracking-[0.18em]">黑曜线程栈</span>
          <span className="rounded-full border border-line/70 px-2.5 py-1 font-mono uppercase tracking-[0.18em]">当前邮箱视图</span>
          <span className="rounded-full border border-line/70 px-2.5 py-1 font-mono uppercase tracking-[0.18em]">第 {routeState.page} 页</span>
        </div>
      </div>

      {isShellLoading ? (
        <ThreadListSkeleton />
      ) : shellErrorMessage ? (
        <ThreadListMessageCard
          actions={
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line/80 bg-panel/84 px-4 py-3 text-sm font-medium text-ink transition hover:border-accent/50 hover:text-accent"
              onClick={() => router.refresh()}
              type="button"
            >
              重新载入
            </button>
          }
          eyebrow="线程列表异常"
          title={`无法加载邮箱导航：${shellErrorMessage}`}
        >
          左侧邮箱导航尚未就绪，因此线程列表暂停渲染。请稍后重试。
        </ThreadListMessageCard>
      ) : threadQuery.isLoading && !threadQuery.data ? (
        <ThreadListSkeleton />
      ) : threadQuery.isError ? (
        <ThreadListMessageCard
          actions={
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-accent/40 bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent/90"
              onClick={() => void threadQuery.refetch()}
              type="button"
            >
              重试线程查询
            </button>
          }
          eyebrow="线程列表异常"
          title={threadQuery.error instanceof Error ? threadQuery.error.message : '线程列表加载失败'}
        >
          当前邮箱暂时无法返回线程结果，列表结构会保持稳定，你可以稍后重试。
        </ThreadListMessageCard>
      ) : (threadQuery.data?.rows.length ?? 0) === 0 ? (
        <ThreadListMessageCard
          actions={
            <div className="flex flex-wrap gap-3">
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent/90"
                  data-testid="thread-empty-new-mail-button"
                  onClick={openFreshCompose}
                  type="button"
                >
                  新建邮件
                </button>
              <Link
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line/80 bg-panel/84 px-4 py-3 text-sm font-medium text-ink transition hover:border-accent/50 hover:text-accent"
                href={baseHref}
              >
                保持在当前邮箱
              </Link>
            </div>
          }
          dataTestId="thread-empty-state"
          eyebrow="线程列表为空"
          title={activeMailbox ? `${activeMailbox.name} 当前没有可展示的线程` : '没有可展示的线程'}
        >
          当前邮箱暂时没有可展示的线程。右侧阅读器会保持稳定空态，你可以等待新邮件到达或切换到其他邮箱。
        </ThreadListMessageCard>
      ) : (
        <div className="mt-3 space-y-3">
          <ThreadBulkActionBar
            archiveMailboxId={roleTargets.archiveId}
            currentMailboxRole={activeMailbox?.role ?? null}
            disabled={pendingActionLabel !== null}
            onAction={handleBulkAction}
            selectedCount={checkedThreadIds.length}
          />
          <ul aria-label={`${activeMailboxName}线程列表`} className="space-y-2.5">
            {rows.map((row, index) => (
              <li key={row.id}>
                <ThreadRowCard
                  actions={
                    <>
                      {deleteOnlyRowActions ? null : (
                        <>
                          <button
                            aria-label={`${row.isUnread ? '标记已读' : '标记未读'}：${row.subject}`}
                            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-line/70 px-3 py-2 text-xs text-ink transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
                            data-testid={`thread-row-read-${row.id}`}
                            disabled={pendingActionLabel !== null}
                            onClick={() => handleRowReadAction(row)}
                            type="button"
                          >
                            {row.isUnread ? '已读' : '未读'}
                          </button>
                          <button
                            aria-label={`${row.isFlagged ? '取消星标' : '加星'}：${row.subject}`}
                            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-line/70 px-3 py-2 text-xs text-ink transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
                            data-testid={`thread-row-star-${row.id}`}
                            disabled={pendingActionLabel !== null}
                            onClick={() => handleRowStarAction(row)}
                            type="button"
                          >
                            {row.isFlagged ? '取消星标' : '加星'}
                          </button>
                          {roleTargets.archiveId === null ? null : (
                            <button
                              aria-label={`归档线程：${row.subject}`}
                              className="inline-flex min-h-9 items-center justify-center rounded-xl border border-line/70 px-3 py-2 text-xs text-ink transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
                              data-testid={`thread-row-archive-${row.id}`}
                              disabled={pendingActionLabel !== null}
                              onClick={() => handleRowArchiveAction(row)}
                              type="button"
                            >
                              归档
                            </button>
                          )}
                        </>
                      )}
                      <button
                        aria-label={`删除线程：${row.subject}`}
                        className="inline-flex min-h-9 items-center justify-center rounded-xl border border-line/70 px-3 py-2 text-xs text-ink transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
                        data-testid={`thread-row-delete-${row.id}`}
                        disabled={pendingActionLabel !== null || roleTargets.trashId === null}
                        onClick={() => handleRowDeleteAction(row)}
                        type="button"
                      >
                        删除
                      </button>
                      {deleteOnlyRowActions ? null : (
                        <button
                          aria-label={`标记线程为垃圾邮件：${row.subject}`}
                          className="inline-flex min-h-9 items-center justify-center rounded-xl border border-line/70 px-3 py-2 text-xs text-ink transition hover:border-accent/40 hover:text-accent disabled:opacity-50"
                          data-testid={`thread-row-spam-${row.id}`}
                          disabled={pendingActionLabel !== null || roleTargets.junkId === null}
                          onClick={() => handleRowSpamAction(row)}
                          type="button"
                        >
                          垃圾邮件
                        </button>
                      )}
                    </>
                  }
                  index={index}
                  isSelected={row.id === selectedThreadId}
                  isSelectionChecked={checkedThreadIdSet.has(row.id)}
                  onMoveFocus={handleMoveFocus}
                  onSelect={handleThreadSelect}
                  onToggleSelection={handleToggleSelection}
                  row={row}
                />
              </li>
            ))}
          </ul>

          {threadQuery.data?.pagination.hasMore ? (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-[20px] border border-line/80 bg-canvas/78 px-4 py-3 text-sm font-medium text-ink transition hover:border-accent/40 hover:text-accent"
              data-testid="thread-load-more"
              onClick={handleLoadMore}
              type="button"
            >
              载入更多线程 · 已加载 {threadQuery.data.pagination.totalLoaded}
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}
