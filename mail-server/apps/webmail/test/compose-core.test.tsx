import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ComposeForm } from '@/components/compose/compose-form';
import { buildComposeDraftKey, buildComposePrefill, buildComposeRouteHref, buildFreshComposeRouteHref, buildForwardSubject, buildReplySubject, hydrateComposeServerDraft, normalizeComposeReturnPath, parseComposeRecipients, parseComposeRouteState, validateComposeForm, type ComposeDraftRecord } from '@/lib/jmap/compose-core';
import { queryReaderThread, type ReaderThread } from '@/lib/jmap/message-reader';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';
import { COMPOSE_DRAFT_STORAGE_KEY, useComposeDraftStore } from '@/lib/state/compose-store';
import type { JmapEmailObject } from '@/lib/jmap/types';

const LEGACY_NEW_DRAFT_KEY = 'new::primary::standalone-thread::latest-message';
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams('intent=new&accountId=primary');
let currentClient = createClientMock();

vi.mock('next/navigation', () => ({
  usePathname: () => '/mail/compose',
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
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
  useToast: () => ({ notify: vi.fn() }),
}));

vi.mock('@/lib/jmap/message-reader', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jmap/message-reader')>('@/lib/jmap/message-reader');

  return {
    ...actual,
    queryReaderThread: vi.fn(),
  };
});

const mockedUseJmapBootstrap = vi.mocked(useJmapBootstrap);
const mockedUseJmapClient = vi.mocked(useJmapClient);
const mockedQueryReaderThread = vi.mocked(queryReaderThread);

function renderWithQueryClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0,
        retry: false,
      },
    },
  });

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function createClientMock() {
  let createdCount = 0;

  return {
    email: {
      get: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          kind: 'success',
          response: {
            accountId: 'primary',
            list: [createServerDraftEmail()],
            state: 'email-state',
          },
        },
      }),
      set: vi.fn().mockImplementation(async (request: { create?: Record<string, unknown>; destroy?: readonly string[]; update?: Record<string, unknown> }) => {
        if (request.create?.['draft-email']) {
          createdCount += 1;

          return {
            ok: true,
            result: {
              accountId: 'primary',
              callId: 'draft-create',
              kind: 'success',
              name: 'Email/set',
              response: {
                accountId: 'primary',
                created: { 'draft-email': { id: `draft-${createdCount}` } },
                newState: `email-state-${createdCount}`,
              },
            },
            session: {},
          };
        }

        if (request.update) {
          const draftEmailId = Object.keys(request.update)[0] ?? 'draft-1';

          return {
            ok: true,
            result: {
              accountId: 'primary',
              callId: 'draft-update',
              kind: 'success',
              name: 'Email/set',
              response: {
                accountId: 'primary',
                newState: `email-state-${createdCount + 1}`,
                updated: { [draftEmailId]: null },
              },
            },
            session: {},
          };
        }

        return {
          ok: true,
          result: {
            accountId: 'primary',
            callId: 'draft-destroy',
            kind: 'success',
            name: 'Email/set',
            response: {
              accountId: 'primary',
              destroyed: request.destroy ?? [],
              newState: `email-state-${createdCount + 1}`,
            },
          },
          session: {},
        };
      }),
    },
    identity: {
      get: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          kind: 'success',
          response: {
            accountId: 'primary',
            list: [{ email: 'owner@example.com', id: 'identity-1', name: 'Owner', replyTo: [], state: 'identity-state', textSignature: 'Regards' }],
            state: 'identity-state',
          },
        },
      }),
    },
    mailbox: {
      get: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          kind: 'success',
          response: { accountId: 'primary', list: [{ id: 'drafts-id', name: 'Drafts', role: 'drafts' }, { id: 'sent-id', name: 'Sent', role: 'sent' }], state: 'mailbox-state' },
        },
      }),
      query: vi.fn().mockResolvedValue({
        ok: true,
        result: { kind: 'success', response: { accountId: 'primary', canCalculateChanges: true, ids: ['drafts-id', 'sent-id'], position: 0, queryState: 'mailbox-query' } },
      }),
    },
  };
}

function createThread(): ReaderThread {
  return {
    accountId: 'primary',
    emailIds: ['message-1'],
    id: 'thread-1',
    isFlagged: false,
    isUnread: true,
    mailboxIds: { inbox: true },
    messageCount: 1,
    messages: [
      {
        attachments: [],
        bcc: [],
        body: {
          html: null,
          plainText: '第一行\n第二行',
        },
        cc: [
          { email: 'teammate@example.com', label: 'Teammate', name: 'Teammate' },
          { email: 'owner@example.com', label: 'Owner', name: 'Owner' },
        ],
        from: [{ email: 'alice@example.com', label: 'Alice', name: 'Alice' }],
        id: 'message-1',
        isFlagged: false,
        isUnread: true,
        mailboxIds: { inbox: true },
        preview: '第一行',
        receivedAt: '2026-03-10T10:00:00.000Z',
        replyTo: [{ email: 'reply@example.com', label: 'Reply Desk', name: 'Reply Desk' }],
        sender: [],
        sentAt: '2026-03-10T10:00:00.000Z',
        subject: 'Re: FW: 项目更新',
        threadId: 'thread-1',
        to: [
          { email: 'owner@example.com', label: 'Owner', name: 'Owner' },
          { email: 'team@example.com', label: 'Team', name: 'Team' },
        ],
      },
    ],
    subject: '项目更新',
  };
}

function createServerDraftEmail(): JmapEmailObject {
  return {
    attachments: [{ blobId: 'blob-1', name: 'server-note.txt', partId: 'attachment-1', size: 12, type: 'text/plain' }],
    bodyValues: {
      'text-part': {
        value: '服务器草稿正文',
      },
    },
    from: [{ email: 'owner@example.com', name: 'Owner' }],
    id: 'server-draft-1',
    subject: '服务器草稿主题',
    textBody: [{ partId: 'text-part', type: 'text/plain' }],
    to: [{ email: 'alice@example.com', name: 'Alice' }, { email: 'bob@example.com' }],
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockSearchParams = new URLSearchParams('intent=new&accountId=primary');
  useComposeDraftStore.persist.clearStorage();
  useComposeDraftStore.setState({ drafts: {} });
  window.localStorage.removeItem(COMPOSE_DRAFT_STORAGE_KEY);
  currentClient = createClientMock();
  mockedUseJmapClient.mockReturnValue(currentClient as never);
  mockedQueryReaderThread.mockReset();
  mockedQueryReaderThread.mockResolvedValue(createThread());
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
});

describe('compose-core', () => {
  it('validates recipients deterministically', () => {
    const parsed = parseComposeRecipients('Alice <alice@example.com>, bob@example.com; alice@example.com\ninvalid-address');
    expect(parsed.recipients.map((recipient) => recipient.email)).toEqual(['alice@example.com', 'bob@example.com']);

    const validation = validateComposeForm({ body: '', subject: '', to: 'invalid-address' });
    expect(validation.ok).toBe(false);
    expect(validation.errors.to).toContain('invalid-address');
  });

  it('rejects sending to the active sender identity email', () => {
    const validation = validateComposeForm(
      { body: '', subject: '', to: 'Alias <alias@example.com>, teammate@example.com' },
      { senderEmail: 'alias@example.com' },
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors.to).toBe('收件人不能包含当前发件地址（alias@example.com）。请移除后再发送。');
  });

  it('normalizes reply and forward subjects with Chinese prefixes once', () => {
    expect(buildReplySubject('Re: FW: 项目更新')).toBe('回复：项目更新');
    expect(buildForwardSubject('回复： 项目更新')).toBe('转发：项目更新');
  });

  it('uses explicit draft ids to isolate fresh new-mail routes', () => {
    const routeState = parseComposeRouteState(new URLSearchParams('intent=new&accountId=primary&draftId=fresh-inbox-1&returnTo=/mail/inbox'));

    expect(routeState.draftId).toBe('fresh-inbox-1');
    expect(buildComposeDraftKey(routeState)).toBe('new::primary::explicit-draft::fresh-inbox-1');
    expect(buildComposeDraftKey({ accountId: 'primary', draftId: null, intent: 'new', messageId: null, threadId: null })).toBe(LEGACY_NEW_DRAFT_KEY);
    expect(buildComposeRouteHref({ accountId: 'primary', draftId: 'fresh-inbox-1', intent: 'new', returnTo: '/mail/inbox' })).toContain('draftId=fresh-inbox-1');
    expect(buildFreshComposeRouteHref({ accountId: 'primary', returnTo: '/mail/inbox' })).toMatch(/^\/mail\/compose\?intent=new&accountId=primary&draftId=fresh-/);
  });

  it('degrades legacy reply-all routes to reply semantics', () => {
    const thread = createThread();
    const routeState = parseComposeRouteState(new URLSearchParams('intent=reply-all&accountId=primary&messageId=message-1&threadId=thread-1'));
    const reply = buildComposePrefill({ intent: routeState.intent, messageId: routeState.messageId, selfEmail: 'owner@example.com', thread });

    expect(routeState.intent).toBe('reply');
    expect(reply.form.to).toBe('Reply Desk <reply@example.com>');
    expect(reply.form.subject).toBe('回复：项目更新');
    expect(reply.form.body).toBe('');
    expect(reply.quoted?.body).toContain('发件人：Alice <alice@example.com>');
    expect(reply.quoted?.body).toContain('抄送：Teammate <teammate@example.com>、owner@example.com');
    expect(reply.quoted?.body).toContain('> 第一行');
  });

  it('hydrates an existing server draft into editable compose state', () => {
    const draft = hydrateComposeServerDraft(createServerDraftEmail());

    expect(draft).toEqual({
      attachments: [{ blobId: 'blob-1', errorMessage: null, name: 'server-note.txt', size: 12, status: 'uploaded', type: 'text/plain' }],
      form: {
        body: '服务器草稿正文',
        subject: '服务器草稿主题',
        to: 'Alice <alice@example.com>, bob@example.com',
      },
      identityEmail: 'owner@example.com',
      serverDraftId: 'server-draft-1',
    });
  });

  it('normalizes legacy drafts return paths to the canonical mailbox route and falls back safely', () => {
    expect(normalizeComposeReturnPath({ accountId: 'primary', draftsMailboxId: 'drafts-id', returnTo: '/mail/drafts' })).toBe('/mail/mailbox/drafts-id?accountId=primary');
    expect(normalizeComposeReturnPath({ accountId: 'primary', draftsMailboxId: null, returnTo: '/mail/drafts?threadPage=2' })).toBe('/mail/inbox?threadPage=2&accountId=primary');
    expect(normalizeComposeReturnPath({ accountId: 'primary', draftsMailboxId: 'drafts-id', returnTo: '/mail/inbox?accountId=primary' })).toBe('/mail/inbox?accountId=primary');
  });

  it('builds forward prefills from reader metadata', () => {
    const thread = createThread();
    const forward = buildComposePrefill({ intent: 'forward', messageId: 'message-1', selfEmail: 'owner@example.com', thread });

    expect(forward.form.to).toBe('');
    expect(forward.form.subject).toBe('转发：项目更新');
    expect(forward.form.body).toBe('');
    expect(forward.quoted?.body).toContain('-------- 转发邮件 --------');
    expect(forward.quoted?.body).toContain('第一行\n第二行');
  });

  it('renders quoted reply content in a separate read-only block', async () => {
    mockSearchParams = new URLSearchParams('intent=reply&accountId=primary&threadId=thread-1&messageId=message-1');

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    await waitFor(() => expect(mockedQueryReaderThread).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('identity-select')).toHaveValue('identity-1'));
    await waitFor(() => expect(screen.getByTestId('compose-body')).toHaveValue(''));

    expect(screen.getByTestId('compose-quoted-block')).toBeVisible();
    expect(screen.getByTestId('compose-quoted-content')).toHaveTextContent('-------- 原始邮件 --------');
    expect(screen.getByTestId('compose-quoted-content')).toHaveTextContent('> 第一行');

    fireEvent.change(screen.getByTestId('compose-body'), { target: { value: '这是新的回复正文' } });
    expect(screen.getByTestId('compose-body')).toHaveValue('这是新的回复正文');
    expect(screen.getByTestId('compose-quoted-content')).toHaveTextContent('第二行');
  });

  it('loads a server draft route directly into the compose editor without overriding its stored identity', async () => {
    mockSearchParams = new URLSearchParams('intent=new&accountId=primary&draftId=server-draft-1');
    currentClient = createClientMock();
    currentClient.identity.get.mockResolvedValueOnce({
      ok: true,
      result: {
        kind: 'success',
        response: {
          accountId: 'primary',
          list: [
            { email: 'alias@example.com', id: 'identity-alias', name: 'A Alias', replyTo: [], state: 'identity-state', textSignature: null },
            { email: 'owner@example.com', id: 'identity-1', name: 'Owner', replyTo: [], state: 'identity-state', textSignature: 'Regards' },
          ],
          state: 'identity-state',
        },
      },
    });
    mockedUseJmapClient.mockReturnValue(currentClient as never);

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'alias@example.com' }} />);

    await waitFor(() => expect(currentClient.email.get).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'primary', ids: ['server-draft-1'] })));
    await waitFor(() => expect(screen.getByTestId('identity-select')).toHaveValue('identity-1'));
    await waitFor(() => expect(screen.getByTestId('compose-to')).toHaveValue('Alice <alice@example.com>, bob@example.com'));

    expect(screen.getByTestId('identity-select')).toBeDisabled();
    expect(screen.getByTestId('compose-subject')).toHaveValue('服务器草稿主题');
    expect(screen.getByTestId('compose-body')).toHaveValue('服务器草稿正文');
    expect(screen.getByText('server-note.txt')).toBeVisible();
    expect(screen.getByTestId('draft-status')).toHaveTextContent(/已(载入服务器草稿|恢复 .* 暂存的草稿。)/);
    expect(screen.getByTestId('compose-delete')).toBeVisible();
    expect(screen.getByTestId('compose-delete').nextElementSibling).toBe(screen.getByTestId('compose-save-close'));
    expect(screen.queryByTestId('compose-quoted-block')).not.toBeInTheDocument();
  });

  it('defaults a fresh compose to the logged-in account identity and keeps the field read-only', async () => {
    currentClient = createClientMock();
    currentClient.identity.get.mockResolvedValueOnce({
      ok: true,
      result: {
        kind: 'success',
        response: {
          accountId: 'primary',
          list: [
            { email: 'alias@example.com', id: 'identity-alias', name: 'A Alias', replyTo: [], state: 'identity-state', textSignature: null },
            { email: 'owner@example.com', id: 'identity-current', name: 'Owner', replyTo: [], state: 'identity-state', textSignature: null },
          ],
          state: 'identity-state',
        },
      },
    });
    mockedUseJmapClient.mockReturnValue(currentClient as never);

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    const select = await screen.findByTestId('identity-select');
    await waitFor(() => expect(select).toHaveValue('identity-current'));
    expect(select).not.toHaveValue('');
    expect(select).toHaveTextContent('Owner <owner@example.com>');
    expect(select).toBeDisabled();
    expect(select.closest('div.grid')?.className).toContain('xl:items-end');
    expect(screen.getByText('草稿状态')).toBeVisible();
    expect(screen.getByTestId('draft-status-field').className).toContain('flex');
    expect(screen.getByTestId('draft-status-field').className).toContain('items-center');
    expect(screen.getByTestId('draft-status-field').className).toContain('justify-between');
    expect(screen.getByTestId('draft-status')).toHaveTextContent('等待修改');
    expect(screen.queryByTestId('compose-delete')).not.toBeInTheDocument();
  });

  it('shows delete for a restored local draft immediately to the left of save-close', async () => {
    mockSearchParams = new URLSearchParams('intent=new&accountId=primary&draftId=draft-local-restore&returnTo=/mail/drafts');
    useComposeDraftStore.getState().saveDraft('new::primary::explicit-draft::draft-local-restore', {
      accountId: 'primary',
      attachments: [],
      form: {
        body: '本地恢复正文',
        subject: '本地恢复主题',
        to: 'restore@example.com',
      },
      identityId: null,
      intent: 'new',
      messageId: null,
      returnTo: '/mail/drafts',
      serverDraftId: 'draft-local-restore',
      threadId: null,
      updatedAt: Date.now(),
    } satisfies ComposeDraftRecord);

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    await waitFor(() => expect(screen.getByTestId('compose-delete')).toBeVisible());
    expect(screen.getByTestId('compose-delete')).toBeVisible();
    expect(screen.getByTestId('compose-delete').nextElementSibling).toBe(screen.getByTestId('compose-save-close'));
  });

  it('registers an unsaved-change beforeunload guard', () => {
    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    fireEvent.change(screen.getByTestId('compose-to'), { target: { value: 'alice@example.com' } });

    const event = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(event, 'returnValue', {
      configurable: true,
      set: () => undefined,
    });

    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('removes explanatory compose header copy and keeps the simplified autosave label', async () => {
    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    await waitFor(() => expect(screen.getByTestId('compose-form')).toBeInTheDocument());

    expect(screen.getByRole('heading', { level: 2, name: '新建邮件' })).toBeVisible();
    expect(screen.getByText('自动暂存')).toBeVisible();
    expect(screen.getByText('Ctrl / Cmd + Enter 发送')).toBeVisible();
    expect(screen.queryByText('写信工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('纯文本写信')).not.toBeInTheDocument();
    expect(screen.queryByText('12 秒自动暂存')).not.toBeInTheDocument();
    expect(screen.queryByText('同源附件上传')).not.toBeInTheDocument();
    expect(screen.queryByText('纯文本工作台现已支持身份切换、自动保存、附件上传与真实发送。')).not.toBeInTheDocument();
    expect(screen.queryByText('空白草稿')).not.toBeInTheDocument();
    expect(screen.queryByText('已同步')).not.toBeInTheDocument();
    expect(screen.queryByText('返回收件箱')).not.toBeInTheDocument();
    expect(screen.queryByText('返回线程')).not.toBeInTheDocument();
    expect(screen.getByText('附件')).toBeVisible();
    expect(screen.getByRole('button', { name: '选择附件' })).toBeVisible();
    expect(screen.getByTestId('attachment-progress')).toHaveTextContent('尚未添加附件。');
    expect(screen.getByTestId('draft-status')).toBeVisible();
    expect(screen.getByTestId('compose-save-close')).toBeVisible();
    expect(screen.getByTestId('compose-send')).toBeVisible();
    expect(screen.queryByText('附件会先通过受保护上传通道暂存，再进入真实发送流程。')).not.toBeInTheDocument();
    expect(screen.queryByText('返回路径')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回上一步' })).not.toBeInTheDocument();
  });

  it('wires keyboard save-close at core level', async () => {
    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);
    await waitFor(() => expect(currentClient.mailbox.get).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('compose-subject'), { target: { value: '暂存草稿' } });
    fireEvent.keyDown(screen.getByTestId('compose-form'), { ctrlKey: true, key: 's' });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mail/inbox?accountId=primary'));
  });

  it('keeps inbox fresh compose empty even when a legacy new draft exists', async () => {
    mockSearchParams = new URLSearchParams('intent=new&accountId=primary&draftId=fresh-inbox-entry');
    useComposeDraftStore.getState().saveDraft(LEGACY_NEW_DRAFT_KEY, {
      accountId: 'primary',
      attachments: [{ blobId: 'blob-1', errorMessage: null, name: 'legacy-upload.pdf', size: 128, status: 'uploaded', type: 'application/pdf' }],
      form: {
        body: '旧正文',
        subject: '旧主题',
        to: 'legacy@example.com',
      },
      identityId: null,
      intent: 'new',
      messageId: null,
      returnTo: null,
      threadId: null,
      updatedAt: Date.now(),
    });

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    await waitFor(() => expect(screen.getByTestId('compose-to')).toHaveValue(''));
    expect(screen.getByTestId('compose-subject')).toHaveValue('');
    expect(screen.getByTestId('compose-body')).toHaveValue('');
    expect(screen.getByTestId('attachment-progress')).toHaveTextContent('尚未添加附件。');
    expect(screen.queryByText('legacy-upload.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText(/已恢复 .* 暂存的草稿。/)).not.toBeInTheDocument();
  });

  it('keeps focus on subject after recipient blur autosaves a fresh compose', async () => {
    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    const toField = screen.getByTestId('compose-to');
    const subjectField = screen.getByTestId('compose-subject');

    await waitFor(() => expect(toField).toHaveFocus());

    fireEvent.change(toField, { target: { value: 'alice@example.com' } });
    await act(async () => {
      subjectField.focus();
      fireEvent.blur(toField);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('draft-status')).toHaveTextContent('草稿已自动保存。'));
    await waitFor(() => expect(subjectField).toHaveFocus());
    expect(toField).not.toHaveFocus();
  });

  it('keeps focus on subject during interval autosave for a fresh compose', async () => {
    vi.useFakeTimers();

    try {
      renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

      const toField = screen.getByTestId('compose-to');
      const subjectField = screen.getByTestId('compose-subject');

      await act(async () => {
        await Promise.resolve();
      });

      expect(toField).toHaveFocus();

      fireEvent.change(toField, { target: { value: 'alice@example.com' } });
      await act(async () => {
        subjectField.focus();
        vi.advanceTimersByTime(12_000);
        await Promise.resolve();
      });

      expect(screen.getByTestId('draft-status')).toHaveTextContent('草稿已自动保存。');
      expect(subjectField).toHaveFocus();
      expect(toField).not.toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});
