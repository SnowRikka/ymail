import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailShell } from '@/components/mail/mail-shell';
import { ToastProvider } from '@/components/system/toast-region';
import { buildMailboxShellViewModel, resolveMailboxAccountId } from '@/lib/jmap/mailbox-shell';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';

async function renderShell() {
  render(
    <ToastProvider>
      <MailShell eyebrow="收件箱" intro="intro" readerTitle="reader" sectionTitle="list">
        <div>reader</div>
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

vi.mock('@/components/system/realtime-status', () => ({
  RealtimeStatus: ({ state }: { readonly state: { readonly statusLabel: string } }) => <span data-testid="sync-status">{state.statusLabel}</span>,
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

    expect(viewModel.systemItems.map((item) => item.id)).toEqual(['inbox-id', 'sent-id', 'drafts-id', 'trash-id', 'archive-id']);
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
    expect(screen.getByTestId('mailbox-item-inbox-id')).toHaveTextContent('4');
    expect(screen.getByTestId('mailbox-item-project-root')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('account-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('new-mail-button')).toBeInTheDocument();
    expect(screen.getByTestId('thread-row-thread-project-1')).toBeInTheDocument();
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

    expect(screen.getByTestId('account-switcher')).toHaveValue('primary');
    expect(screen.getByRole('heading', { level: 2, name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByText('载入邮箱')).not.toBeInTheDocument();
  });

  it('falls back from an invalid route account id before rendering the shell', async () => {
    mockPathname = '/mail/inbox';
    mockSearch = 'accountId=ghost-account';

    await renderShell();

    expect(screen.getByTestId('account-switcher')).toHaveValue('primary');
    expect(screen.getByRole('heading', { level: 2, name: '收件箱' })).toBeInTheDocument();
  });

  it('keeps a valid route account id selected during shell rendering', async () => {
    mockPathname = '/mail/inbox';
    mockSearch = 'accountId=shared';

    await renderShell();

    expect(screen.getByTestId('account-switcher')).toHaveValue('shared');
    fireEvent.click(screen.getByTestId('new-mail-button'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/mail/compose?intent=new&accountId=shared'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('draftId=fresh-'));
  });

  it('renders an actionable empty mailbox state', async () => {
    installQueryMocks([]);

    await renderShell();

    expect(screen.getByTestId('thread-empty-state')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('thread-empty-new-mail-button'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/mail/compose?intent=new&accountId=primary'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('draftId=fresh-'));
  });
});
