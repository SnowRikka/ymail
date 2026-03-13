'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { MailShellListPaneProps } from '@/components/mail/mail-shell';
import { ThreadListMessageCard, ThreadListSkeleton, ThreadRowCard } from '@/components/mail/thread-list-shared';
import { buildComposeRouteHref } from '@/lib/jmap/compose-core';
import { formatMailboxDisplayName, type MailboxNavigationItem } from '@/lib/jmap/mailbox-shell';
import { buildSearchRouteHref, getSearchFieldLabel, hasActiveMailSearchCriteria, querySearchThreads, resolveSearchRouteState, type MailSearchRouteState, type SearchResultsPageData } from '@/lib/jmap/search';
import { useJmapClient } from '@/lib/jmap/provider';

function toSearchMailboxOptions(mailboxes: readonly MailboxNavigationItem[]) {
  return mailboxes.map((mailbox) => ({ id: mailbox.id, label: formatMailboxDisplayName(mailbox) }));
}

function resolveMailboxLabel(mailboxes: readonly MailboxNavigationItem[], mailboxId: string | null) {
  if (!mailboxId) {
    return '全部邮箱';
  }

  const mailbox = mailboxes.find((item) => item.id === mailboxId);

  if (!mailbox) {
    return '指定邮箱';
  }

  return formatMailboxDisplayName(mailbox);
}

function buildResolvedRouteState(routeState: MailSearchRouteState, activeAccountId: string | null, mailboxes: readonly MailboxNavigationItem[]) {
  const mailboxId = routeState.mailboxId && mailboxes.some((mailbox) => mailbox.id === routeState.mailboxId) ? routeState.mailboxId : null;

  return {
    ...routeState,
    accountId: activeAccountId,
    mailboxId,
  } satisfies MailSearchRouteState;
}

function focusResultButton(threadId: string | null) {
  if (!threadId || typeof document === 'undefined') {
    return;
  }

  const selector = `[data-testid="thread-row-${threadId}"]`;
  const button = document.querySelector<HTMLButtonElement>(selector);
  button?.focus();
}

export function SearchResultsPanel({ activeAccountId, activeMailbox, isShellLoading, shellErrorMessage, viewModel }: MailShellListPaneProps) {
  const client = useJmapClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeState = useMemo(() => resolveSearchRouteState(searchParams), [searchParams]);
  const mailboxItems = viewModel?.mailboxItems ?? [];
  const resolvedState = buildResolvedRouteState(routeState, activeAccountId, mailboxItems);
  const mailboxOptions = toSearchMailboxOptions(mailboxItems);
  const selectedThreadId = resolvedState.selectedThreadId;
  const hasCriteria = hasActiveMailSearchCriteria(resolvedState);
  const currentRoute = buildSearchRouteHref(resolvedState);
  const selectedMailboxName = resolveMailboxLabel(mailboxItems, resolvedState.mailboxId ?? activeMailbox?.id ?? null);

  const searchQuery = useQuery<SearchResultsPageData>({
    enabled: Boolean(resolvedState.accountId) && hasCriteria && !isShellLoading && shellErrorMessage === null,
    placeholderData: (previousData) => previousData,
    queryFn: () =>
      querySearchThreads({
        accountId: resolvedState.accountId as string,
        client,
        filters: resolvedState,
      }),
    queryKey: [
      'search-results',
      resolvedState.accountId,
      resolvedState.query,
      resolvedState.field,
      resolvedState.unreadOnly,
      resolvedState.hasAttachment,
      resolvedState.flaggedOnly,
      resolvedState.mailboxId,
      resolvedState.page,
    ],
    staleTime: 1000 * 30,
  });

  const updateRoute = (nextState: MailSearchRouteState, navigation: 'push' | 'replace' = 'replace') => {
    const href = buildSearchRouteHref(nextState);
    if (navigation === 'push') {
      router.push(href);
      return;
    }
    router.replace(href);
  };

  const toggleUnread = () => updateRoute({ ...resolvedState, page: 1, selectedThreadId: null, unreadOnly: !resolvedState.unreadOnly });
  const toggleAttachment = () => updateRoute({ ...resolvedState, hasAttachment: !resolvedState.hasAttachment, page: 1, selectedThreadId: null });
  const toggleFlagged = () => updateRoute({ ...resolvedState, flaggedOnly: !resolvedState.flaggedOnly, page: 1, selectedThreadId: null });
  const changeField = (field: MailSearchRouteState['field']) => updateRoute({ ...resolvedState, field, page: 1, selectedThreadId: null });
  const changeMailbox = (mailboxId: string) =>
    updateRoute({
      ...resolvedState,
      mailboxId: mailboxId.length > 0 ? mailboxId : null,
      page: 1,
      selectedThreadId: null,
    });
  const selectThread = (threadId: string) => updateRoute({ ...resolvedState, selectedThreadId: threadId }, 'push');
  const loadMore = () => updateRoute({ ...resolvedState, page: resolvedState.page + 1 });
  const clearSearch = () => updateRoute({ ...resolvedState, field: 'text', flaggedOnly: false, hasAttachment: false, mailboxId: null, page: 1, query: '', selectedThreadId: null, unreadOnly: false });
  const handleMoveFocus = (threadId: string, direction: 'first' | 'last' | 'next' | 'previous') => {
    const rows = searchQuery.data?.rows ?? [];
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

    focusResultButton(rows[nextIndex]?.id ?? null);
  };

  return (
    <>
      <div className="rounded-[20px] border border-line/70 bg-canvas/82 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-ink">搜索结果</h2>
          <div className="text-right text-xs text-muted">
            <p>{selectedMailboxName}</p>
            <p className="mt-1">{getSearchFieldLabel(resolvedState.field)}匹配</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,160px)_minmax(0,1fr)]">
          <label className="block text-xs text-muted" htmlFor="search-field-select">
            范围
            <select
              className="mt-2 w-full rounded-2xl border border-line/80 bg-panel/90 px-4 py-3 text-sm text-ink outline-none transition hover:border-accent/40 focus:border-accent"
              id="search-field-select"
              onChange={(event) => changeField(event.target.value as MailSearchRouteState['field'])}
              value={resolvedState.field}
            >
              <option value="text">全文</option>
              <option value="subject">主题</option>
              <option value="from">发件人</option>
              <option value="recipient">收件人</option>
            </select>
          </label>

          <label className="block text-xs text-muted" htmlFor="search-mailbox-scope">
            邮箱范围
            <select
              className="mt-2 w-full rounded-2xl border border-line/80 bg-panel/90 px-4 py-3 text-sm text-ink outline-none transition hover:border-accent/40 focus:border-accent"
              id="search-mailbox-scope"
              onChange={(event) => changeMailbox(event.target.value)}
              value={resolvedState.mailboxId ?? ''}
            >
              <option value="">全部邮箱</option>
              {mailboxOptions.map((mailbox) => (
                <option key={mailbox.id} value={mailbox.id}>
                  {mailbox.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <SearchToggleButton active={resolvedState.unreadOnly} dataTestId="search-filter-unread" label="仅未读" onClick={toggleUnread} />
          <SearchToggleButton active={resolvedState.hasAttachment} dataTestId="search-filter-attachment" label="含附件" onClick={toggleAttachment} />
          <SearchToggleButton active={resolvedState.flaggedOnly} dataTestId="search-filter-flagged" label="已标旗" onClick={toggleFlagged} />
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
          eyebrow="搜索上下文异常"
          title={`无法初始化搜索上下文：${shellErrorMessage}`}
        >
          邮箱导航尚未完成，因此搜索暂时不会发起真实查询。
        </ThreadListMessageCard>
      ) : !hasCriteria ? (
        <ThreadListMessageCard eyebrow="等待搜索" title="输入关键词或启用筛选开始搜索">
          顶部搜索框支持直接输入，下面的范围与快速筛选会一并写入 URL，刷新或前进后退后仍能保持当前搜索状态。
        </ThreadListMessageCard>
      ) : searchQuery.isLoading && !searchQuery.data ? (
        <ThreadListSkeleton />
      ) : searchQuery.isError ? (
        <ThreadListMessageCard
          actions={
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-accent/40 bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent/90"
              onClick={() => void searchQuery.refetch()}
              type="button"
            >
              重试搜索
            </button>
          }
          eyebrow="搜索异常"
          title={searchQuery.error instanceof Error ? searchQuery.error.message : '搜索失败'}
        >
          当前搜索暂时无法返回结果，但页面结构会保持稳定，你仍可调整条件后重试。
        </ThreadListMessageCard>
      ) : (searchQuery.data?.rows.length ?? 0) === 0 ? (
        <ThreadListMessageCard
          actions={
            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent/90"
                onClick={clearSearch}
                type="button"
              >
                清除条件
              </button>
              <Link
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line/80 bg-panel/84 px-4 py-3 text-sm font-medium text-ink transition hover:border-accent/50 hover:text-accent"
                href={buildComposeRouteHref({ accountId: resolvedState.accountId, intent: 'new', returnTo: currentRoute })}
              >
                新建邮件
              </Link>
            </div>
          }
          eyebrow="搜索结果为空"
          title={resolvedState.query.length > 0 ? `没有找到“${resolvedState.query}”的结果` : '当前筛选没有结果'}
        >
          当前搜索条件已正确写入 URL 并完成真实查询，但没有匹配线程。你可以放宽筛选、切换邮箱范围，或清除条件后重新搜索。
        </ThreadListMessageCard>
      ) : (
        <div className="mt-3 space-y-3">
          <ul aria-label="搜索结果线程列表" className="space-y-2.5">
            {searchQuery.data?.rows.map((row, index) => (
              <li key={row.id}>
                <ThreadRowCard
                  contextLabel={resolveMailboxLabel(mailboxItems, row.mailboxId)}
                  index={index}
                  isSelected={row.id === selectedThreadId}
                  onMoveFocus={handleMoveFocus}
                  onSelect={selectThread}
                  row={row}
                />
              </li>
            ))}
          </ul>

          {searchQuery.data?.pagination.hasMore ? (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-[20px] border border-line/80 bg-canvas/78 px-4 py-3 text-sm font-medium text-ink transition hover:border-accent/40 hover:text-accent"
              onClick={loadMore}
              type="button"
            >
              载入更多结果 · 已加载 {searchQuery.data.pagination.totalLoaded}
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}

function SearchToggleButton({ active, dataTestId, label, onClick }: { readonly active: boolean; readonly dataTestId?: string; readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={active
        ? 'inline-flex min-h-11 items-center justify-center rounded-2xl border border-accent/35 bg-accent/14 px-4 py-3 text-sm font-medium text-accent transition hover:bg-accent/18'
        : 'inline-flex min-h-11 items-center justify-center rounded-2xl border border-line/80 bg-panel/84 px-4 py-3 text-sm font-medium text-ink transition hover:border-accent/40 hover:text-accent'}
      data-testid={dataTestId}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
