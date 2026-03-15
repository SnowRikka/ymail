import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailShell } from '@/components/mail/mail-shell';
import { buildSearchRouteHref, resolveSearchRouteState } from '@/lib/jmap/search';
import type { JmapClient } from '@/lib/jmap/types';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockReplace = vi.fn();
let mockPathname = '/mail/search';
let mockSearch = 'accountId=primary&query=contract';
let searchScenario: 'empty' | 'error' | 'ready' = 'ready';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush, refresh: mockRefresh, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

vi.mock('@/lib/jmap/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jmap/provider')>('@/lib/jmap/provider');

  return {
    ...actual,
    useJmapBootstrap: vi.fn(),
    useJmapClient: vi.fn(),
  };
});

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseJmapBootstrap = vi.mocked(useJmapBootstrap);
const mockedUseJmapClient = vi.mocked(useJmapClient);

const mockSession = {
  accounts: {
    primary: {
      accountCapabilities: {
        mail: { key: 'mail', supported: true, urn: 'urn:ietf:params:jmap:mail', value: { emailQuerySortOptions: ['receivedAt'], maxMailboxDepth: 10, maxMailboxesPerEmail: null, maxSizeAttachmentsPerEmail: 1, maxSizeMailboxName: 255, mayCreateTopLevelMailbox: true } },
      },
      id: 'primary',
      isPersonal: true,
      isReadOnly: false,
      name: 'Primary account',
    },
  },
  primaryAccounts: {
    blob: null,
    mail: 'primary',
    quota: null,
    sieve: null,
    submission: null,
  },
  username: 'tester@example.com',
} as const;

const mockMailboxes = [
  { id: 'inbox-id', name: 'Inbox', role: 'inbox', totalThreads: 8, unreadThreads: 3 },
  { id: 'sent-id', name: 'Sent', role: 'sent', totalThreads: 3, unreadThreads: 0 },
  { id: 'drafts-id', name: 'Drafts', role: 'drafts', totalThreads: 1, unreadThreads: 0 },
  { id: 'junk-id', name: 'Junk', role: 'junk', totalThreads: 1, unreadThreads: 0 },
  { id: 'trash-id', name: 'Trash', role: 'trash', totalThreads: 0, unreadThreads: 0 },
  { id: 'archive-id', name: 'Archive', role: 'archive', totalThreads: 4, unreadThreads: 0 },
  { id: 'projects-id', name: 'Projects', role: null, totalThreads: 2, unreadThreads: 0 },
] as const;

const searchData = {
  accountId: 'primary',
  filters: {
    accountId: 'primary',
    field: 'text',
    flaggedOnly: false,
    hasAttachment: false,
    mailboxId: null,
    page: 1,
    query: 'contract',
    selectedThreadId: null,
    unreadOnly: false,
  },
  pagination: { hasMore: false, page: 1, pageSize: 24, totalLoaded: 2 },
  rows: [
    {
      hasAttachment: true,
      id: 'thread-search-1',
      isFlagged: true,
      isUnread: true,
      mailboxId: 'projects-id',
      messageCount: 2,
      preview: 'Contract update preview',
      receivedAt: '2026-03-09T10:00:00.000Z',
      relativeTimeLabel: '昨天',
      senderLabel: 'Legal',
      subject: 'Contract review',
    },
    {
      hasAttachment: false,
      id: 'thread-search-2',
      isFlagged: false,
      isUnread: false,
      mailboxId: 'inbox-id',
      messageCount: 1,
      preview: 'Second preview',
      receivedAt: '2026-03-08T10:00:00.000Z',
      relativeTimeLabel: '2 天前',
      senderLabel: 'Ops',
      subject: 'Contract signed',
    },
  ],
} as const;

function installQueryMocks() {
  mockedUseQuery.mockImplementation((options: { readonly queryKey?: readonly unknown[] }) => {
    const queryKey = Array.isArray(options.queryKey) ? options.queryKey : [];

    if (queryKey[0] === 'mailbox-shell') {
      return {
        data: mockMailboxes,
        isError: false,
        isLoading: false,
      } as never;
    }

    if (queryKey[0] === 'search-results') {
      if (searchScenario === 'error') {
        return {
          data: undefined,
          error: new Error('search query failed'),
          isError: true,
          isLoading: false,
          refetch: vi.fn(),
        } as never;
      }

      if (searchScenario === 'empty') {
        return {
          data: {
            ...searchData,
            pagination: { hasMore: false, page: 1, pageSize: 24, totalLoaded: 0 },
            rows: [],
          },
          isError: false,
          isLoading: false,
          refetch: vi.fn(),
        } as never;
      }

      return {
        data: searchData,
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      } as never;
    }

    return {
      data: undefined,
      isError: false,
      isLoading: false,
    } as never;
  });
}

async function renderSearchShell() {
  await act(async () => {
    render(
      <MailShell eyebrow="搜索" intro="intro" listPaneTestId="search-results" listPaneVariant="search" readerTitle="search" sectionTitle="结果">
        <div>reader</div>
      </MailShell>,
    );
  });
}

beforeEach(() => {
  vi.useRealTimers();
  mockPathname = '/mail/search';
  mockSearch = 'accountId=primary&query=contract';
  searchScenario = 'ready';
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockReplace.mockReset();
  mockedUseJmapClient.mockReturnValue({} as JmapClient);
  mockedUseJmapBootstrap.mockReturnValue({
    data: {
      session: mockSession,
      status: 'ready',
    },
    isLoading: false,
  } as never);
  installQueryMocks();
});

describe('search', () => {
  it('serializes and restores constrained search route state', () => {
    const href = buildSearchRouteHref({
      accountId: 'primary',
      field: 'recipient',
      flaggedOnly: true,
      hasAttachment: true,
      mailboxId: 'projects-id',
      page: 2,
      pathname: '/mail/search',
      query: 'contract',
      selectedThreadId: 'thread-search-1',
      unreadOnly: true,
    });

    expect(href).toContain('accountId=primary');
    expect(href).toContain('field=recipient');
    expect(href).toContain('mailboxId=projects-id');

    const restored = resolveSearchRouteState(new URLSearchParams(href.split('?')[1]));
    expect(restored).toEqual({
      accountId: 'primary',
      field: 'recipient',
      flaggedOnly: true,
      hasAttachment: true,
      mailboxId: 'projects-id',
      page: 2,
      query: 'contract',
      selectedThreadId: 'thread-search-1',
      unreadOnly: true,
    });
  });

  it('renders global search, quick filters, and shared result rows', async () => {
    await renderSearchShell();

    expect(screen.getByTestId('global-search')).toBeInTheDocument();
    expect(screen.getByTestId('search-submit')).toBeInTheDocument();
    expect(screen.getByTestId('search-filter-unread')).toBeInTheDocument();
    expect(screen.getByTestId('search-filter-attachment')).toBeInTheDocument();
    expect(screen.getByTestId('search-results')).toBeInTheDocument();
    expect(screen.getByTestId('thread-row-thread-search-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('search-filter-unread'));

    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('unread=1'));
  });

  it('removes decorative search copy and localizes system mailbox scope labels', async () => {
    await renderSearchShell();

    expect(screen.queryByText('黑曜搜索轨道')).not.toBeInTheDocument();
    expect(screen.queryByText('第 1 页')).not.toBeInTheDocument();
    expect(screen.queryByText('关键词 contract')).not.toBeInTheDocument();
    expect(screen.queryByText(/·\s*搜索结果/)).not.toBeInTheDocument();

    const mailboxScope = screen.getByLabelText('邮箱范围');
    const optionLabels = Array.from(mailboxScope.querySelectorAll('option')).map((option) => option.textContent);

    expect(optionLabels).toEqual(expect.arrayContaining(['收件箱', '已发送', '草稿', '垃圾邮件', '废纸篓', '归档', 'Projects']));
    expect(optionLabels).not.toEqual(expect.arrayContaining(['Inbox', 'Sent', 'Drafts', 'Junk', 'Trash', 'Archive']));
  });

  it('does not render the empty-state helper paragraph before a search starts', async () => {
    mockSearch = 'accountId=primary';

    await renderSearchShell();

    const title = screen.getByText('输入关键词或启用筛选开始搜索');

    expect(title).toBeInTheDocument();
    expect(title.closest('div')?.querySelector('p')).toBeNull();
    expect(screen.queryByText('顶部搜索框支持直接输入，下面的范围与快速筛选会一并写入 URL，刷新或前进后退后仍能保持当前搜索状态。')).not.toBeInTheDocument();
  });

  it('debounces URL updates while editing the top search field', async () => {
    vi.useFakeTimers();
    await renderSearchShell();

    act(() => {
      fireEvent.change(screen.getByTestId('global-search'), { target: { value: 'contract final' } });
      vi.advanceTimersByTime(300);
    });

    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('query=contract+final'));
  });

  it('submits the restyled top search bar from a mailbox route', async () => {
    mockPathname = '/mail/inbox';
    mockSearch = 'accountId=primary';
    await renderSearchShell();

    fireEvent.change(screen.getByTestId('global-search'), { target: { value: 'project alpha' } });
    fireEvent.click(screen.getByTestId('search-submit'));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/mail/search?'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('accountId=primary'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('query=project+alpha'));
  });

  it('renders a stable zero-result state', async () => {
    searchScenario = 'empty';
    installQueryMocks();

    await renderSearchShell();

    expect(screen.getByText('没有找到“contract”的结果')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除条件' })).toBeInTheDocument();
    expect(screen.queryByText('当前搜索条件已正确写入 URL 并完成真实查询，但没有匹配线程。你可以放宽筛选、切换邮箱范围，或清除条件后重新搜索。')).not.toBeInTheDocument();
  });

  it('persists route-backed filters and thread selection on reload', async () => {
    mockSearch = 'accountId=primary&query=contract&field=recipient&unread=1&attachment=1&flagged=1&mailboxId=projects-id&threadId=thread-search-1';
    await renderSearchShell();

    expect(screen.getByTestId('global-search')).toHaveValue('contract');
    expect(screen.getByTestId('search-filter-unread')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('search-filter-attachment')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('search-filter-flagged')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('thread-row-thread-search-1')).toHaveAttribute('aria-current', 'true');
  });
});
