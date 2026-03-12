import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposeForm } from '@/components/compose/compose-form';
import { MailShell } from '@/components/mail/mail-shell';
import { ThreadReaderPane } from '@/components/reader/thread-reader-pane';
import type { JmapClient } from '@/lib/jmap/types';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockReplace = vi.fn();

let mockPathname = '/mail/inbox';
let mockSearch = 'accountId=primary&mailboxId=inbox-id';

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

vi.mock('@/components/system/toast-region', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseJmapBootstrap = vi.mocked(useJmapBootstrap);
const mockedUseJmapClient = vi.mocked(useJmapClient);

const mailboxRows = [
  { id: 'inbox-id', name: 'Inbox', role: 'inbox', totalThreads: 8, unreadThreads: 3 },
  { id: 'projects-id', name: 'Projects', role: null, totalThreads: 2, unreadThreads: 0 },
] as const;

const threadRows = [
  {
    hasAttachment: false,
    id: 'thread-1',
    isFlagged: false,
    isUnread: true,
    messageCount: 1,
    preview: '第一条预览',
    receivedAt: '2026-03-10T10:00:00.000Z',
    relativeTimeLabel: '今天',
    senderLabel: '团队',
    subject: '线程一',
  },
  {
    hasAttachment: true,
    id: 'thread-2',
    isFlagged: true,
    isUnread: false,
    messageCount: 2,
    preview: '第二条预览',
    receivedAt: '2026-03-09T10:00:00.000Z',
    relativeTimeLabel: '昨天',
    senderLabel: '设计组',
    subject: '线程二',
  },
] as const;

const readerThread = {
  accountId: 'primary',
  emailIds: ['email-1'],
  id: 'thread-1',
  isFlagged: false,
  isUnread: true,
  mailboxIds: ['inbox-id'],
  messageCount: 1,
  messages: [
    {
      attachments: [
        {
          blobId: 'blob-1',
          cid: null,
          contentType: 'application/pdf',
          disposition: 'attachment',
          downloadUrl: '/api/jmap/download/primary/blob-1?download=1',
          isInline: false,
          name: 'report.pdf',
          openUrl: '/api/jmap/download/primary/blob-1',
          size: 1024,
        },
      ],
      bcc: [],
      body: {
        html: '<p>Safe body</p><img src="https://cdn.example/pixel.png">',
        plainText: null,
      },
      cc: [],
      from: [{ email: 'alice@example.com', label: 'Alice', name: 'Alice' }],
      id: 'message-1',
      preview: 'Safe body',
      receivedAt: '2026-03-10T10:00:00.000Z',
      replyTo: [],
      sender: [],
      sentAt: '2026-03-10T10:00:00.000Z',
      subject: 'Reader subject',
      threadId: 'thread-1',
      to: [{ email: 'team@example.com', label: 'Team', name: 'Team' }],
    },
  ],
  subject: 'Reader subject',
} as const;

const composeIdentities = [{ bcc: [], email: 'owner@example.com', id: 'identity-1', label: 'Owner <owner@example.com>', name: 'Owner', replyTo: [], textSignature: 'Regards' }] as const;
const composeMailboxes = [{ id: 'drafts-id', name: 'Drafts', role: 'drafts' }, { id: 'sent-id', name: 'Sent', role: 'sent' }] as const;

function createComposeClientMock(): JmapClient {
  return {
    email: {
      get: vi.fn(),
      query: vi.fn(),
      queryChanges: vi.fn(),
      set: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          accountId: 'primary',
          callId: 'draft-create',
          kind: 'success',
          name: 'Email/set',
          response: {
            accountId: 'primary',
            created: { 'draft-email': { id: 'draft-1' } },
            newState: 'email-state',
          },
        },
        session: {},
      }),
    },
    identity: {
      get: vi.fn(),
    },
    mailbox: {
      changes: vi.fn(),
      get: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          kind: 'success',
          response: { accountId: 'primary', list: composeMailboxes, state: 'mailbox-state' },
        },
      }),
      query: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          kind: 'success',
          response: { accountId: 'primary', canCalculateChanges: true, ids: ['drafts-id', 'sent-id'], position: 0, queryState: 'mailbox-query' },
        },
      }),
    },
    blob: {
      downloadAccess: vi.fn(),
      uploadAccess: vi.fn(),
    },
    bootstrap: vi.fn(),
    call: vi.fn(),
    reset: vi.fn(),
    selectAccount: vi.fn(),
    submission: {
      set: vi.fn(),
    },
    thread: {
      changes: vi.fn(),
      get: vi.fn(),
    },
  } as never;
}

function installQueryMocks() {
  mockedUseQuery.mockImplementation((options) => {
    const queryKey = Array.isArray(options.queryKey) ? options.queryKey : [];

    if (queryKey[0] === 'mailbox-shell') {
      return {
        data: mailboxRows,
        isError: false,
        isLoading: false,
      } as never;
    }

    if (queryKey[0] === 'thread-list') {
      return {
        data: {
          accountId: 'primary',
          mailboxId: 'inbox-id',
          pagination: { hasMore: false, page: 1, pageSize: 24, totalLoaded: threadRows.length },
          rows: threadRows,
          sync: { emailQueryState: 'query-state', threadState: 'thread-state' },
        },
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      } as never;
    }

    if (queryKey[0] === 'reader-thread') {
      return {
        data: readerThread,
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      } as never;
    }

    if (queryKey[0] === 'compose-identities') {
      return {
        data: composeIdentities,
        isError: false,
        isLoading: false,
      } as never;
    }

    if (queryKey[0] === 'compose-mailboxes') {
      return {
        data: composeMailboxes,
        isError: false,
        isLoading: false,
      } as never;
    }

    if (queryKey[0] === 'compose-thread-source') {
      return {
        data: null,
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
}

beforeEach(() => {
  mockPathname = '/mail/inbox';
  mockSearch = 'accountId=primary&mailboxId=inbox-id';
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockReplace.mockReset();
  mockedUseJmapClient.mockReturnValue(createComposeClientMock());
  mockedUseJmapBootstrap.mockReturnValue({
    data: {
      session: {
        accounts: {
          primary: {
            accountCapabilities: {
              mail: { key: 'mail', supported: true, urn: 'urn:ietf:params:jmap:mail', value: { emailQuerySortOptions: ['receivedAt'], maxMailboxDepth: 10, maxMailboxesPerEmail: null, maxSizeAttachmentsPerEmail: 1, maxSizeMailboxName: 255, mayCreateTopLevelMailbox: true } },
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
  installQueryMocks();
});

describe('accessibility', () => {
  it('provides skip links, Chinese-first labels, and keyboard row focus movement', async () => {
    await act(async () => {
      render(
        <MailShell eyebrow="收件箱" intro="intro" readerTitle="邮箱工作台" sectionTitle="活动邮箱">
          <div>reader</div>
        </MailShell>,
      );
    });

    await waitFor(() => expect(screen.getByTestId('thread-row-thread-1')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: '跳到线程列表' })).toHaveAttribute('href', '#mail-thread-list');
    expect(screen.getByRole('searchbox', { name: '搜索邮件' })).toBeInTheDocument();
    expect(screen.getAllByText('收件箱').length).toBeGreaterThan(0);

    const firstRow = screen.getByTestId('thread-row-thread-1');
    const secondRow = screen.getByTestId('thread-row-thread-2');

    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: 'ArrowDown' });

    expect(secondRow).toHaveFocus();
  });

  it('keeps compose labels discoverable and supports keyboard save-close', async () => {
    mockPathname = '/mail/compose';
    mockSearch = 'intent=new&accountId=primary';

    render(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    expect(screen.getByText('收件人')).toBeInTheDocument();

    const toField = screen.getByTestId('compose-to');
    await waitFor(() => expect(toField).toHaveFocus());

    expect(screen.getByTestId('compose-save-close')).toHaveAttribute('aria-keyshortcuts', 'Control+S Meta+S');
    expect(screen.getByTestId('compose-send')).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');

    fireEvent.change(toField, { target: { value: 'alice@example.com' } });
    fireEvent.keyDown(screen.getByTestId('compose-form'), { ctrlKey: true, key: 's' });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mail/inbox?accountId=primary'));
  });

  it('exposes reader action and attachment labels for assistive tech', () => {
    mockPathname = '/mail/inbox';
    mockSearch = 'accountId=primary&threadId=thread-1';

    render(<ThreadReaderPane mailboxItems={[{ accountId: 'primary', depth: 0, href: '/mail/inbox?accountId=primary', id: 'inbox-id', isActive: true, kind: 'system', name: '收件箱', role: 'inbox', totalCount: 8, unreadCount: 3 }]} />);

    expect(screen.getByRole('button', { name: '仅本次会话允许远程图片' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开附件 report.pdf' })).toHaveAttribute('href', '/api/jmap/download/primary/blob-1');
    expect(screen.getByRole('link', { name: '下载附件 report.pdf' })).toHaveAttribute('href', '/api/jmap/download/primary/blob-1?download=1');
    expect(screen.getByRole('link', { name: '回复当前线程' })).toBeInTheDocument();
  });
});
