import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailShell } from '@/components/mail/mail-shell';
import { ThreadReaderPane } from '@/components/reader/thread-reader-pane';
import { ThreadListPanel } from '@/components/mail/thread-list-panel';
import { applyOptimisticActionToRows, buildMailActionPatch, resolveMailboxRoleTargets } from '@/lib/jmap/mail-actions';
import type { JmapClient } from '@/lib/jmap/types';
import type { MailboxNavigationItem } from '@/lib/jmap/mailbox-shell';
import type { ThreadListPageData, ThreadListRow } from '@/lib/jmap/thread-list';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockReplace = vi.fn();
const mockNotify = vi.fn();
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

let mockSearch = 'accountId=primary&mailboxId=inbox-id&threadId=thread-1';

vi.mock('next/navigation', () => ({
  usePathname: () => '/mail/inbox',
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

vi.mock('@/lib/query/client', () => ({
  getQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('@/lib/jmap/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jmap/provider')>('@/lib/jmap/provider');
  return {
    ...actual,
    useJmapBootstrap: vi.fn(),
    useJmapClient: vi.fn(),
  };
});

vi.mock('@/components/system/toast-region', () => ({
  useToast: () => ({ notify: mockNotify }),
}));

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseJmapBootstrap = vi.mocked(useJmapBootstrap);
const mockedUseJmapClient = vi.mocked(useJmapClient);

const mailboxItems: readonly MailboxNavigationItem[] = [
  { accountId: 'primary', depth: 0, href: '/mail/inbox?accountId=primary&mailboxId=inbox-id', id: 'inbox-id', isActive: true, kind: 'system', name: '收件箱', role: 'inbox', totalCount: 8, unreadCount: 3 },
  { accountId: 'primary', depth: 0, href: '/mail/mailbox/drafts-id?accountId=primary&mailboxId=drafts-id', id: 'drafts-id', isActive: false, kind: 'system', name: '草稿', role: 'drafts', totalCount: 2, unreadCount: 0 },
  { accountId: 'primary', depth: 0, href: '/mail/mailbox/sent-id?accountId=primary&mailboxId=sent-id', id: 'sent-id', isActive: false, kind: 'system', name: '已发送', role: 'sent', totalCount: 4, unreadCount: 0 },
  { accountId: 'primary', depth: 0, href: '/mail/mailbox/archive-id?accountId=primary', id: 'archive-id', isActive: false, kind: 'system', name: '归档', role: 'archive', totalCount: 3, unreadCount: 0 },
  { accountId: 'primary', depth: 0, href: '/mail/mailbox/junk-id?accountId=primary', id: 'junk-id', isActive: false, kind: 'system', name: '垃圾邮件', role: 'junk', totalCount: 1, unreadCount: 0 },
  { accountId: 'primary', depth: 0, href: '/mail/mailbox/trash-id?accountId=primary', id: 'trash-id', isActive: false, kind: 'system', name: '废纸篓', role: 'trash', totalCount: 0, unreadCount: 0 },
];

function getMailboxByRole(items: readonly MailboxNavigationItem[], role: MailboxNavigationItem['role']) {
  const mailbox = items.find((item) => item.role === role);
  if (!mailbox) {
    throw new Error(`Missing mailbox for role ${role ?? 'null'}`);
  }

  return mailbox;
}

function createRow(id: string, overrides?: Partial<ThreadListRow>): ThreadListRow {
  return {
    emailIds: [`email-${id}-1`, `email-${id}-2`],
    hasAttachment: false,
    id,
    isFlagged: false,
    isUnread: true,
    mailboxIds: { 'inbox-id': true },
    messageCount: 2,
    preview: `preview-${id}`,
    receivedAt: '2026-03-10T10:00:00.000Z',
    relativeTimeLabel: '刚刚',
    senderLabel: `sender-${id}`,
    subject: `subject-${id}`,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function expectRowActionsRemoved(threadId: string) {
  expect(screen.queryByTestId(`thread-row-read-${threadId}`)).not.toBeInTheDocument();
  expect(screen.queryByTestId(`thread-row-star-${threadId}`)).not.toBeInTheDocument();
  expect(screen.queryByTestId(`thread-row-archive-${threadId}`)).not.toBeInTheDocument();
  expect(screen.queryByTestId(`thread-row-delete-${threadId}`)).not.toBeInTheDocument();
  expect(screen.queryByTestId(`thread-row-spam-${threadId}`)).not.toBeInTheDocument();
}

function expectDeleteOnlyReaderActions() {
  expect(screen.queryByTestId('reader-action-mark-read')).not.toBeInTheDocument();
  expect(screen.queryByTestId('reader-action-star')).not.toBeInTheDocument();
  expect(screen.queryByTestId('reader-action-move')).not.toBeInTheDocument();
  expect(screen.getByTestId('reader-action-delete')).toBeInTheDocument();
  expect(screen.queryByTestId('reader-action-spam')).not.toBeInTheDocument();
  expect(screen.queryByTestId('reader-reply')).not.toBeInTheDocument();
  expect(screen.queryByTestId('reader-reply-all')).not.toBeInTheDocument();
  expect(screen.queryByTestId('reader-forward')).not.toBeInTheDocument();
}

function expectDeleteOnlyBulkActions() {
  expect(screen.queryByTestId('action-mark-read')).not.toBeInTheDocument();
  expect(screen.queryByTestId('action-star')).not.toBeInTheDocument();
  expect(screen.queryByTestId('action-move')).not.toBeInTheDocument();
  expect(screen.getByTestId('action-delete')).toBeInTheDocument();
  expect(screen.queryByTestId('action-spam')).not.toBeInTheDocument();
}

function expectJunkReaderActions() {
  expect(screen.getByTestId('reader-action-mark-read')).toBeInTheDocument();
  expect(screen.getByTestId('reader-action-star')).toBeInTheDocument();
  expect(screen.getByTestId('reader-action-move')).toBeInTheDocument();
  expect(screen.getByTestId('reader-action-delete')).toBeInTheDocument();
  expect(screen.queryByTestId('reader-action-spam')).not.toBeInTheDocument();
  expect(screen.getByTestId('reader-reply')).toBeInTheDocument();
  expect(screen.getByTestId('reader-forward')).toBeInTheDocument();
}

function expectJunkBulkActions() {
  expect(screen.getByTestId('action-mark-read')).toBeInTheDocument();
  expect(screen.getByTestId('action-star')).toBeInTheDocument();
  expect(screen.getByTestId('action-move')).toBeInTheDocument();
  expect(screen.getByTestId('action-delete')).toBeInTheDocument();
  expect(screen.queryByTestId('action-spam')).not.toBeInTheDocument();
}

function createReaderThread(overrides?: Partial<{ isFlagged: boolean; isUnread: boolean; mailboxIds: Record<string, boolean>; subject: string }>) {
  return {
    accountId: 'primary',
    emailIds: ['email-thread-1-1', 'email-thread-1-2'],
    id: 'thread-1',
    isFlagged: overrides?.isFlagged ?? false,
    isUnread: overrides?.isUnread ?? true,
    mailboxIds: overrides?.mailboxIds ?? { 'inbox-id': true },
    messageCount: 2,
    messages: [
      {
        attachments: [],
        bcc: [],
        body: { html: null, plainText: 'Reader text' },
        cc: [],
        from: [{ email: 'alice@example.com', label: 'Alice', name: 'Alice' }],
        id: 'email-thread-1-1',
        isFlagged: overrides?.isFlagged ?? false,
        isUnread: overrides?.isUnread ?? true,
        mailboxIds: overrides?.mailboxIds ?? { 'inbox-id': true },
        preview: 'Preview',
        receivedAt: '2026-03-10T10:00:00.000Z',
        replyTo: [],
        sender: [],
        sentAt: '2026-03-10T10:00:00.000Z',
        subject: overrides?.subject ?? 'Reader subject',
        threadId: 'thread-1',
        to: [{ email: 'team@example.com', label: 'Team', name: 'Team' }],
      },
      {
        attachments: [],
        bcc: [],
        body: { html: null, plainText: 'Reader text 2' },
        cc: [],
        from: [{ email: 'alice@example.com', label: 'Alice', name: 'Alice' }],
        id: 'email-thread-1-2',
        isFlagged: overrides?.isFlagged ?? false,
        isUnread: overrides?.isUnread ?? true,
        mailboxIds: overrides?.mailboxIds ?? { 'inbox-id': true },
        preview: 'Preview 2',
        receivedAt: '2026-03-10T10:01:00.000Z',
        replyTo: [],
        sender: [],
        sentAt: '2026-03-10T10:01:00.000Z',
        subject: overrides?.subject ?? 'Reader subject',
        threadId: 'thread-1',
        to: [{ email: 'team@example.com', label: 'Team', name: 'Team' }],
      },
    ],
    subject: overrides?.subject ?? 'Reader subject',
  };
}

function renderPanel(
  client: JmapClient,
  rows: readonly ThreadListRow[],
  refetch = vi.fn().mockResolvedValue(undefined),
  activeMailbox: MailboxNavigationItem = getMailboxByRole(mailboxItems, 'inbox'),
  panelMailboxItems: readonly MailboxNavigationItem[] = mailboxItems,
) {
  mockedUseJmapClient.mockReturnValue(client);
  mockedUseQuery.mockReturnValue({
    data: {
      accountId: 'primary',
      mailboxId: activeMailbox.id,
      pagination: { hasMore: false, page: 1, pageSize: 24, totalLoaded: rows.length },
      rows,
      sync: {
        emailQueryState: 'state-1',
        threadState: 'thread-state-1',
      },
    } satisfies ThreadListPageData,
    isError: false,
    isLoading: false,
    refetch,
  } as never);

  return render(
    <ThreadListPanel
      activeAccountId="primary"
      activeMailbox={activeMailbox}
      activeMailboxName={activeMailbox.name}
      isShellLoading={false}
      mailboxItems={panelMailboxItems}
      shellErrorMessage={null}
      topline="INBOX"
    />,
  );
}

function renderReader(
  client: JmapClient,
  thread = createReaderThread(),
  refetch = vi.fn().mockResolvedValue(undefined),
  readerMailboxItems: readonly MailboxNavigationItem[] = mailboxItems,
) {
  mockedUseJmapClient.mockReturnValue(client);
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
      },
      status: 'ready',
    },
    isLoading: false,
  } as never);
  mockedUseQuery.mockReturnValue({
    data: thread,
    isError: false,
    isLoading: false,
    refetch,
  } as never);

  return render(<ThreadReaderPane mailboxItems={readerMailboxItems} />);
}

async function renderShellReader(client: JmapClient, thread = createReaderThread(), refetch = vi.fn().mockResolvedValue(undefined)) {
  const mailboxShellData = [
    { id: 'inbox-id', name: 'Inbox', role: 'inbox', totalThreads: 3, unreadThreads: 2 },
    { id: 'archive-id', name: 'Archive', role: 'archive', totalThreads: 1, unreadThreads: 0 },
    { id: 'junk-id', name: 'Junk', role: 'junk', totalThreads: 1, unreadThreads: 0 },
    { id: 'trash-id', name: 'Trash', role: 'trash', totalThreads: 0, unreadThreads: 0 },
  ];
  const threadListData: ThreadListPageData = {
    accountId: 'primary',
    mailboxId: 'inbox-id',
    pagination: { hasMore: false, page: 1, pageSize: 24, totalLoaded: 1 },
    rows: [createRow('thread-1')],
    sync: {
      emailQueryState: 'state-1',
      threadState: 'thread-state-1',
    },
  };
  const fallbackRefetch = vi.fn().mockResolvedValue(undefined);

  mockedUseJmapClient.mockReturnValue(client);
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
  mockedUseQuery.mockImplementation((options) => {
    const queryKey = Array.isArray(options.queryKey) ? options.queryKey : [];

    if (queryKey[0] === 'mailbox-shell') {
      return {
        data: mailboxShellData,
        isError: false,
        isLoading: false,
      } as never;
    }

    if (queryKey[0] === 'thread-list') {
      return {
        data: threadListData,
        isError: false,
        isLoading: false,
        refetch: fallbackRefetch,
      } as never;
    }

    if (queryKey[0] === 'reader-thread') {
      return {
        data: thread,
        isError: false,
        isLoading: false,
        refetch,
      } as never;
    }

    return {
      data: undefined,
      isError: false,
      isLoading: false,
      refetch: fallbackRefetch,
    } as never;
  });

  await act(async () => {
    render(
      <MailShell eyebrow="收件箱" intro="intro" readerTitle="reader" sectionTitle="线程">
        <ThreadReaderPane />
      </MailShell>,
    );
  });
}

beforeEach(() => {
  mockSearch = 'accountId=primary&mailboxId=inbox-id&threadId=thread-1';
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockReplace.mockReset();
  mockNotify.mockReset();
  mockInvalidateQueries.mockReset();
  mockInvalidateQueries.mockResolvedValue(undefined);
  mockedUseQuery.mockReset();
  mockedUseJmapBootstrap.mockReset();
  mockedUseJmapClient.mockReset();
});

describe('mail-actions', () => {
  it('builds typed patches for keyword and mailbox actions', () => {
    const roleTargets = resolveMailboxRoleTargets(mailboxItems);
    const row = createRow('thread-1');
    const draftRow = createRow('draft-thread', { mailboxIds: { 'drafts-id': true } });
    const mixedDraftRow = createRow('mixed-draft-thread', { mailboxIds: { 'drafts-id': true, 'inbox-id': true } });
    const junkRow = createRow('junk-thread', { mailboxIds: { 'junk-id': true } });
    const trashRow = createRow('trash-thread', { mailboxIds: { 'trash-id': true } });

    expect(buildMailActionPatch({ action: { type: 'mark-read' }, currentMailboxId: 'inbox-id', roleTargets, thread: row })).toEqual({ 'keywords/$seen': true });
    expect(buildMailActionPatch({ action: { type: 'star' }, currentMailboxId: 'inbox-id', roleTargets, thread: row })).toEqual({ 'keywords/$flagged': true });
    expect(buildMailActionPatch({ action: { type: 'archive' }, currentMailboxId: 'inbox-id', roleTargets, thread: row })).toEqual({ 'mailboxIds/archive-id': true });
    expect(buildMailActionPatch({ action: { type: 'delete' }, currentMailboxId: 'drafts-id', roleTargets, thread: draftRow })).toEqual({
      'keywords/$draft': null,
      'mailboxIds/drafts-id': null,
      'mailboxIds/trash-id': true,
    });
    expect(buildMailActionPatch({ action: { type: 'delete' }, currentMailboxId: 'inbox-id', roleTargets, thread: mixedDraftRow })).toEqual({
      'keywords/$draft': null,
      'mailboxIds/drafts-id': null,
      'mailboxIds/trash-id': true,
    });
    expect(buildMailActionPatch({ action: { type: 'delete' }, currentMailboxId: 'junk-id', roleTargets, thread: junkRow })).toEqual({
      'keywords/$junk': null,
      'keywords/$notjunk': true,
      'mailboxIds/junk-id': null,
      'mailboxIds/trash-id': true,
    });
    expect(buildMailActionPatch({ action: { type: 'delete' }, currentMailboxId: 'inbox-id', roleTargets, thread: row })).toEqual({ 'mailboxIds/trash-id': true });
    expect(buildMailActionPatch({ action: { type: 'delete' }, currentMailboxId: 'trash-id', roleTargets, thread: trashRow })).toBeNull();
    expect(buildMailActionPatch({ action: { type: 'spam' }, currentMailboxId: 'inbox-id', roleTargets, thread: row })).toEqual({
      'keywords/$junk': true,
      'keywords/$notjunk': null,
      'mailboxIds/junk-id': true,
    });
  });

  it('shows the bulk action bar only for multi-select and uses mail wording', () => {
    renderPanel({ email: { set: vi.fn() } } as unknown as JmapClient, [createRow('thread-1'), createRow('thread-2')]);

    expect(screen.getByRole('button', { name: '批量操作' })).toBeInTheDocument();
    expectRowActionsRemoved('thread-1');
    expectRowActionsRemoved('thread-2');
    fireEvent.click(screen.getByTestId('thread-select-thread-1'));

    expect(screen.queryByTestId('thread-bulk-bar')).not.toBeInTheDocument();
    expect(screen.queryByText('已选择 1 个线程')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('thread-select-thread-2'));

    expect(screen.getByTestId('thread-bulk-bar')).toBeInTheDocument();
    expect(screen.getByText('已选择 2 个邮件')).toBeInTheDocument();
    expect(screen.queryByText('已选择 2 个线程')).not.toBeInTheDocument();
    expect(screen.getByTestId('action-mark-read')).toBeInTheDocument();
    expect(screen.getByTestId('action-mark-read')).toHaveTextContent('已读');
    expect(screen.getByTestId('action-star')).toBeInTheDocument();
    expect(screen.getByTestId('action-move')).toBeInTheDocument();
    expect(screen.getByTestId('action-delete')).toBeInTheDocument();
    expect(screen.getByTestId('action-spam')).toBeInTheDocument();
  });

  it('optimistically archives selected rows and restores focus to next visible row', async () => {
    const deferred = createDeferred<{ ok: true; result: { kind: 'success'; response: { newState: string; updated?: Record<string, null> } } }>();
    const refetch = vi.fn().mockResolvedValue(undefined);

    renderPanel({ email: { set: vi.fn().mockReturnValue(deferred.promise) } } as unknown as JmapClient, [createRow('thread-1'), createRow('thread-2'), createRow('thread-3')], refetch);

    fireEvent.click(screen.getByTestId('thread-select-thread-1'));
    fireEvent.click(screen.getByTestId('thread-select-thread-2'));
    fireEvent.click(screen.getByTestId('action-move'));

    await waitFor(() => {
      expect(screen.queryByTestId('thread-row-thread-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('thread-row-thread-2')).not.toBeInTheDocument();
      expect(screen.getByTestId('thread-row-thread-3')).toBeInTheDocument();
      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('threadId=thread-3'));
    });

    deferred.resolve({ ok: true, result: { kind: 'success', response: { newState: 'next-state', updated: {} } } });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('invalidates mailbox shell after bulk delete removes a draft thread', async () => {
    const deferred = createDeferred<{ ok: true; result: { kind: 'success'; response: { newState: string; updated?: Record<string, null> } } }>();
    const refetch = vi.fn().mockResolvedValue(undefined);

    renderPanel(
      { email: { set: vi.fn().mockReturnValue(deferred.promise) } } as unknown as JmapClient,
      [
        createRow('thread-1', { mailboxIds: { 'drafts-id': true } }),
        createRow('thread-2', { mailboxIds: { 'drafts-id': true } }),
      ],
      refetch,
      getMailboxByRole(mailboxItems, 'drafts'),
    );

    fireEvent.click(screen.getByTestId('thread-select-thread-1'));
    fireEvent.click(screen.getByTestId('thread-select-thread-2'));
    fireEvent.click(screen.getByTestId('action-delete'));

    await waitFor(() => {
      expect(screen.queryByTestId('thread-row-thread-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('thread-row-thread-2')).not.toBeInTheDocument();
    });

    deferred.resolve({ ok: true, result: { kind: 'success', response: { newState: 'next-state', updated: {} } } });

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['mailbox-shell', 'primary'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['thread-list', 'primary', 'drafts-id'] });
    });
  });

  it('removes row actions and keeps delete-only bulk actions in drafts sent and trash mailboxes', () => {
    for (const role of ['drafts', 'sent', 'trash'] as const) {
      const mailbox = getMailboxByRole(mailboxItems, role);
      const threadId = `${role}-thread`;
      const panel = renderPanel(
        { email: { set: vi.fn() } } as unknown as JmapClient,
        [createRow(threadId, { mailboxIds: { [mailbox.id]: true } }), createRow(`${threadId}-2`, { mailboxIds: { [mailbox.id]: true } })],
        vi.fn().mockResolvedValue(undefined),
        mailbox,
      );

      expectRowActionsRemoved(threadId);
      fireEvent.click(screen.getByTestId(`thread-select-${threadId}`));
      fireEvent.click(screen.getByTestId(`thread-select-${threadId}-2`));
      expectDeleteOnlyBulkActions();
      panel.unmount();
    }
  });

  it('removes row actions and keeps non-spam bulk actions in junk mailbox', () => {
    const mailbox = getMailboxByRole(mailboxItems, 'junk');
    renderPanel(
      { email: { set: vi.fn() } } as unknown as JmapClient,
      [createRow('junk-thread', { mailboxIds: { 'junk-id': true } }), createRow('junk-thread-2', { mailboxIds: { 'junk-id': true } })],
      vi.fn().mockResolvedValue(undefined),
      mailbox,
    );

    expectRowActionsRemoved('junk-thread');
    fireEvent.click(screen.getByTestId('thread-select-junk-thread'));
    fireEvent.click(screen.getByTestId('thread-select-junk-thread-2'));
    expectJunkBulkActions();
  });

  it('projects deterministic removal and keyword updates', () => {
    const rows = [createRow('thread-1'), createRow('thread-2', { isUnread: false }), createRow('thread-3')];

    expect(applyOptimisticActionToRows({ action: { type: 'mark-read' }, currentMailboxId: 'inbox-id', rows, targetThreadIds: ['thread-1'] }).rows[0]?.isUnread).toBe(false);
    expect(applyOptimisticActionToRows({ action: { type: 'archive' }, currentMailboxId: 'inbox-id', rows, targetThreadIds: ['thread-1', 'thread-2'] })).toEqual({
      nextFocusedThreadId: 'thread-3',
      rows: [rows[2]],
    });
  });

  it('renders coherent reader action surface and rolls back optimistic mark-read failure', async () => {
    const deferred = createDeferred<{ ok: false; error: { message: string } }>();
    renderReader({ email: { set: vi.fn().mockReturnValue(deferred.promise) } } as unknown as JmapClient);

    expect(screen.getByRole('heading', { name: 'Reader subject' })).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-mark-read')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-star')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-move')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-delete')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-spam')).toBeInTheDocument();
    expect(screen.getByTestId('reader-reply')).toHaveAttribute('href', expect.stringContaining('intent=reply'));
    expect(screen.queryByTestId('reader-reply-all')).not.toBeInTheDocument();
    expect(screen.getByTestId('reader-forward')).toBeInTheDocument();
    expect(screen.queryByText('线程 thread-1')).not.toBeInTheDocument();
    expect(screen.queryByText(/最近一封来自/)).not.toBeInTheDocument();
    expect(screen.queryByText('第 1 封')).not.toBeInTheDocument();
    expect(screen.queryByText('第 2 封')).not.toBeInTheDocument();
    expect(screen.queryByText('2 封')).not.toBeInTheDocument();
    expect(screen.getByTestId('reader-action-mark-read')).toHaveTextContent('未读');

    deferred.resolve({ ok: false, error: { message: 'reader mutation failed' } });

    await waitFor(() => {
      expect(screen.getByTestId('reader-action-mark-read')).toHaveTextContent('已读');
      expect(mockNotify).toHaveBeenCalledWith('reader mutation failed');
    });
  });

  it('auto-marks an unread thread as read once when the reader becomes ready', async () => {
    const deferred = createDeferred<{ ok: true; result: { kind: 'success'; response: { newState: string; updated?: Record<string, null> } } }>();
    const setEmail = vi.fn().mockReturnValue(deferred.promise);
    const refetch = vi.fn().mockResolvedValue(undefined);

    renderReader({ email: { set: setEmail } } as unknown as JmapClient, createReaderThread({ isUnread: true }), refetch);

    await waitFor(() => {
      expect(setEmail).toHaveBeenCalledWith({
        accountId: 'primary',
        update: {
          'email-thread-1-1': { 'keywords/$seen': true },
          'email-thread-1-2': { 'keywords/$seen': true },
        },
      });
    });

    deferred.resolve({ ok: true, result: { kind: 'success', response: { newState: 'next-state', updated: {} } } });

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    expect(setEmail).toHaveBeenCalledTimes(1);
  });

  it('does not auto-mark an already-read thread when the reader opens', () => {
    const setEmail = vi.fn();

    renderReader({ email: { set: setEmail } } as unknown as JmapClient, createReaderThread({ isUnread: false }));

    expect(screen.getByTestId('reader-action-mark-read')).toHaveTextContent('未读');
    expect(setEmail).not.toHaveBeenCalled();
  });

  it('uses the mark-unread mutation path for already-read reader threads', async () => {
    const setEmail = vi.fn().mockResolvedValue({ ok: true, result: { kind: 'success', response: { newState: 'next-state', updated: {} } } });

    renderReader({ email: { set: setEmail } } as unknown as JmapClient, createReaderThread({ isUnread: false }));

    fireEvent.click(screen.getByTestId('reader-action-mark-read'));

    await waitFor(() => {
      expect(setEmail).toHaveBeenCalledWith({
        accountId: 'primary',
        update: {
          'email-thread-1-1': { 'keywords/$seen': null },
          'email-thread-1-2': { 'keywords/$seen': null },
        },
      });
    });
  });

  it('renders reader action strip through the real MailShell composition path', async () => {
    await renderShellReader({ email: { set: vi.fn().mockResolvedValue({ ok: true, result: { kind: 'success', response: { newState: 'next-state', updated: {} } } }) } } as unknown as JmapClient, createReaderThread({ isUnread: false }));

    expect(screen.getByTestId('reader-action-mark-read')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-star')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-move')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-delete')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-spam')).toBeInTheDocument();
  });

  it('shows delete-only reader actions in drafts sent and trash mailboxes', () => {
    for (const role of ['drafts', 'sent', 'trash'] as const) {
      const mailbox = getMailboxByRole(mailboxItems, role);
      mockSearch = `accountId=primary&mailboxId=${mailbox.id}&threadId=thread-1`;
      const reader = renderReader(
        { email: { set: vi.fn() } } as unknown as JmapClient,
        createReaderThread({ isUnread: false, mailboxIds: { [mailbox.id]: true }, subject: `${role} subject` }),
      );

      expectDeleteOnlyReaderActions();
      reader.unmount();
    }
  });

  it('hides only spam on the reader action strip in junk mailbox', () => {
    const mailbox = getMailboxByRole(mailboxItems, 'junk');
    mockSearch = `accountId=primary&mailboxId=${mailbox.id}&threadId=thread-1`;

    renderReader(
      { email: { set: vi.fn() } } as unknown as JmapClient,
      createReaderThread({ isUnread: false, mailboxIds: { 'junk-id': true }, subject: 'Junk subject' }),
    );

    expectJunkReaderActions();
  });

  it('hides archive on list bulk and reader surfaces when archive mailbox is unavailable', () => {
    const mailboxItemsWithoutArchive = mailboxItems.filter((mailbox) => mailbox.role !== 'archive');
    const inboxMailbox = getMailboxByRole(mailboxItemsWithoutArchive, 'inbox');
    const panel = renderPanel(
      { email: { set: vi.fn() } } as unknown as JmapClient,
      [createRow('thread-1'), createRow('thread-2')],
      vi.fn().mockResolvedValue(undefined),
      inboxMailbox,
      mailboxItemsWithoutArchive,
    );

    expectRowActionsRemoved('thread-1');
    fireEvent.click(screen.getByTestId('thread-select-thread-1'));
    fireEvent.click(screen.getByTestId('thread-select-thread-2'));
    expect(screen.queryByTestId('action-move')).not.toBeInTheDocument();
    expect(screen.getByTestId('action-mark-read')).toBeInTheDocument();
    expect(screen.getByTestId('action-star')).toBeInTheDocument();
    expect(screen.getByTestId('action-delete')).toBeInTheDocument();
    expect(screen.getByTestId('action-spam')).toBeInTheDocument();
    panel.unmount();

    mockSearch = 'accountId=primary&mailboxId=inbox-id&threadId=thread-1';
    renderReader(
      { email: { set: vi.fn() } } as unknown as JmapClient,
      createReaderThread({ isUnread: false }),
      vi.fn().mockResolvedValue(undefined),
      mailboxItemsWithoutArchive,
    );

    expect(screen.queryByTestId('reader-action-move')).not.toBeInTheDocument();
    expect(screen.getByTestId('reader-action-mark-read')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-star')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-delete')).toBeInTheDocument();
    expect(screen.getByTestId('reader-action-spam')).toBeInTheDocument();
  });

  it('invalidates draft list and mailbox shell after reader delete succeeds', async () => {
    const deferred = createDeferred<{ ok: true; result: { kind: 'success'; response: { newState: string; updated?: Record<string, null> } } }>();
    mockSearch = 'accountId=primary&mailboxId=drafts-id&threadId=thread-1';

    renderReader(
      { email: { set: vi.fn().mockReturnValue(deferred.promise) } } as unknown as JmapClient,
      createReaderThread({ isUnread: false, mailboxIds: { 'drafts-id': true }, subject: 'Draft subject' }),
    );

    fireEvent.click(screen.getByTestId('reader-action-delete'));

    deferred.resolve({ ok: true, result: { kind: 'success', response: { newState: 'next-state', updated: {} } } });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['mailbox-shell', 'primary'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['thread-list', 'primary', 'drafts-id'] });
      expect(mockReplace).toHaveBeenCalledWith('/mail/inbox?accountId=primary&mailboxId=drafts-id');
    });
  });

  it('destroys trash reader emails instead of patching them back to trash', async () => {
    const deferred = createDeferred<{ ok: true; result: { kind: 'success'; response: { destroyed?: readonly string[]; newState: string } } }>();
    const setEmail = vi.fn().mockReturnValue(deferred.promise);
    mockSearch = 'accountId=primary&mailboxId=trash-id&threadId=thread-1';

    renderReader(
      { email: { set: setEmail } } as unknown as JmapClient,
      createReaderThread({ isUnread: false, mailboxIds: { 'trash-id': true }, subject: 'Trash subject' }),
    );

    fireEvent.click(screen.getByTestId('reader-action-delete'));

    await waitFor(() => {
      expect(setEmail).toHaveBeenCalledWith({
        accountId: 'primary',
        destroy: ['email-thread-1-1', 'email-thread-1-2'],
      });
    });

    deferred.resolve({ ok: true, result: { kind: 'success', response: { destroyed: ['email-thread-1-1', 'email-thread-1-2'], newState: 'next-state' } } });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['mailbox-shell', 'primary'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['thread-list', 'primary', 'trash-id'] });
      expect(mockReplace).toHaveBeenCalledWith('/mail/inbox?accountId=primary&mailboxId=trash-id');
    });
  });

  it('moves junk reader deletes to trash while clearing junk semantics', async () => {
    const deferred = createDeferred<{ ok: true; result: { kind: 'success'; response: { newState: string; updated?: Record<string, null> } } }>();
    const setEmail = vi.fn().mockReturnValue(deferred.promise);
    mockSearch = 'accountId=primary&mailboxId=junk-id&threadId=thread-1';

    renderReader(
      { email: { set: setEmail } } as unknown as JmapClient,
      createReaderThread({ isUnread: false, mailboxIds: { 'junk-id': true }, subject: 'Junk subject' }),
    );

    fireEvent.click(screen.getByTestId('reader-action-delete'));

    await waitFor(() => {
      expect(setEmail).toHaveBeenCalledWith({
        accountId: 'primary',
        update: {
          'email-thread-1-1': {
            'keywords/$junk': null,
            'keywords/$notjunk': true,
            'mailboxIds/junk-id': null,
            'mailboxIds/trash-id': true,
          },
          'email-thread-1-2': {
            'keywords/$junk': null,
            'keywords/$notjunk': true,
            'mailboxIds/junk-id': null,
            'mailboxIds/trash-id': true,
          },
        },
      });
    });

    deferred.resolve({ ok: true, result: { kind: 'success', response: { newState: 'next-state', updated: {} } } });

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['mailbox-shell', 'primary'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['thread-list', 'primary', 'junk-id'] });
      expect(mockReplace).toHaveBeenCalledWith('/mail/inbox?accountId=primary&mailboxId=junk-id');
    });
  });

});
