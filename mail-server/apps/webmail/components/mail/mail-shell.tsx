'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { LogoutButton } from '@/components/mail/logout-button';
import { ThreadListPanel } from '@/components/mail/thread-list-panel';
import { GlobalSearchForm } from '@/components/search/global-search-form';
import { SearchResultsPanel } from '@/components/search/search-results-panel';
import type { SafeSessionSummary } from '@/lib/auth/types';
import { buildFreshComposeRouteHref } from '@/lib/jmap/compose-core';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';
import { buildMailboxShellViewModel, queryMailboxCollection, resolveMailboxAccountId, type MailboxCollectionData, type MailboxNavigationItem, type MailboxShellViewModel } from '@/lib/jmap/mailbox-shell';
import type { JmapMailboxObject } from '@/lib/jmap/types';
import { useRealtimeSync } from '@/lib/realtime/sync';
import { cn } from '@/lib/utils';

export interface MailShellProps {
  readonly children: React.ReactNode;
  readonly eyebrow: string;
  readonly intro: string;
  readonly listPaneTestId?: string;
  readonly listPaneVariant?: 'search' | 'threads';
  readonly readerTitle: string;
  readonly sectionTitle: string;
  readonly sessionSummary?: SafeSessionSummary | null;
}

interface MailShellContextValue {
  readonly mailboxItems: readonly MailboxNavigationItem[];
}

const MailShellContext = createContext<MailShellContextValue>({ mailboxItems: [] });

export function useMailShellContext() {
  return useContext(MailShellContext);
}

export interface MailShellListPaneProps {
  readonly activeAccountId: string | null;
  readonly activeMailbox: MailboxNavigationItem | null;
  readonly activeMailboxName: string;
  readonly isShellLoading: boolean;
  readonly shellErrorMessage: string | null;
  readonly topline: string;
  readonly viewModel: MailboxShellViewModel | null;
}

function resolveMailboxCollectionData(data: MailboxCollectionData | readonly JmapMailboxObject[] | undefined) {
  if (!data) {
    return [] as const;
  }

  return 'list' in data ? data.list : data;
}

function formatMailboxRoleLabel(role: string) {
  switch (role) {
    case 'all':
      return '全部邮件';
    case 'archive':
      return '归档';
    case 'drafts':
      return '草稿';
    case 'important':
      return '重要';
    case 'inbox':
      return '收件箱';
    case 'junk':
      return '垃圾邮件';
    case 'sent':
      return '已发送';
    case 'trash':
      return '废纸篓';
    default:
      return role;
  }
}

function formatMailboxDisplayName(mailbox: Pick<MailboxNavigationItem, 'name' | 'role'> | null | undefined) {
  if (!mailbox) {
    return '';
  }

  return mailbox.role ? formatMailboxRoleLabel(mailbox.role) : mailbox.name;
}

export function MailShell({ children, eyebrow, intro, listPaneTestId = 'thread-list', listPaneVariant = 'threads', readerTitle, sectionTitle, sessionSummary }: MailShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const client = useJmapClient();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const bootstrapQuery = useJmapBootstrap(isHydrated);
  const readySession = bootstrapQuery.data?.status === 'ready' ? bootstrapQuery.data.session : null;
  const accountIdFromUrl = searchParams.get('accountId');
  const searchMailboxId = searchParams.get('mailboxId');
  const activeAccountId = readySession ? resolveMailboxAccountId(readySession, accountIdFromUrl) : null;
  const currentRoute = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;

  const mailboxQuery = useQuery<MailboxCollectionData | readonly JmapMailboxObject[]>({
    enabled: Boolean(isHydrated && activeAccountId && readySession),
    queryFn: async () => {
      if (!activeAccountId) {
        return {
          accountId: '',
          ids: [],
          list: [],
          state: '',
        } satisfies MailboxCollectionData;
      }

      return queryMailboxCollection({
        accountId: activeAccountId,
        client,
      });
    },
    queryKey: ['mailbox-shell', activeAccountId],
    staleTime: 1000 * 60,
  });

  const mailboxData = resolveMailboxCollectionData(mailboxQuery.data);
  const viewModel: MailboxShellViewModel | null = readySession && activeAccountId
    ? buildMailboxShellViewModel({
        accountId: activeAccountId,
        mailboxes: mailboxData,
        pathname,
        searchMailboxId,
        session: readySession,
      })
    : null;

  const activeMailbox = viewModel?.mailboxItems.find((mailbox) => mailbox.isActive) ?? null;
  const topline = viewModel?.activeMailboxRole ? `${formatMailboxRoleLabel(viewModel.activeMailboxRole)} · ${sectionTitle}` : sectionTitle;
  const shellErrorMessage = mailboxQuery.isError ? (mailboxQuery.error instanceof Error ? mailboxQuery.error.message : '请稍后重试。') : null;
  const isShellLoading = bootstrapQuery.isLoading || mailboxQuery.isLoading;
  const accountDisplayName = viewModel?.activeAccountLabel ?? sessionSummary?.username ?? '载入中';
  const accountAvatarLabel = accountDisplayName.trim().charAt(0).toUpperCase() || '…';

  useRealtimeSync({
    activeAccountId,
    activeMailboxId: activeMailbox?.id ?? null,
    enabled: isHydrated && shellErrorMessage === null,
  });

  const listPaneProps: MailShellListPaneProps = {
    activeAccountId,
    activeMailbox,
    activeMailboxName: activeMailbox ? formatMailboxDisplayName(activeMailbox) : '载入邮箱',
    isShellLoading,
    shellErrorMessage,
    topline,
    viewModel,
  };
  const listPaneLabel = listPaneVariant === 'search' ? '搜索结果' : '线程列表';

  const openFreshCompose = () => {
    router.push(buildFreshComposeRouteHref({ accountId: activeAccountId, returnTo: currentRoute }));
  };

  const listPane = listPaneVariant === 'search'
    ? <SearchResultsPanel {...listPaneProps} />
    : (
        <ThreadListPanel
          activeAccountId={listPaneProps.activeAccountId}
          activeMailbox={listPaneProps.activeMailbox}
          activeMailboxName={listPaneProps.activeMailboxName}
          isShellLoading={listPaneProps.isShellLoading}
          mailboxItems={listPaneProps.viewModel?.mailboxItems ?? []}
          shellErrorMessage={listPaneProps.shellErrorMessage}
          topline={listPaneProps.topline}
        />
      );
  const readerPane = children;

  return (
    <MailShellContext.Provider value={{ mailboxItems: viewModel?.mailboxItems ?? [] }}>
      <main className="relative min-h-screen bg-transparent px-2 py-2 text-ink sm:px-3 sm:py-3 lg:px-5 lg:py-5" data-testid="app-shell">
      <nav aria-label="快速跳转" className="pointer-events-none fixed left-3 top-3 z-50 flex flex-col gap-2 sm:left-5 sm:top-5">
        <a className="sr-only rounded-full border border-accent/40 bg-panel/96 px-4 py-2 text-sm text-ink shadow-shell pointer-events-auto focus:not-sr-only" href="#mail-thread-list">
          跳到线程列表
        </a>
        <a className="sr-only rounded-full border border-accent/40 bg-panel/96 px-4 py-2 text-sm text-ink shadow-shell pointer-events-auto focus:not-sr-only" href="#mail-reader-pane">
          跳到阅读器
        </a>
        <a className="sr-only rounded-full border border-accent/40 bg-panel/96 px-4 py-2 text-sm text-ink shadow-shell pointer-events-auto focus:not-sr-only" href="#mail-sidebar">
          跳到系统邮箱
        </a>
      </nav>
      <section className="shell-surface min-h-[calc(100vh-1rem)] rounded-[28px] border border-line/90 p-3 shadow-shell sm:min-h-[calc(100vh-1.5rem)] sm:rounded-[30px] lg:min-h-[calc(100vh-2.5rem)] lg:p-4">
        <header className="stage-reveal rounded-[24px] border border-line/80 bg-panel/92 px-4 py-4" style={{ ['--stage-delay' as string]: '0.04s' }}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.34em] text-accent/78">
                <span>{eyebrow}</span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-ink lg:text-[2.5rem]">{readerTitle}</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">{intro}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:min-w-[300px] xl:max-w-[420px] xl:items-end">
              <div className="flex flex-wrap items-center justify-end gap-3 rounded-[20px] border border-line/70 bg-canvas/70 px-3 py-3 text-right">
                <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/12 font-mono text-sm uppercase tracking-[0.2em] text-accent">
                  {accountAvatarLabel}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-muted">当前账号</p>
                  <p className="mt-1 truncate text-sm font-medium text-ink">{accountDisplayName}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  aria-label="新建邮件"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  data-testid="new-mail-button"
                  onClick={openFreshCompose}
                  type="button"
                >
                  <ComposeIcon className="h-4 w-4" />
                  新建邮件
                </button>
                <LogoutButton />
              </div>

              <div className="w-full xl:max-w-[420px]">
                <GlobalSearchForm accountId={activeAccountId} mailboxId={activeMailbox?.id ?? null} mailboxName={activeMailbox?.name ?? null} />
              </div>
            </div>
          </div>
        </header>

        <div className="mt-3 grid gap-3 lg:grid-cols-[272px_minmax(320px,380px)_minmax(0,1fr)]" data-testid="mail-layout">
          <aside
            aria-label="系统邮箱"
            className="stage-reveal order-3 rounded-[24px] border border-line/80 bg-panel/94 p-3 lg:order-none"
            data-testid="mailbox-sidebar"
            id="mail-sidebar"
            style={{ ['--stage-delay' as string]: '0.08s' }}
          >
            <MailboxSection heading="系统邮箱" items={viewModel?.systemItems ?? []} titleId="mail-sidebar-title" />
          </aside>

          <section aria-label={listPaneLabel} className="stage-reveal order-1 rounded-[24px] border border-line/80 bg-panel/94 p-3 lg:order-none" data-testid={listPaneTestId} id="mail-thread-list" style={{ ['--stage-delay' as string]: '0.14s' }}>
            {listPane}
          </section>

          <section aria-label="阅读器" className="stage-reveal order-2 rounded-[24px] border border-line/80 bg-panel/94 p-4 lg:order-none lg:p-5" data-testid="reader-pane" id="mail-reader-pane" style={{ ['--stage-delay' as string]: '0.2s' }}>
            {readerPane}
          </section>
        </div>
      </section>
      </main>
    </MailShellContext.Provider>
  );
}

interface MailboxSectionProps {
  readonly emptyLabel?: string;
  readonly heading: string;
  readonly items: readonly MailboxNavigationItem[];
  readonly titleId?: string;
}

function MailboxSection({ emptyLabel = '暂无内容', heading, items, titleId }: MailboxSectionProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[11px] uppercase tracking-[0.28em] text-muted" id={titleId}>{heading}</h2>
        <span className="font-mono text-[10px] text-muted">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-line/70 px-3 py-4 text-sm text-muted">{emptyLabel}</div>
      ) : (
        <nav aria-label={`${heading}列表`} className="space-y-1.5">
          {items.map((item, index) => (
            <Link
              aria-current={item.isActive ? 'page' : undefined}
              aria-label={`${formatMailboxDisplayName(item)}，未读 ${item.unreadCount} 封`}
              className={cn(
                'stage-reveal group relative flex items-center gap-3 overflow-hidden rounded-[18px] border px-3 py-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                item.isActive
                  ? 'border-accent/30 bg-[linear-gradient(90deg,rgba(0,122,255,0.12),rgba(0,0,0,0))] text-ink shadow-[inset_1px_0_0_rgba(0,122,255,0.18)]'
                  : 'border-transparent bg-transparent text-muted hover:border-line/70 hover:bg-canvas/70 hover:text-ink',
              )}
              data-testid={`mailbox-item-${item.id}`}
              href={item.href}
              key={item.id}
              style={{ ['--stage-delay' as string]: `${0.24 + index * 0.02}s`, paddingLeft: `${0.85 + item.depth * 0.8}rem` }}
            >
              <span className={cn('absolute inset-y-2 left-0 w-[2px] rounded-full bg-accent transition-opacity', item.isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-line/70 bg-panel/80 text-ink">
                <MailboxIcon role={item.role} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-current">{formatMailboxDisplayName(item)}</span>
                <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{item.kind}</span>
              </span>
              <span className={cn('rounded-full border px-2 py-0.5 font-mono text-[10px]', item.unreadCount > 0 ? 'border-accent/30 bg-accent/12 text-accent' : 'border-line/70 text-muted')}>
                {item.unreadCount}
              </span>
            </Link>
          ))}
        </nav>
      )}
    </section>
  );
}

function MailboxIcon({ role }: { readonly role: MailboxNavigationItem['role'] }) {
  if (role === 'sent') {
    return <SendIcon className="h-4 w-4" />;
  }

  if (role === 'drafts') {
    return <ComposeIcon className="h-4 w-4" />;
  }

  if (role === 'junk') {
    return <AlertIcon className="h-4 w-4" />;
  }

  if (role === 'trash') {
    return <TrashIcon className="h-4 w-4" />;
  }

  if (role === 'archive') {
    return <ArchiveIcon className="h-4 w-4" />;
  }

  if (role === 'important') {
    return <StarIcon className="h-4 w-4" />;
  }

  return <InboxIcon className="h-4 w-4" />;
}

function InboxIcon({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 13h4.2a1 1 0 0 1 .8.4l1.2 1.6h3.6l1.2-1.6a1 1 0 0 1 .8-.4H20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function ComposeIcon({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M4 17.25V20h2.75L17.5 9.25l-2.75-2.75L4 17.25Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="m13.75 7.25 2.75 2.75" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function SendIcon({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M4 11.5 19 4l-4.8 16-3.4-5.1L4 11.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M10.8 14.9 19 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function AlertIcon({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M12 8.5v4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="12" cy="16.5" fill="currentColor" r="1" />
      <path d="M10.2 4.9a2 2 0 0 1 3.6 0l5.4 10.8A2 2 0 0 1 17.4 19H6.6a2 2 0 0 1-1.8-3.3L10.2 4.9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function TrashIcon({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M5.5 7h13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <path d="M9 4.5h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <path d="m7 7 .7 10.5a2 2 0 0 0 2 1.9h4.6a2 2 0 0 0 2-1.9L17 7" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function ArchiveIcon({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M5 7.5A1.5 1.5 0 0 1 6.5 6h11A1.5 1.5 0 0 1 19 7.5v1A1.5 1.5 0 0 1 17.5 10h-11A1.5 1.5 0 0 1 5 8.5v-1Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10v6.5A1.5 1.5 0 0 0 8 18h8a1.5 1.5 0 0 0 1.5-1.5V10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 13h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function StarIcon({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="m12 4 2.4 4.85 5.35.78-3.87 3.76.92 5.32L12 16.3l-4.8 2.41.92-5.32L4.25 9.63l5.35-.78L12 4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  );
}
