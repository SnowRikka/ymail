import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ComposeForm } from '@/components/compose/compose-form';
import { buildComposeDraftKey, buildComposePrefill, buildComposeRouteHref, buildFreshComposeRouteHref, buildForwardSubject, buildReplySubject, parseComposeRecipients, parseComposeRouteState, validateComposeForm } from '@/lib/jmap/compose-core';
import type { ReaderThread } from '@/lib/jmap/message-reader';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';
import { COMPOSE_DRAFT_STORAGE_KEY, useComposeDraftStore } from '@/lib/state/compose-store';

const LEGACY_NEW_DRAFT_KEY = 'new::primary::standalone-thread::latest-message';
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams('intent=new&accountId=primary');

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

const mockedUseJmapBootstrap = vi.mocked(useJmapBootstrap);
const mockedUseJmapClient = vi.mocked(useJmapClient);

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

beforeEach(() => {
  mockPush.mockReset();
  mockSearchParams = new URLSearchParams('intent=new&accountId=primary');
  useComposeDraftStore.persist.clearStorage();
  useComposeDraftStore.setState({ drafts: {} });
  window.localStorage.removeItem(COMPOSE_DRAFT_STORAGE_KEY);
  mockedUseJmapClient.mockReturnValue({} as never);
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

  it('builds reply-all and forward prefills from reader metadata', () => {
    const thread = createThread();
    const replyAll = buildComposePrefill({ intent: 'reply-all', messageId: 'message-1', selfEmail: 'owner@example.com', thread });
    const forward = buildComposePrefill({ intent: 'forward', messageId: 'message-1', selfEmail: 'owner@example.com', thread });

    expect(replyAll.form.to).toBe('Reply Desk <reply@example.com>, Team <team@example.com>, Teammate <teammate@example.com>');
    expect(replyAll.form.subject).toBe('回复：项目更新');
    expect(replyAll.form.body).toContain('发件人：Alice <alice@example.com>');
    expect(replyAll.form.body).toContain('抄送：Teammate <teammate@example.com>、owner@example.com');
    expect(replyAll.form.body).toContain('> 第一行');

    expect(forward.form.to).toBe('');
    expect(forward.form.subject).toBe('转发：项目更新');
    expect(forward.form.body).toContain('-------- 转发邮件 --------');
    expect(forward.form.body).toContain('第一行\n第二行');
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

  it('wires keyboard save-close at core level', () => {
    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    fireEvent.change(screen.getByTestId('compose-subject'), { target: { value: '暂存草稿' } });
    fireEvent.keyDown(screen.getByTestId('compose-form'), { ctrlKey: true, key: 's' });

    expect(mockPush).toHaveBeenCalledWith('/mail/inbox?accountId=primary');
  });

  it('rehydrates saved drafts from durable local storage', async () => {
    const firstRender = renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    fireEvent.change(screen.getByTestId('compose-subject'), { target: { value: '持久化草稿' } });
    fireEvent.click(screen.getByTestId('compose-save-close'));

    const persistedDrafts = window.localStorage.getItem(COMPOSE_DRAFT_STORAGE_KEY);
    expect(persistedDrafts).toContain('持久化草稿');

    firstRender.unmount();
    useComposeDraftStore.setState({ drafts: {} });
    window.localStorage.setItem(COMPOSE_DRAFT_STORAGE_KEY, persistedDrafts as string);
    await useComposeDraftStore.persist.rehydrate();

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    expect(screen.getByTestId('compose-subject')).toHaveValue('持久化草稿');
    expect(screen.getByTestId('draft-status')).toHaveTextContent(/已恢复 .* 暂存的草稿。/);
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

  it('lets restored drafts continue editing away from compose-to after blur save', async () => {
    useComposeDraftStore.getState().saveDraft(LEGACY_NEW_DRAFT_KEY, {
      accountId: 'primary',
      attachments: [],
      form: {
        body: '已恢复正文',
        subject: '已恢复主题',
        to: 'alice@example.com',
      },
      identityId: null,
      intent: 'new',
      messageId: null,
      returnTo: null,
      threadId: null,
      updatedAt: Date.now(),
    });

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    const toField = screen.getByTestId('compose-to');
    const subjectField = screen.getByTestId('compose-subject');
    const bodyField = screen.getByTestId('compose-body');

    await waitFor(() => expect(screen.getByTestId('draft-status')).toHaveTextContent(/已恢复 .* 暂存的草稿。/));
    expect(subjectField).toHaveValue('已恢复主题');

    fireEvent.change(subjectField, { target: { value: '继续编辑后的主题' } });
    await act(async () => {
      bodyField.focus();
      fireEvent.blur(subjectField);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('draft-status')).toHaveTextContent('草稿已自动保存。'));
    await waitFor(() => expect(bodyField).toHaveFocus());
    expect(toField).not.toHaveFocus();
    expect(subjectField).toHaveValue('继续编辑后的主题');
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
