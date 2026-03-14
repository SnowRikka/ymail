import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginCard } from '@/components/mail/login-card';
import { MailShell } from '@/components/mail/mail-shell';
import { AppProviders } from '@/components/providers/app-providers';
import { isProtectedMailboxPath, toLoginRedirect } from '@/lib/auth/guard';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';

vi.mock('next/navigation', () => ({
  usePathname: () => '/mail/inbox',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('accountId=primary&mailboxId=inbox-id'),
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

async function renderShell() {
  render(
    <AppProviders>
      <MailShell
        eyebrow="顶部眉文 App"
        intro="稳定的占位式邮箱壳层。"
        readerTitle="今日待读"
        sectionTitle=""
      >
        <div>reader</div>
      </MailShell>
    </AppProviders>,
  );

  await screen.findByTestId('thread-list');
}

const mockThreadData = {
  accountId: 'primary',
  mailboxId: 'inbox-id',
  pagination: {
    hasMore: false,
    page: 1,
    pageSize: 24,
    totalLoaded: 1,
  },
  rows: [
    {
      hasAttachment: true,
      id: 'thread-inbox-1',
      isFlagged: false,
      isUnread: true,
      messageCount: 2,
      preview: 'Thread summary preview',
      receivedAt: '2026-03-09T10:00:00.000Z',
      relativeTimeLabel: '昨天',
      senderLabel: 'Linear',
      subject: 'Inbox thread',
    },
  ],
} as const;

beforeEach(() => {
  mockedUseJmapClient.mockReturnValue({
    mailbox: {
      get: vi.fn(),
      query: vi.fn(),
    },
  } as never);
  mockedUseJmapBootstrap.mockReturnValue({
    data: {
      session: {
        accounts: {
          primary: {
            accountCapabilities: {
              mail: { key: 'mail', supported: true, urn: 'urn:ietf:params:jmap:mail', value: { emailQuerySortOptions: [], maxMailboxDepth: 10, maxMailboxesPerEmail: null, maxSizeAttachmentsPerEmail: 1, maxSizeMailboxName: 1, mayCreateTopLevelMailbox: true } },
            },
            id: 'primary',
            isPersonal: true,
            isReadOnly: false,
            name: 'Primary',
          },
        },
        primaryAccounts: { blob: null, mail: 'primary', quota: null, sieve: null, submission: null },
        username: 'tester@example.com',
      },
      status: 'ready',
    },
    isLoading: false,
  } as never);
  mockedUseQuery.mockImplementation((options) => {
    const queryKey = Array.isArray(options.queryKey) ? options.queryKey : [];

    if (queryKey[0] === 'mailbox-shell') {
      return {
        data: [
          { id: 'inbox-id', name: 'Inbox', role: 'inbox', totalThreads: 3, unreadThreads: 2 },
          { id: 'custom-id', name: 'Projects', role: null, totalThreads: 0, unreadThreads: 0 },
        ],
        isError: false,
        isLoading: false,
      } as never;
    }

    if (queryKey[0] === 'thread-list') {
      return {
        data: mockThreadData,
        isError: false,
        isLoading: false,
      } as never;
    }

    return {
      data: undefined,
      isError: false,
      isLoading: false,
    } as never;
  });
});

describe('app-shell', () => {
  it('mounts global providers safely', () => {
    render(
      <AppProviders>
        <div data-testid="provider-probe">ok</div>
      </AppProviders>,
    );

    expect(screen.getByTestId('provider-probe')).toBeInTheDocument();
    expect(screen.getByTestId('toast-region')).toBeInTheDocument();
  });

  it('guards mailbox routes and preserves next target', () => {
    expect(isProtectedMailboxPath('/mail/inbox')).toBe(true);
    expect(isProtectedMailboxPath('/mail/search')).toBe(true);
    expect(isProtectedMailboxPath('/login')).toBe(false);
    expect(toLoginRedirect('/login')).toBe('/login?next=%2Fmail%2Finbox');
    expect(toLoginRedirect('/mail')).toBe('/login?next=%2Fmail');
    expect(toLoginRedirect('/mail/inbox')).toBe('/login?next=%2Fmail%2Finbox');
  });

  it('renders shell selectors for mailbox views', async () => {
    await renderShell();

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('mail-layout')).toBeInTheDocument();
    expect(screen.getByTestId('mailbox-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '跳到系统邮箱' })).toHaveAttribute('href', '#mail-sidebar');
    expect(screen.queryByRole('link', { name: /邮箱导航/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('mailbox-item-inbox-id')).toBeInTheDocument();
    expect(screen.queryByTestId('mailbox-item-custom-id')).not.toBeInTheDocument();
    expect(screen.queryByText('自定义')).not.toBeInTheDocument();
    expect(screen.getByTestId('thread-list')).toBeInTheDocument();
    expect(screen.getByTestId('reader-pane')).toBeInTheDocument();
    expect(screen.queryByText('顶部眉文 App')).not.toBeInTheDocument();
    expect(screen.queryByText('今日待读')).not.toBeInTheDocument();
    expect(screen.queryByText('稳定的占位式邮箱壳层。')).not.toBeInTheDocument();
    expect(screen.queryByText(/收件箱\s*·/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('切换账号')).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-switcher')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*个账号/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('sync-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('account-chip')).toBeInTheDocument();
    expect(screen.getByTestId('account-chip-avatar')).toHaveTextContent('P');
    expect(screen.getByTestId('account-chip-trigger')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByTestId('new-mail-button')).toHaveLength(1);
    expect(within(screen.getByTestId('thread-list')).getByTestId('new-mail-button')).toBeInTheDocument();
    expect(screen.queryByTestId('account-chip-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Primary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('logout-button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('account-chip-trigger'));
    expect(screen.getByTestId('account-chip-trigger')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('account-chip-panel')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });

  it('keeps the account panel interactive and runs logout redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const assignSpy = vi.fn();
    const originalLocation = window.location;
    const mockedLocation = Object.create(originalLocation) as Location;
    const mutableWindow = window as { location?: Location };

    Object.defineProperty(mockedLocation, 'assign', {
      configurable: true,
      value: assignSpy,
    });

    vi.stubGlobal('fetch', fetchMock);
    delete mutableWindow.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: mockedLocation,
    });

    try {
      await renderShell();

      fireEvent.click(screen.getByTestId('account-chip-trigger'));

      const accountPanel = screen.getByTestId('account-chip-panel');
      const accountHeader = accountPanel.closest('header');

      if (!accountHeader) {
        throw new Error('Expected account panel to remain inside the shell header.');
      }

      expect(accountHeader).toHaveClass('relative', 'z-20');

      fireEvent.click(screen.getByTestId('logout-button'));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/auth/logout', { method: 'POST' }));
      await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/login'));
    } finally {
      delete mutableWindow.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('renders login placeholder safely', () => {
    render(<LoginCard nextPath="/mail/inbox" />);

    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('例如：me@example.com')).toBeInTheDocument();
  });
});
