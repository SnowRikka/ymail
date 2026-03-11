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
    <form aria-label="邮件搜索" className="rounded-[20px] border border-line/70 bg-canvas/70 px-4 py-3" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
          <span>全局搜索</span>
          <span className="font-mono text-[10px] tracking-[0.18em] text-accent/90" id="global-search-scope">{scopeLabel}</span>
        </div>
        <label className="sr-only" htmlFor="global-search-input">搜索邮件</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            aria-describedby="global-search-scope"
            className="w-full rounded-2xl border border-line/80 bg-panel/92 px-4 py-3 text-sm text-ink outline-none ring-0 transition hover:border-accent/40 focus:border-accent"
            data-testid="global-search"
            id="global-search-input"
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="搜索全文、主题、发件人或收件人"
            type="search"
            value={draftQuery}
          />
          <button
            aria-label="执行搜索"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-accent/40 bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent/90"
            data-testid="search-submit"
            type="submit"
          >
            搜索
          </button>
        </div>
      </div>
    </form>
  );
}
