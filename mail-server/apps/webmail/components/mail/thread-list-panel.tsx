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

export function ThreadListPanel(props: ThreadListPanelProps) {
  const { activeAccountId, activeMailbox, activeMailboxName, isShellLoading, mailboxItems, shellErrorMessage } = props;
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
  const unreadCount = activeMailbox?.unreadCount ?? 0;
  const totalCount = activeMailbox?.totalCount ?? 0;
  const areAllVisibleThreadsChecked = checkedThreadIds.length === rows.length && rows.length > 0;
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
  return (
    <>
      <div className="relative overflow-hidden rounded-[24px] border border-line/80 bg-panel/78 p-[1px]" data-testid="thread-top-card">
        <div aria-hidden="true" className="pointer-events-none absolute -left-10 bottom-0 h-28 w-28 rounded-full bg-accent/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-8 top-0 h-32 w-32 rounded-full bg-accent/14 blur-3xl" />
        <div className="relative rounded-[23px] bg-[linear-gradient(145deg,rgb(var(--color-panel)/0.96),rgb(var(--color-canvas)/0.92))] px-4 py-4 sm:px-5 sm:py-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-4">
            <div className="min-w-0">
              <h2 className="text-[2.25rem] font-semibold tracking-[-0.05em] text-white sm:text-[2.6rem]">{activeMailboxName}</h2>
            </div>
            <button
              aria-label="新建邮件"
              className="col-start-2 row-start-1 inline-flex min-h-11 items-center justify-center gap-2 self-start justify-self-end rounded-2xl border border-accent/40 bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              data-testid="new-mail-button"
              onClick={openFreshCompose}
              type="button"
            >
              新建邮件
            </button>
            <p className="col-start-1 row-start-2 min-w-0 text-sm text-muted" data-testid="thread-top-card-stats">
              <span data-testid="thread-top-card-unread">{unreadCount} 未读</span>
              <span aria-hidden="true"> · </span>
              <span data-testid="thread-top-card-total">{totalCount} 个邮件</span>
            </p>
            <p className="col-start-1 row-start-3 self-end font-mono text-[11px] uppercase tracking-[0.22em] text-muted" data-testid="thread-top-card-page">第 {routeState.page} 页</p>
            <button
              aria-pressed={areAllVisibleThreadsChecked}
              className="col-start-2 row-start-3 inline-flex min-h-11 items-center justify-center self-end justify-self-end rounded-2xl border border-line/70 bg-canvas/48 px-4 py-3 text-sm text-ink transition hover:border-accent/40 hover:text-accent"
              data-testid="thread-top-card-selection-toggle"
              onClick={toggleAllVisible}
              type="button"
            >
              {areAllVisibleThreadsChecked ? '清空选择' : '批量操作'}
            </button>
          </div>
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
