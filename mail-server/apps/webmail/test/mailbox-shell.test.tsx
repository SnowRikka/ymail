import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailShell } from '@/components/mail/mail-shell';
import { ToastProvider } from '@/components/system/toast-region';
import { buildMailboxShellViewModel, resolveMailboxAccountId } from '@/lib/jmap/mailbox-shell';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';

async function renderShell() {
  render(
    <ToastProvider>
      <MailShell eyebrow="顶部眉文" intro="顶部说明文本" readerTitle="顶部标题文本" sectionTitle="list">
        <div>reader content</div>
      </MailShell>
    </ToastProvider>,
  );

  await screen.findByTestId('thread-list');
}

const mockPush = vi.fn();
let mockPathname = '/mail/mailbox/project-root';
let mockSearch = 'accountId=primary';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

vi.mock('@/lib/realtime/sync', () => ({
  useRealtimeSync: () => ({
    capabilityMode: 'none',
    errorMessage: null,
    phase: 'disabled',
    runtimeMode: 'polling',
    statusLabel: '实时同步已停用',
    toastMessage: null,
  }),
}));

vi.mock('@/components/mail/logout-button', () => ({
  LogoutButton: () => <button data-testid="logout-button" type="button">退出</button>,
}));

vi.mock('@/components/search/global-search-form', () => ({
  GlobalSearchForm: () => <form data-testid="global-search" />,
}));

vi.mock('@/lib/jmap/provider', () => ({
  useJmapBootstrap: vi.fn(),
  useJmapClient: vi.fn(),
}));

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseJmapBootstrap = vi.mocked(useJmapBootstrap);
const mockedUseJmapClient = vi.mocked(useJmapClient);

const mockThreadData = {
  accountId: 'primary',
  mailboxId: 'project-root',
  pagination: {
    hasMore: false,
    page: 1,
    pageSize: 24,
    totalLoaded: 2,
  },
  rows: [
    {
      hasAttachment: false,
      id: 'thread-project-1',
      isFlagged: true,
      isUnread: true,
      messageCount: 3,
      preview: 'Alpha stream preview',
      receivedAt: '2026-03-09T10:00:00.000Z',
      relativeTimeLabel: '昨天',
      senderLabel: 'Alpha',
      subject: 'Project kickoff',
    },
    {
      hasAttachment: true,
      id: 'thread-project-2',
      isFlagged: false,
      isUnread: false,
      messageCount: 1,
      preview: 'Second preview',
      receivedAt: '2026-03-08T10:00:00.000Z',
      relativeTimeLabel: '2 天前',
      senderLabel: 'Beta',
      subject: 'Status update',
    },
  ],
  sync: {
    emailQueryState: 'query-state-1',
    threadState: 'thread-state-1',
  },
} as const;

const mockSession = {
  accounts: {
    primary: {
      accountCapabilities: {
        mail: { key: 'mail', supported: true, urn: 'urn:ietf:params:jmap:mail', value: { emailQuerySortOptions: [], maxMailboxDepth: 10, maxMailboxesPerEmail: null, maxSizeAttachmentsPerEmail: 1, maxSizeMailboxName: 255, mayCreateTopLevelMailbox: true } },
      },
      id: 'primary',
      isPersonal: true,
      isReadOnly: false,
      name: 'Primary account',
    },
    shared: {
      accountCapabilities: {
        mail: { key: 'mail', supported: true, urn: 'urn:ietf:params:jmap:mail', value: { emailQuerySortOptions: [], maxMailboxDepth: 10, maxMailboxesPerEmail: null, maxSizeAttachmentsPerEmail: 1, maxSizeMailboxName: 255, mayCreateTopLevelMailbox: true } },
      },
      id: 'shared',
      isPersonal: false,
      isReadOnly: true,
      name: 'Shared ops',
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
  { id: 'trash-id', name: 'Trash', role: 'trash', totalThreads: 0, unreadThreads: 0 },
  { id: 'project-root', name: 'Projects', parentId: null, role: null, sortOrder: 20, totalThreads: 0, unreadThreads: 0 },
  { id: 'inbox-id', name: 'Inbox', role: 'inbox', sortOrder: 10, totalThreads: 12, unreadThreads: 4 },
  { id: 'drafts-id', name: 'Drafts', role: 'drafts', sortOrder: 30, totalThreads: 2, unreadThreads: 1 },
  { id: 'junk-id', name: 'Junk', role: 'junk', sortOrder: 35, totalThreads: 6, unreadThreads: 2 },
  { id: 'project-child', name: 'Alpha', parentId: 'project-root', role: null, sortOrder: 10, totalThreads: 0, unreadThreads: 0 },
  { id: 'archive-id', name: 'Archive', role: 'archive', sortOrder: 40, totalThreads: 8, unreadThreads: 0 },
  { id: 'sent-id', name: 'Sent', role: 'sent', sortOrder: 20, totalThreads: 2, unreadThreads: 0 },
] as const;

function installQueryMocks(threadRows: readonly (typeof mockThreadData.rows)[number][] = mockThreadData.rows) {
  const mailboxQueryResult = {
    data: mockMailboxes,
    isError: false,
    isLoading: false,
  } as const;
  const threadQueryResult = {
    data: {
      ...mockThreadData,
      rows: threadRows,
    },
    isError: false,
    isLoading: false,
  } as const;

  mockedUseQuery.mockImplementation((options) => {
    const queryKey = Array.isArray(options.queryKey) ? options.queryKey : [];

    if (queryKey[0] === 'mailbox-shell') {
      return mailboxQueryResult as never;
    }

    if (queryKey[0] === 'thread-list') {
      return threadQueryResult as never;
    }

    return {
      data: undefined,
      isError: false,
      isLoading: false,
    } as never;
  });
}

beforeEach(() => {
  mockPush.mockReset();
  mockPathname = '/mail/mailbox/project-root';
  mockSearch = 'accountId=primary';
  mockedUseJmapClient.mockReturnValue({
    mailbox: {
      get: vi.fn(),
      query: vi.fn(),
    },
  } as never);
  mockedUseJmapBootstrap.mockReturnValue({
    data: {
      session: mockSession,
      status: 'ready',
    },
    isLoading: false,
  } as never);
  installQueryMocks();
});

describe('mailbox-shell', () => {
  it('orders standard roles before custom folders', () => {
    const viewModel = buildMailboxShellViewModel({
      accountId: 'primary',
      mailboxes: mockMailboxes,
      pathname: '/mail/mailbox/project-root',
      session: mockSession as never,
    });

    expect(viewModel.systemItems.map((item) => item.id)).toEqual(['inbox-id', 'sent-id', 'drafts-id', 'junk-id', 'trash-id', 'archive-id']);
    expect(viewModel.customItems.map((item) => item.id)).toEqual(['project-root', 'project-child']);
  });

  it('falls back to the first usable mail account when primary mail account is invalid', () => {
    expect(resolveMailboxAccountId({
      ...mockSession,
      primaryAccounts: {
        ...mockSession.primaryAccounts,
        mail: 'ghost-account',
      },
    } as never)).toBe('primary');
  });

  it('preserves valid route account selection', () => {
    expect(resolveMailboxAccountId(mockSession as never, 'shared')).toBe('shared');
  });

  it('ignores unusable route account ids and falls back to a valid mail account', () => {
    expect(resolveMailboxAccountId(mockSession as never, 'ghost-account')).toBe('primary');
  });

  it('renders unread counters, active mailbox state, and stable selectors', async () => {
    await renderShell();

    expect(screen.getByTestId('mailbox-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '跳到系统邮箱' })).toHaveAttribute('href', '#mail-sidebar');
    expect(screen.queryByRole('link', { name: /邮箱导航/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '系统邮箱' })).toBeInTheDocument();
    expect(screen.getByTestId('mailbox-item-inbox-id')).toHaveTextContent('4');
    expect(screen.queryByTestId('mailbox-item-project-root')).not.toBeInTheDocument();
    expect(screen.queryByText('自定义')).not.toBeInTheDocument();
    expect(screen.queryByText('黑曜工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('顶部眉文')).not.toBeInTheDocument();
    expect(screen.queryByText('顶部标题文本')).not.toBeInTheDocument();
    expect(screen.queryByText('顶部说明文本')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('切换账号')).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-switcher')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*个账号/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('account-chip')).toBeInTheDocument();
    expect(screen.getByTestId('global-search')).toBeInTheDocument();
    expect(screen.getByTestId('account-chip-avatar')).toHaveTextContent('P');
    expect(screen.getByTestId('account-chip-trigger')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('account-chip-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Primary account')).not.toBeInTheDocument();
    expect(screen.queryByTestId('logout-button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('account-chip-trigger'));
    expect(screen.getByTestId('account-chip-trigger')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('account-chip-panel')).toBeInTheDocument();
    expect(screen.getByText('Primary account')).toBeInTheDocument();
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
    expect(screen.getAllByTestId('new-mail-button')).toHaveLength(1);
    expect(within(screen.getByTestId('thread-list')).getByTestId('new-mail-button')).toBeInTheDocument();
    expect(screen.getByTestId('thread-row-thread-project-1')).toBeInTheDocument();
  });

  it('reuses the shared top card styling for system mailbox routes', async () => {
    mockPathname = '/mail/mailbox/archive-id';

    await renderShell();

    const threadList = screen.getByTestId('thread-list');

    expect(within(threadList).getByTestId('thread-top-card')).toBeInTheDocument();
    expect(within(threadList).getByRole('heading', { level: 2, name: '归档' })).toBeInTheDocument();
    expect(within(threadList).getByTestId('thread-top-card-stats')).toHaveTextContent('8 个邮件');
    expect(within(threadList).queryByTestId('thread-top-card-unread')).not.toBeInTheDocument();
    expect(within(threadList).getByTestId('thread-top-card-total')).toHaveTextContent('8 个邮件');
    expect(within(threadList).getByTestId('thread-top-card-page')).toHaveTextContent('第 1 页');
    expect(within(threadList).getByTestId('thread-top-card-selection-toggle')).toHaveTextContent('批量操作');
    expect(within(threadList).getByTestId('new-mail-button')).toHaveClass('col-start-2', 'row-start-1');
    expect(within(threadList).getByTestId('thread-top-card-selection-toggle')).toHaveClass('col-start-2', 'row-start-3');
    expect(within(threadList).getByTestId('thread-top-card-stats')).toContainElement(within(threadList).getByTestId('thread-top-card-total'));
  });

  it('keeps junk top cards on dual unread and total counts', async () => {
    mockPathname = '/mail/mailbox/junk-id';

    await renderShell();

    const threadList = screen.getByTestId('thread-list');

    expect(within(threadList).getByRole('heading', { level: 2, name: '垃圾邮件' })).toBeInTheDocument();
    expect(within(threadList).getByTestId('thread-top-card-stats')).toHaveTextContent('2 未读 · 6 个邮件');
    expect(within(threadList).getByTestId('thread-top-card-unread')).toHaveTextContent('2 未读');
    expect(within(threadList).getByTestId('thread-top-card-unread')).toHaveClass('text-accent');
    expect(within(threadList).getByTestId('thread-top-card-total')).toHaveTextContent('6 个邮件');
  });

  it('renders the fallback mail account instead of a pseudo-loaded shell when primary mail account is invalid', async () => {
    mockSearch = '';
    mockedUseJmapBootstrap.mockReturnValue({
      data: {
        session: {
          ...mockSession,
          primaryAccounts: {
            ...mockSession.primaryAccounts,
            mail: 'ghost-account',
          },
        },
        status: 'ready',
      },
      isLoading: false,
    } as never);

    await renderShell();

    fireEvent.click(screen.getByTestId('account-chip-trigger'));
    expect(screen.getByText('Primary account')).toBeInTheDocument();
    expect(screen.queryByTestId('account-switcher')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByText('载入邮箱')).not.toBeInTheDocument();
  });

  it('falls back from an invalid route account id before rendering the shell', async () => {
    mockPathname = '/mail/inbox';
    mockSearch = 'accountId=ghost-account';

    await renderShell();

    fireEvent.click(screen.getByTestId('account-chip-trigger'));
    expect(screen.getByText('Primary account')).toBeInTheDocument();
    expect(screen.queryByTestId('account-switcher')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '收件箱' })).toBeInTheDocument();
  });

  it('keeps a valid route account id selected during shell rendering', async () => {
    mockPathname = '/mail/inbox';
    mockSearch = 'accountId=shared';

    await renderShell();

    expect(screen.getByTestId('account-chip-avatar')).toHaveTextContent('S');
    fireEvent.click(screen.getByTestId('account-chip-trigger'));
    expect(screen.getByText(/Shared ops/)).toBeInTheDocument();
    expect(screen.queryByTestId('account-switcher')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('thread-list')).getByTestId('new-mail-button'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/mail/compose?intent=new&accountId=shared'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('draftId=fresh-'));
  });

  it('renders an actionable empty mailbox state', async () => {
    installQueryMocks([]);

    await renderShell();

    expect(screen.getByTestId('thread-empty-state')).toBeInTheDocument();
    expect(within(screen.getByTestId('thread-list')).getByTestId('new-mail-button')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('thread-empty-new-mail-button'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/mail/compose?intent=new&accountId=primary'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('draftId=fresh-'));
  });
});
