import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailShell } from '@/components/mail/mail-shell';
import { ToastProvider } from '@/components/system/toast-region';
import { queryMailboxThreads } from '@/lib/jmap/thread-list';
import type { JmapClient } from '@/lib/jmap/types';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockReplace = vi.fn();
let mockPathname = '/mail/inbox';
let mockSearch = 'accountId=primary&mailboxId=inbox-id';
let threadScenario: 'empty' | 'error' | 'page-1' | 'page-2' = 'page-1';

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
  { id: 'custom-id', name: 'Projects', role: null, totalThreads: 2, unreadThreads: 0 },
] as const;

const threadPages = {
  'page-1': {
    accountId: 'primary',
    mailboxId: 'inbox-id',
    pagination: { hasMore: true, page: 1, pageSize: 24, totalLoaded: 2 },
    rows: [
      {
        hasAttachment: false,
        id: 'thread-1',
        isFlagged: true,
        isUnread: true,
        messageCount: 3,
        preview: 'Preview one',
        receivedAt: '2026-03-09T10:00:00.000Z',
        relativeTimeLabel: '昨天',
        senderLabel: 'Linear',
        subject: 'Thread one',
      },
      {
        hasAttachment: true,
        id: 'thread-2',
        isFlagged: false,
        isUnread: false,
        messageCount: 1,
        preview: 'Preview two',
        receivedAt: '2026-03-08T10:00:00.000Z',
        relativeTimeLabel: '2 天前',
        senderLabel: 'Stripe',
        subject: 'Thread two',
      },
    ],
    sync: {
      emailQueryState: 'query-state-1',
      threadState: 'thread-state-1',
    },
  },
  'page-2': {
    accountId: 'primary',
    mailboxId: 'inbox-id',
    pagination: { hasMore: false, page: 2, pageSize: 24, totalLoaded: 3 },
    rows: [
      {
        hasAttachment: false,
        id: 'thread-1',
        isFlagged: true,
        isUnread: true,
        messageCount: 3,
        preview: 'Preview one',
        receivedAt: '2026-03-09T10:00:00.000Z',
        relativeTimeLabel: '昨天',
        senderLabel: 'Linear',
        subject: 'Thread one',
      },
      {
        hasAttachment: true,
        id: 'thread-2',
        isFlagged: false,
        isUnread: false,
        messageCount: 1,
        preview: 'Preview two',
        receivedAt: '2026-03-08T10:00:00.000Z',
        relativeTimeLabel: '2 天前',
        senderLabel: 'Stripe',
        subject: 'Thread two',
      },
      {
        hasAttachment: false,
        id: 'thread-3',
        isFlagged: false,
        isUnread: true,
        messageCount: 2,
        preview: 'Preview three',
        receivedAt: '2026-03-07T10:00:00.000Z',
        relativeTimeLabel: '3 天前',
        senderLabel: 'GitHub',
        subject: 'Thread three',
      },
    ],
    sync: {
      emailQueryState: 'query-state-2',
      threadState: 'thread-state-2',
    },
  },
} as const;

function installQueryMocks() {
  const mailboxQueryResult = {
    data: mockMailboxes,
    isError: false,
    isLoading: false,
  } as const;
  const errorQueryResult = {
    data: undefined,
    error: new Error('thread query failed'),
    isError: true,
    isLoading: false,
    refetch: vi.fn(),
  } as const;
  const emptyQueryResult = {
    data: {
      accountId: 'primary',
      mailboxId: 'inbox-id',
      pagination: { hasMore: false, page: 1, pageSize: 24, totalLoaded: 0 },
      rows: [],
      sync: {
        emailQueryState: 'query-state-empty',
        threadState: 'thread-state-empty',
      },
    },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  } as const;
  const pageQueryResults = {
    'page-1': {
      data: threadPages['page-1'],
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    },
    'page-2': {
      data: threadPages['page-2'],
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    },
  } as const;

  mockedUseQuery.mockImplementation((options) => {
    const queryKey = Array.isArray(options.queryKey) ? options.queryKey : [];

    if (queryKey[0] === 'mailbox-shell') {
      return mailboxQueryResult as never;
    }

    if (queryKey[0] === 'thread-list') {
      if (threadScenario === 'error') {
        return errorQueryResult as never;
      }

      if (threadScenario === 'empty') {
        return emptyQueryResult as never;
      }

      return pageQueryResults[threadScenario] as never;
    }

    return {
      data: undefined,
      isError: false,
      isLoading: false,
    } as never;
  });
}

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

beforeEach(() => {
  mockPathname = '/mail/inbox';
  mockSearch = 'accountId=primary&mailboxId=inbox-id';
  threadScenario = 'page-1';
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

describe('thread-list', () => {
  it('renders real thread rows and selectors for the active mailbox', async () => {
    await renderShell();

    expect(screen.getByTestId('thread-list')).toBeInTheDocument();
    expect(screen.getByTestId('thread-row-thread-1')).toBeInTheDocument();
    expect(screen.getByTestId('thread-row-thread-2')).toBeInTheDocument();
    expect(screen.getByTestId('thread-load-more')).toBeInTheDocument();
  });

  it('syncs thread selection into route state', async () => {
    await renderShell();

    fireEvent.click(screen.getByTestId('thread-row-thread-1'));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('threadId=thread-1'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('threadPage=1'));
  });

  it('preserves selected thread and expanded page state from the route', async () => {
    threadScenario = 'page-2';
    mockSearch = 'accountId=primary&mailboxId=inbox-id&threadPage=2&threadId=thread-3';

    await renderShell();

    expect(screen.getByTestId('thread-row-thread-3')).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByTestId('thread-load-more')).not.toBeInTheDocument();
  });

  it('uses replace for deterministic load-more pagination', async () => {
    await renderShell();

    fireEvent.click(screen.getByTestId('thread-load-more'));

    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('threadPage=2'));
  });

  it('renders a stable empty state', async () => {
    threadScenario = 'empty';

    await renderShell();

    expect(screen.getByTestId('thread-empty-state')).toBeInTheDocument();
  });

  it('renders a stable error state', async () => {
    threadScenario = 'error';

    await renderShell();

    expect(screen.getByText('thread query failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试线程查询' })).toBeInTheDocument();
  });

  it('deduplicates thread rows while building paged query results', async () => {
    const firstQueryIds = Array.from({ length: 32 }, (_, index) => `email-${index + 1}`);
    const secondQueryIds = ['email-33', 'email-34'];
    const emailQuery = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        result: {
          kind: 'success',
          response: {
            accountId: 'primary',
            canCalculateChanges: false,
            ids: firstQueryIds,
            position: 0,
            queryState: 'state-1',
            total: 34,
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          kind: 'success',
          response: {
            accountId: 'primary',
            canCalculateChanges: false,
            ids: secondQueryIds,
            position: 32,
            queryState: 'state-2',
            total: 34,
          },
        },
      });
    const emailGet = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        result: {
          kind: 'success',
          response: {
            accountId: 'primary',
            list: firstQueryIds.map((id, index) => ({
              from: [{ email: `sender-${index}@example.com`, name: `Sender ${index}` }],
              id,
              keywords: index === 0 ? { $flagged: true } : {},
              preview: `Preview ${index}`,
              receivedAt: '2026-03-09T10:00:00.000Z',
              subject: `Subject ${index}`,
              threadId: index < 16 ? 'thread-a' : 'thread-b',
            })),
            state: 'state-1',
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          kind: 'success',
          response: {
            accountId: 'primary',
            list: secondQueryIds.map((id, index) => ({
              from: [{ email: `extra-${index}@example.com`, name: `Extra ${index}` }],
              id,
              keywords: {},
              preview: `Extra ${index}`,
              receivedAt: '2026-03-08T10:00:00.000Z',
              subject: `Extra subject ${index}`,
              threadId: index === 0 ? 'thread-c' : 'thread-d',
            })),
            state: 'state-2',
          },
        },
      });
    const threadGet = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        kind: 'success',
        response: {
          accountId: 'primary',
          list: [
            { emailIds: ['a-1', 'a-2'], id: 'thread-a' },
            { emailIds: ['b-1'], id: 'thread-b' },
            { emailIds: ['c-1'], id: 'thread-c' },
            { emailIds: ['d-1'], id: 'thread-d' },
          ],
          state: 'state-3',
        },
      },
    });
    const client = {
      email: {
        get: emailGet,
        query: emailQuery,
      },
      thread: {
        get: threadGet,
      },
    } as unknown as JmapClient;

    const result = await queryMailboxThreads({
      accountId: 'primary',
      client,
      mailboxId: 'inbox-id',
      page: 2,
      pageSize: 2,
    });

    expect(result.rows.map((row) => row.id)).toEqual(['thread-a', 'thread-b', 'thread-c', 'thread-d']);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(result.rows.length);
  });
});
