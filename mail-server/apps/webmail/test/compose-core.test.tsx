import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ComposeForm } from '@/components/compose/compose-form';
import { buildComposePrefill, buildForwardSubject, buildReplySubject, parseComposeRecipients, validateComposeForm } from '@/lib/jmap/compose-core';
import type { ReaderThread } from '@/lib/jmap/message-reader';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';
import { COMPOSE_DRAFT_STORAGE_KEY, useComposeDraftStore } from '@/lib/state/compose-store';

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
    id: 'thread-1',
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
});
