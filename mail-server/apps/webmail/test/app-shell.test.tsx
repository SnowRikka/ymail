import React from 'react';
import { render, screen } from '@testing-library/react';
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
        eyebrow="收件箱"
        intro="稳定的占位式邮箱壳层。"
        readerTitle="今日待读"
        sectionTitle="线程"
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
    expect(screen.getByTestId('thread-list')).toBeInTheDocument();
    expect(screen.getByTestId('reader-pane')).toBeInTheDocument();
    expect(screen.getByTestId('new-mail-button')).toBeInTheDocument();
  });

  it('renders login placeholder safely', () => {
    render(<LoginCard nextPath="/mail/inbox" />);

    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('例如：me@example.com')).toBeInTheDocument();
  });
});
