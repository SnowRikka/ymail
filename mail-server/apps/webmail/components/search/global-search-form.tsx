'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { buildSearchRouteHref, resolveSearchRouteState } from '@/lib/jmap/search';

export interface GlobalSearchFormProps {
  readonly accountId: string | null;
  readonly mailboxId: string | null;
  readonly mailboxName: string | null;
}

export function GlobalSearchForm({ accountId, mailboxId, mailboxName }: GlobalSearchFormProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeState = useMemo(() => resolveSearchRouteState(searchParams), [searchParams]);
  const [draftQuery, setDraftQuery] = useState(routeState.query);
  const isSearchRoute = pathname === '/mail/search';

  useEffect(() => {
    setDraftQuery(routeState.query);
  }, [routeState.query]);

  useEffect(() => {
    if (!isSearchRoute || draftQuery === routeState.query) {
      return;
    }

    const timer = window.setTimeout(() => {
      router.replace(
        buildSearchRouteHref({
          ...routeState,
          accountId: routeState.accountId ?? accountId,
          mailboxId: routeState.mailboxId,
          page: 1,
          query: draftQuery.trim(),
          selectedThreadId: null,
        }),
      );
    }, 280);

    return () => window.clearTimeout(timer);
  }, [accountId, draftQuery, isSearchRoute, routeState, router]);

  const scopeLabel = mailboxName && mailboxId ? `范围：${mailboxName}` : '范围：全部邮箱';

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const href = buildSearchRouteHref({
      ...routeState,
      accountId: routeState.accountId ?? accountId,
      mailboxId: routeState.mailboxId ?? mailboxId,
      page: 1,
      query: draftQuery.trim(),
      selectedThreadId: null,
    });

    if (isSearchRoute) {
      router.replace(href);
      return;
    }

    router.push(href);
  };

  return (
    <form aria-label="邮件搜索" className="w-full" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="global-search-input">搜索邮件</label>
      <span className="sr-only" id="global-search-scope">{scopeLabel}</span>
      <div className="flex items-center gap-3 rounded-full border border-line/80 bg-mist/95 px-3 py-2 shadow-shell backdrop-blur sm:px-4">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line/70 bg-canvas/78 text-muted">
          <SearchIcon className="h-4 w-4" />
        </span>
        <input
          aria-describedby="global-search-scope"
          className="min-w-0 flex-1 border-0 bg-transparent px-0 py-2 text-sm text-ink outline-none ring-0 placeholder:text-muted/80"
          data-testid="global-search"
          id="global-search-input"
          onChange={(event) => setDraftQuery(event.target.value)}
          placeholder="搜索邮件"
          type="search"
          value={draftQuery}
        />
        <button
          aria-label="执行搜索"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-sm font-medium text-accent-deep transition hover:border-accent/45 hover:bg-accent/18 hover:text-ink focus-visible:outline-none"
          data-testid="search-submit"
          type="submit"
        >
          <SearchIcon className="h-4 w-4" />
          <span className="hidden sm:inline">搜索</span>
        </button>
      </div>
    </form>
  );
}

function SearchIcon({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m15 15 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}
