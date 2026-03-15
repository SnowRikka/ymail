import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposeForm } from '@/components/compose/compose-form';
import { buildComposeSubmissionRequest, buildUploadProxyPath, classifyComposeExecutionError, destroyComposeDraft, persistComposeDraft, selectDefaultIdentityId, selectIdentityIdByEmail, submitComposeMessage, toComposeIdentityOptions, toStoredAttachments, uploadAttachmentThroughBff } from '@/lib/jmap/compose-submit';
import { queryReaderThread } from '@/lib/jmap/message-reader';
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
  return { ...actual, useJmapBootstrap: vi.fn(), useJmapClient: vi.fn() };
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
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function createEmailSetMock() {
  let createdCount = 0;

  return vi.fn().mockImplementation(async (request: { create?: Record<string, unknown>; destroy?: readonly string[]; update?: Record<string, unknown> }) => {
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

    const draftEmailId = request.destroy?.[0] ?? 'draft-1';

    return {
      ok: true,
      result: {
        accountId: 'primary',
        callId: 'draft-destroy',
        kind: 'success',
        name: 'Email/set',
        response: {
          accountId: 'primary',
          destroyed: [draftEmailId],
          newState: `email-state-${createdCount + 1}`,
        },
      },
      session: {},
    };
  });
}

function createClientMock() {
  return {
    call: vi.fn().mockResolvedValue({
      createdIds: { 'send-email': 'email-1', 'send-submission': 'submission-1' },
      ok: true,
      responses: [
        {
          accountId: 'primary',
          callId: 'send-email',
          kind: 'success',
          name: 'Email/set',
          response: { accountId: 'primary', created: { 'send-email': { id: 'email-1' } }, newState: 'email-state' },
        },
        {
          accountId: 'primary',
          callId: 'send-submission',
          kind: 'success',
          name: 'EmailSubmission/set',
          response: {
            accountId: 'primary',
            created: { 'send-submission': { emailId: 'email-1', id: 'submission-1', identityId: 'identity-1' } },
            newState: 'submission-state',
          },
        },
      ],
      session: {},
      sessionState: 'session-state',
    }),
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
      set: createEmailSetMock(),
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

function createReplyThread() {
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
        cc: [{ email: 'team@example.com', label: 'Team', name: 'Team' }],
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
        subject: '项目更新',
        threadId: 'thread-1',
        to: [{ email: 'owner@example.com', label: 'Owner', name: 'Owner' }],
      },
    ],
    subject: '项目更新',
  } as const;
}

function createServerDraftEmail() {
  return {
    attachments: [],
    bodyValues: {
      'text-part': {
        value: '服务器草稿正文',
      },
    },
    from: [{ email: 'owner@example.com', name: 'Owner' }],
    id: 'server-draft-1',
    subject: '服务器草稿主题',
    textBody: [{ partId: 'text-part', type: 'text/plain' }],
    to: [{ email: 'alice@example.com', name: 'Alice' }],
  } as const;
}

beforeEach(() => {
  mockPush.mockReset();
  mockSearchParams = new URLSearchParams('intent=new&accountId=primary');
  useComposeDraftStore.persist.clearStorage();
  useComposeDraftStore.setState({ drafts: {} });
  window.localStorage.removeItem(COMPOSE_DRAFT_STORAGE_KEY);

  mockedQueryReaderThread.mockReset();
  mockedQueryReaderThread.mockResolvedValue(createReplyThread());
  mockedUseJmapClient.mockReturnValue(createClientMock() as never);
  mockedUseJmapBootstrap.mockReturnValue({
    data: {
      session: {
        accounts: {
          primary: {
            accountCapabilities: {
              blob: { key: 'blob', supported: true, urn: 'urn:ietf:params:jmap:blob', value: { maxDataSources: 4, maxSizeBlobSet: 1000, supportedDigestAlgorithms: ['sha'], supportedTypeNames: ['Email'] } },
              mail: { key: 'mail', supported: true, urn: 'urn:ietf:params:jmap:mail', value: { emailQuerySortOptions: ['receivedAt'], maxMailboxDepth: 10, maxMailboxesPerEmail: null, maxSizeAttachmentsPerEmail: 1, maxSizeMailboxName: 255, mayCreateTopLevelMailbox: true } },
              quota: { key: 'quota', supported: false, urn: 'urn:ietf:params:jmap:quota', value: null },
              sieve: { key: 'sieve', supported: false, urn: 'urn:ietf:params:jmap:sieve', value: null },
              submission: { key: 'submission', supported: true, urn: 'urn:ietf:params:jmap:submission', value: { maxDelayedSend: 0, submissionExtensions: {} } },
            },
            id: 'primary',
            isPersonal: true,
            isReadOnly: false,
            name: 'Primary',
          },
        },
        primaryAccounts: { blob: 'primary', mail: 'primary', quota: null, sieve: null, submission: 'primary' },
      },
      status: 'ready',
    },
    isLoading: false,
  } as never);
});

describe('compose-submit foundations', () => {
  it('renders identity selector from typed Identity/get data', async () => {
    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    const select = await screen.findByTestId('identity-select');
    await waitFor(() => expect(select).toHaveValue('identity-1'));
    expect(select.textContent).toContain('Owner <owner@example.com>');
  });

  it('exposes typed helper foundations for identities and failures', () => {
    const identities = toComposeIdentityOptions([{ email: 'owner@example.com', id: 'identity-1', name: 'Owner', replyTo: [], textSignature: 'Regards' }]);

    expect(identities[0]?.label).toBe('Owner <owner@example.com>');
    expect(buildUploadProxyPath('primary')).toBe('/api/jmap/upload/primary');
    expect(classifyComposeExecutionError({ kind: 'unauthenticated', message: 'expired' }, 'fallback').kind).toBe('auth-expired');
    expect(classifyComposeExecutionError({ kind: 'transport', message: 'too large', status: 413 }, 'fallback').kind).toBe('attachment-rejected');
    expect(classifyComposeExecutionError({ kind: 'transport', message: 'offline', status: 502 }, 'fallback').kind).toBe('network-failure');
    expect(classifyComposeExecutionError({ accountId: null, capability: 'submission', kind: 'capability', message: 'bad', reason: 'missing-capability' }, 'fallback').kind).toBe('upstream-validation');
  });

  it('resolves the logged-in account identity email before falling back to the first option', () => {
    const identities = toComposeIdentityOptions([
      { email: 'alias@example.com', id: 'identity-alias', name: 'A Alias', replyTo: [], textSignature: undefined },
      { email: 'owner@example.com', id: 'identity-current', name: 'Owner', replyTo: [], textSignature: undefined },
    ]);

    expect(selectIdentityIdByEmail(identities, 'OWNER@example.com')).toBe('identity-current');
    expect(selectIdentityIdByEmail(identities, 'missing@example.com')).toBe(null);
    expect(selectDefaultIdentityId(identities, null, selectIdentityIdByEmail(identities, 'owner@example.com'))).toBe('identity-current');
    expect(selectDefaultIdentityId(identities, null, selectIdentityIdByEmail(identities, 'missing@example.com'))).toBe('identity-alias');
    expect(selectDefaultIdentityId(identities, 'identity-alias')).toBe('identity-alias');
  });

  it('keeps a stored preferred identity before falling back to the account-scoped default', () => {
    const identities = toComposeIdentityOptions([
      { email: 'z-current@example.com', id: 'identity-current', name: 'Z Current', replyTo: [], textSignature: undefined },
      { email: 'alias@example.com', id: 'identity-alias', name: 'A Alias', replyTo: [], textSignature: undefined },
    ]);

    expect(selectDefaultIdentityId(identities, null, 'identity-alias', selectIdentityIdByEmail(identities, 'z-current@example.com'))).toBe('identity-alias');
    expect(selectDefaultIdentityId(identities, 'missing-identity', 'identity-alias', selectIdentityIdByEmail(identities, 'z-current@example.com'))).toBe('identity-alias');
  });

  it('blocks self-send using the selected identity email instead of the session username fallback', async () => {
    const client = createClientMock();
    mockSearchParams = new URLSearchParams('intent=new&accountId=primary&draftId=server-draft-1');
    client.email.get.mockResolvedValueOnce({
      ok: true,
      result: {
        kind: 'success',
        response: {
          accountId: 'primary',
          list: [{
            attachments: [],
            bodyValues: { 'text-part': { value: 'hello' } },
            from: [{ email: 'alias@example.com', name: 'Alias' }],
            id: 'server-draft-1',
            subject: 'subject',
            textBody: [{ partId: 'text-part', type: 'text/plain' }],
            to: [{ email: 'alias@example.com', name: 'Alias' }],
          }],
          state: 'email-state',
        },
      },
    });
    client.identity.get.mockResolvedValueOnce({
      ok: true,
      result: {
        kind: 'success',
        response: {
          accountId: 'primary',
          list: [
            { email: 'alias@example.com', id: 'identity-alias', name: 'Alias', replyTo: [], state: 'identity-state', textSignature: null },
            { email: 'owner@example.com', id: 'identity-owner', name: 'Owner', replyTo: [], state: 'identity-state', textSignature: null },
          ],
          state: 'identity-state',
        },
      },
    });
    mockedUseJmapClient.mockReturnValue(client as never);

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    await waitFor(() => expect(screen.getByTestId('identity-select')).toHaveValue('identity-alias'));
    await waitFor(() => expect(screen.getByTestId('compose-to')).toHaveValue('Alias <alias@example.com>'));

    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() => expect(screen.getByTestId('compose-to')).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('收件人不能包含当前发件地址（alias@example.com）。请移除后再发送。', { selector: '#compose-to-error' })).toBeVisible();
    expect(client.call).not.toHaveBeenCalled();
  });

  it('uploads attachments through same-origin transport helper', async () => {
    const progress: number[] = [];

    class FakeUploadTarget {
      onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null = null;
    }

    class FakeXhr {
      headers = new Map<string, string>();
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      response: unknown = null;
      responseText = JSON.stringify({ accountId: 'primary', blobId: 'blob-1', size: 4, type: 'text/plain' });
      responseType = '';
      status = 200;
      upload = new FakeUploadTarget();

      open(method: string, url: string) {
        expect(method).toBe('POST');
        expect(url).toBe('/api/jmap/upload/primary');
      }

      setRequestHeader(name: string, value: string) {
        this.headers.set(name, value);
      }

      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 });
        this.onload?.();
      }
    }

    const response = await uploadAttachmentThroughBff({
      accountId: 'primary',
      file: new File(['demo'], 'note.txt', { type: 'text/plain' }),
      onProgress: (value) => progress.push(value),
      xhrFactory: FakeXhr as never,
    });

    expect(response.blobId).toBe('blob-1');
    expect(progress).toEqual([50, 100]);
  });

  it('does not read responseText when xhr uses json responseType', async () => {
    class FakeUploadTarget {
      onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null = null;
    }

    class FakeXhr {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      response: unknown = null;
      responseType = 'json';
      status = 200;
      upload = new FakeUploadTarget();

      get responseText() {
        throw new DOMException(
          "Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was 'json')",
          'InvalidStateError',
        );
      }

      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.();
      }
    }

    await expect(uploadAttachmentThroughBff({
      accountId: 'primary',
      file: new File(['demo'], 'note.txt', { type: 'text/plain' }),
      onProgress: vi.fn(),
      xhrFactory: FakeXhr as never,
    })).rejects.toMatchObject({ kind: 'network-failure', message: '附件上传失败。' });
  });

  it('only persists uploaded attachments so stale failed entries do not block send', () => {
    const stored = toStoredAttachments([
      { blobId: null, errorMessage: 'bad', id: 'a', name: 'bad.txt', progress: 0, size: 1, state: 'failed', type: 'text/plain' },
      { blobId: null, errorMessage: null, id: 'b', name: 'pending.txt', progress: 10, size: 1, state: 'uploading', type: 'text/plain' },
      { blobId: 'blob-1', errorMessage: null, id: 'c', name: 'ok.txt', progress: 100, size: 2, state: 'uploaded', type: 'text/plain' },
    ]);

    expect(stored).toEqual([
      { blobId: 'blob-1', errorMessage: null, name: 'ok.txt', size: 2, status: 'uploaded', type: 'text/plain' },
    ]);
  });

  it('persists drafts through Email/set create-update-destroy helpers', async () => {
    const identity = toComposeIdentityOptions([{ email: 'owner@example.com', id: 'identity-1', name: 'Owner', replyTo: [], textSignature: 'Regards' }])[0]!;
    const set = createEmailSetMock();

    const created = await persistComposeDraft({
      accountId: 'primary',
      attachments: [],
      client: { email: { set } } as never,
      form: { body: 'Draft body', subject: 'Draft subject', to: 'friend@example.com' },
      identity,
      mailboxRoleState: { draftsId: 'drafts-id', fallbackId: 'drafts-id', sentId: 'sent-id' },
    });

    expect(created).toEqual({ draftEmailId: 'draft-1', kind: 'success' });
    expect(set).toHaveBeenNthCalledWith(1, {
      accountId: 'primary',
      create: {
        'draft-email': expect.objectContaining({
          bodyValues: { 'text-part': { value: 'Draft body\n\n-- \nRegards' } },
          keywords: { '$draft': true },
          mailboxIds: { 'drafts-id': true },
          subject: 'Draft subject',
        }),
      },
      update: undefined,
    });

    const updated = await persistComposeDraft({
      accountId: 'primary',
      attachments: [],
      client: { email: { set } } as never,
      draftEmailId: 'draft-1',
      form: { body: 'Updated draft body', subject: 'Updated draft subject', to: 'friend@example.com' },
      identity,
      mailboxRoleState: { draftsId: 'drafts-id', fallbackId: 'drafts-id', sentId: 'sent-id' },
    });

    expect(updated).toEqual({ draftEmailId: 'draft-1', kind: 'success' });
    expect(set).toHaveBeenNthCalledWith(2, {
      accountId: 'primary',
      create: undefined,
      update: {
        'draft-1': expect.objectContaining({
          bodyValues: { 'text-part': { value: 'Updated draft body\n\n-- \nRegards' } },
          keywords: { '$draft': true },
          mailboxIds: { 'drafts-id': true },
          subject: 'Updated draft subject',
        }),
      },
    });

    await expect(destroyComposeDraft({ accountId: 'primary', client: { email: { set } } as never, draftEmailId: 'draft-1' })).resolves.toEqual({ kind: 'success' });
    expect(set).toHaveBeenNthCalledWith(3, {
      accountId: 'primary',
      destroy: ['draft-1'],
    });
  });

  it('save-close persists a server draft before closing compose', async () => {
    const client = createClientMock();
    mockedUseJmapClient.mockReturnValue(client as never);

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    fireEvent.change(await screen.findByTestId('compose-subject'), { target: { value: '服务器草稿' } });
    fireEvent.click(screen.getByTestId('compose-save-close'));

    await waitFor(() => expect(client.email.set).toHaveBeenCalledWith({
      accountId: 'primary',
      create: {
        'draft-email': expect.objectContaining({
          keywords: { '$draft': true },
          mailboxIds: { 'drafts-id': true },
          subject: '服务器草稿',
        }),
      },
      update: undefined,
    }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mail/inbox?accountId=primary'));
    expect(useComposeDraftStore.getState().drafts['new::primary::standalone-thread::latest-message']?.serverDraftId).toBe('draft-1');
  });

  it('save-close keeps quoted reply read-only locally while persisting the combined body remotely', async () => {
    const client = createClientMock();
    mockedUseJmapClient.mockReturnValue(client as never);
    mockSearchParams = new URLSearchParams('intent=reply&accountId=primary&threadId=thread-1&messageId=message-1');

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    await waitFor(() => expect(screen.getByTestId('compose-quoted-block')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('compose-body')).toHaveValue(''));
    await waitFor(() => expect(screen.getByTestId('compose-to')).toHaveValue('Reply Desk <reply@example.com>'));
    await waitFor(() => expect(screen.getByTestId('compose-subject')).toHaveValue('回复：项目更新'));
    fireEvent.change(screen.getByTestId('compose-body'), { target: { value: '只编辑这一段回复' } });
    fireEvent.click(screen.getByTestId('compose-save-close'));

    await waitFor(() => expect(client.email.set.mock.calls.some(([request]) => {
      const payload = request.create?.['draft-email'] ?? Object.values(request.update ?? {})[0];
      const body = payload?.bodyValues?.['text-part']?.value;

      return request.accountId === 'primary'
        && payload?.keywords?.['$draft'] === true
        && payload?.mailboxIds?.['drafts-id'] === true
        && typeof body === 'string'
        && body.includes('只编辑这一段回复\n\n-------- 原始邮件 --------');
    })).toBe(true));

    const storedDraft = useComposeDraftStore.getState().drafts['reply::primary::thread-1::message-1'];
    expect(storedDraft?.form.body).toBe('只编辑这一段回复');
    expect(storedDraft?.quoted?.body).toContain('-------- 原始邮件 --------');
  });

  it('save-close updates the existing server draft id when opened from a drafts route', async () => {
    const client = createClientMock();
    mockedUseJmapClient.mockReturnValue(client as never);
    mockSearchParams = new URLSearchParams('intent=new&accountId=primary&draftId=server-draft-1');

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    await waitFor(() => expect(client.email.get).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'primary', ids: ['server-draft-1'] })));
    await waitFor(() => expect(screen.getByTestId('compose-subject')).toHaveValue('服务器草稿主题'));
    await waitFor(() => expect(screen.getByTestId('compose-to')).toHaveValue('Alice <alice@example.com>'));
    await waitFor(() => expect(screen.getByTestId('compose-body')).toHaveValue('服务器草稿正文'));

    fireEvent.change(screen.getByTestId('compose-subject'), { target: { value: '更新后的服务器草稿' } });
    fireEvent.click(screen.getByTestId('compose-save-close'));

    await waitFor(() => expect(client.email.set.mock.calls.some(([request]) => {
      const payload = request.update?.['server-draft-1'];

      return request.accountId === 'primary'
        && payload?.keywords?.['$draft'] === true
        && payload?.mailboxIds?.['drafts-id'] === true
        && payload?.subject === '更新后的服务器草稿';
    })).toBe(true));
    expect(useComposeDraftStore.getState().drafts['new::primary::explicit-draft::server-draft-1']?.serverDraftId).toBe('server-draft-1');
  });

  it('repeated save-close updates the existing server draft when serverDraftId is already known', async () => {
    const client = createClientMock();
    mockedUseJmapClient.mockReturnValue(client as never);

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    fireEvent.change(await screen.findByTestId('compose-subject'), { target: { value: '第一次保存' } });
    fireEvent.click(screen.getByTestId('compose-save-close'));

    await waitFor(() => expect(useComposeDraftStore.getState().drafts['new::primary::standalone-thread::latest-message']?.serverDraftId).toBe('draft-1'));

    fireEvent.change(screen.getByTestId('compose-subject'), { target: { value: '更新后的主题' } });
    fireEvent.click(screen.getByTestId('compose-save-close'));

    await waitFor(() => expect(client.email.set).toHaveBeenCalledWith({
      accountId: 'primary',
      create: undefined,
      update: {
        'draft-1': expect.objectContaining({
          keywords: { '$draft': true },
          mailboxIds: { 'drafts-id': true },
          subject: '更新后的主题',
        }),
      },
    }));
    expect(useComposeDraftStore.getState().drafts['new::primary::standalone-thread::latest-message']?.serverDraftId).toBe('draft-1');
  });

  it('empty save-close destroys an existing server draft and clears the local record', async () => {
    const client = createClientMock();
    mockedUseJmapClient.mockReturnValue(client as never);
    useComposeDraftStore.getState().saveDraft('new::primary::standalone-thread::latest-message', {
      accountId: 'primary',
      attachments: [],
      form: { body: '', subject: '待删除草稿', to: '' },
      identityId: null,
      intent: 'new',
      messageId: null,
      returnTo: null,
      serverDraftId: 'draft-7',
      threadId: null,
      updatedAt: Date.now(),
    });

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    fireEvent.change(await screen.findByTestId('compose-subject'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('compose-save-close'));

    await waitFor(() => expect(client.email.set).toHaveBeenCalledWith({
      accountId: 'primary',
      destroy: ['draft-7'],
    }));
    expect(useComposeDraftStore.getState().drafts['new::primary::standalone-thread::latest-message']).toBeUndefined();
  });

  it('delete clears a restored local draft, destroys its server draft, and returns via the canonical drafts path', async () => {
    const client = createClientMock();
    mockedUseJmapClient.mockReturnValue(client as never);
    mockSearchParams = new URLSearchParams('intent=new&accountId=primary&draftId=draft-local-restore&returnTo=/mail/drafts');
    useComposeDraftStore.getState().saveDraft('new::primary::explicit-draft::draft-local-restore', {
      accountId: 'primary',
      attachments: [],
      form: { body: '待删除正文', subject: '待删除主题', to: 'draft@example.com' },
      identityId: null,
      intent: 'new',
      messageId: null,
      returnTo: '/mail/drafts',
      serverDraftId: 'draft-local-restore',
      threadId: null,
      updatedAt: Date.now(),
    });

    const view = renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);
    mockPush.mockImplementation(() => {
      view.unmount();
    });

    await waitFor(() => expect(client.mailbox.get).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('compose-delete')).toBeVisible());

    fireEvent.click(screen.getByTestId('compose-delete'));

    await waitFor(() => expect(client.email.set).toHaveBeenCalledWith({
      accountId: 'primary',
      destroy: ['draft-local-restore'],
    }));
    await waitFor(() => expect(useComposeDraftStore.getState().drafts['new::primary::explicit-draft::draft-local-restore']).toBeUndefined());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mail/mailbox/drafts-id?accountId=primary'));
  });

  it('delete clears every persisted alias that points at the same server draft so refresh does not restore it again', async () => {
    let destroyedDraftIds: readonly string[] = [];
    const client = createClientMock();
    client.email.set = vi.fn().mockImplementation(async (request: { create?: Record<string, unknown>; destroy?: readonly string[]; update?: Record<string, unknown> }) => {
      if (request.destroy) {
        destroyedDraftIds = [...request.destroy];

        return {
          ok: true,
          result: {
            accountId: 'primary',
            callId: 'draft-destroy',
            kind: 'success',
            name: 'Email/set',
            response: {
              accountId: 'primary',
              destroyed: request.destroy,
              newState: 'email-state-destroyed',
            },
          },
          session: {},
        };
      }

      return createEmailSetMock()(request);
    });
    client.email.get = vi.fn().mockImplementation(async (request: { ids: readonly string[] }) => ({
      ok: true,
      result: {
        kind: 'success',
        response: {
          accountId: 'primary',
          list: destroyedDraftIds.includes(request.ids[0] ?? '') ? [] : [createServerDraftEmail()],
          state: 'email-state',
        },
      },
    }));
    mockedUseJmapClient.mockReturnValue(client as never);
    mockSearchParams = new URLSearchParams('intent=new&accountId=primary&draftId=server-draft-1&returnTo=/mail/inbox?accountId=primary');

    const sharedDraft = {
      accountId: 'primary',
      attachments: [],
      form: { body: '会复活的旧正文', subject: '会复活的旧主题', to: 'ghost@example.com' },
      identityId: null,
      intent: 'new',
      messageId: null,
      returnTo: '/mail/inbox?accountId=primary',
      serverDraftId: 'server-draft-1',
      threadId: null,
      updatedAt: Date.now(),
    } as const;

    useComposeDraftStore.getState().saveDraft('new::primary::explicit-draft::server-draft-1', sharedDraft);
    useComposeDraftStore.getState().saveDraft('new::primary::standalone-thread::latest-message', sharedDraft);
    useComposeDraftStore.getState().saveDraft('new::primary::explicit-draft::server-draft-1-alias', sharedDraft);

    const firstView = renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);
    mockPush.mockImplementation(() => {
      firstView.unmount();
    });

    await waitFor(() => expect(screen.getByTestId('compose-subject')).toHaveValue('会复活的旧主题'));

    fireEvent.click(screen.getByTestId('compose-delete'));

    await waitFor(() => expect(client.email.set).toHaveBeenCalledWith({
      accountId: 'primary',
      destroy: ['server-draft-1'],
    }));
    await waitFor(() => expect(Object.values(useComposeDraftStore.getState().drafts).filter((draft) => draft.serverDraftId === 'server-draft-1')).toHaveLength(0));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mail/inbox?accountId=primary'));

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    await waitFor(() => expect(client.email.get).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'primary', ids: ['server-draft-1'] })));
    await waitFor(() => expect(screen.queryByDisplayValue('会复活的旧主题')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue('会复活的旧正文')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('ghost@example.com')).not.toBeInTheDocument();
  });

  it('opens a restored draft route without triggering mount-time save loops or maximum-depth errors', async () => {
    const client = createClientMock();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedUseJmapClient.mockReturnValue(client as never);
    mockSearchParams = new URLSearchParams('intent=new&accountId=primary&draftId=server-draft-1');

    useComposeDraftStore.getState().saveDraft('new::primary::standalone-thread::latest-message', {
      accountId: 'primary',
      attachments: [],
      form: { body: '恢复正文', subject: '恢复主题', to: 'restore@example.com' },
      identityId: null,
      intent: 'new',
      messageId: null,
      returnTo: '/mail/inbox?accountId=primary',
      serverDraftId: 'server-draft-1',
      threadId: null,
      updatedAt: Date.now(),
    });

    try {
      renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

      await waitFor(() => expect(screen.getByTestId('compose-subject')).toHaveValue('恢复主题'));
      await waitFor(() => expect(screen.getByTestId('compose-body')).toHaveValue('恢复正文'));
      await waitFor(() => expect(screen.getByTestId('compose-to')).toHaveValue('restore@example.com'));
      await waitFor(() => expect(client.email.set).not.toHaveBeenCalled());
      expect(consoleError.mock.calls.some(([message]) => String(message).includes('Maximum update depth exceeded'))).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('delete destroys a server-draft route and returns via the existing path', async () => {
    const client = createClientMock();
    mockedUseJmapClient.mockReturnValue(client as never);
    mockSearchParams = new URLSearchParams('intent=new&accountId=primary&draftId=server-draft-1&returnTo=/mail/inbox?accountId=primary');

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    await waitFor(() => expect(screen.getByTestId('compose-subject')).toHaveValue('服务器草稿主题'));

    fireEvent.click(screen.getByTestId('compose-delete'));

    await waitFor(() => expect(client.email.set).toHaveBeenCalledWith({
      accountId: 'primary',
      destroy: ['server-draft-1'],
    }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/mail/inbox?accountId=primary'));
  });

  it('persists unsaved compose state to server when navigating away', async () => {
    const client = createClientMock();
    mockedUseJmapClient.mockReturnValue(client as never);

    const view = renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);
    fireEvent.change(await screen.findByTestId('compose-body'), { target: { value: '离开前保存' } });

    view.unmount();

    await waitFor(() => {
      const requests = client.email.set.mock.calls.map(([request]) => request) as Array<{
        accountId: string;
        create?: Record<string, { bodyValues?: { 'text-part'?: { value?: string } }; keywords?: { '$draft'?: boolean }; mailboxIds?: { 'drafts-id'?: boolean }; subject?: string }>;
        update?: Record<string, { bodyValues?: { 'text-part'?: { value?: string } }; keywords?: { '$draft'?: boolean }; mailboxIds?: { 'drafts-id'?: boolean }; subject?: string }>;
      }>;

      expect(requests.some((request) => {
        const draftPayload = request.create?.['draft-email'] ?? Object.values(request.update ?? {})[0];
        return request.accountId === 'primary'
          && draftPayload?.keywords?.['$draft'] === true
          && draftPayload?.mailboxIds?.['drafts-id'] === true
          && draftPayload?.subject === ''
          && typeof draftPayload?.bodyValues?.['text-part']?.value === 'string'
          && draftPayload.bodyValues['text-part']?.value.includes('离开前保存');
      })).toBe(true);
    });
  });

  it('submits send flow in a single batch and returns created ids on success', async () => {
    const identity = toComposeIdentityOptions([{ email: 'owner@example.com', id: 'identity-1', name: 'Owner', replyTo: [], textSignature: 'Regards' }])[0]!;
    const call = vi.fn().mockResolvedValue({
      createdIds: { 'send-email': 'email-1', 'send-submission': 'submission-1' },
      ok: true,
      responses: [
        {
          accountId: 'primary',
          callId: 'send-email',
          kind: 'success',
          name: 'Email/set',
          response: { accountId: 'primary', created: { 'send-email': { id: 'email-1' } }, newState: 'email-state' },
        },
        {
          accountId: 'primary',
          callId: 'send-submission',
          kind: 'success',
          name: 'EmailSubmission/set',
          response: {
            accountId: 'primary',
            created: { 'send-submission': { emailId: 'email-1', id: 'submission-1', identityId: 'identity-1' } },
            newState: 'submission-state',
          },
        },
      ],
      session: {},
      sessionState: 'session-state',
    });

    const result = await submitComposeMessage({
      accountId: 'primary',
      attachments: [],
      client: { call } as never,
      form: { body: 'Hello', subject: 'Subject', to: 'friend@example.com' },
      identity,
      mailboxRoleState: { draftsId: 'drafts-id', fallbackId: 'drafts-id', sentId: 'sent-id' },
    });

    expect(result).toEqual({ emailId: 'email-1', kind: 'success', submissionId: 'submission-1' });
    expect(call).toHaveBeenCalledTimes(1);

    const calls = call.mock.calls[0]?.[0];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      accountId: 'primary',
      callId: 'send-email',
      name: 'Email/set',
      request: { accountId: 'primary', create: { 'send-email': expect.any(Object) } },
    });
    expect(calls[1]).toMatchObject({
      accountId: 'primary',
      callId: 'send-submission',
      name: 'EmailSubmission/set',
      request: {
        accountId: 'primary',
        create: { 'send-submission': { emailId: '#send-email', identityId: 'identity-1' } },
        onSuccessUpdateEmail: {
          '#send-submission': {
            'keywords/$draft': null,
            'mailboxIds/drafts-id': null,
            'mailboxIds/sent-id': true,
          },
        },
      },
    });
  });

  it('surfaces submission upstream validation failures from the batched send flow', async () => {
    const identity = toComposeIdentityOptions([{ email: 'owner@example.com', id: 'identity-1', name: 'Owner', replyTo: [], textSignature: 'Regards' }])[0]!;
    const call = vi.fn().mockResolvedValue({
      createdIds: { 'send-email': 'email-1' },
      ok: true,
      responses: [
        {
          accountId: 'primary',
          callId: 'send-email',
          kind: 'success',
          name: 'Email/set',
          response: { accountId: 'primary', created: { 'send-email': { id: 'email-1' } }, newState: 'email-state' },
        },
        {
          accountId: 'primary',
          callId: 'send-submission',
          kind: 'success',
          name: 'EmailSubmission/set',
          response: {
            accountId: 'primary',
            newState: 'submission-state',
            notCreated: {
              'send-submission': {
                description: 'Invalid reference to non-existing object "send-email" from "send-submission"',
                type: 'invalidArguments',
              },
            },
          },
        },
      ],
      session: {},
      sessionState: 'session-state',
    });

    const result = await submitComposeMessage({
      accountId: 'primary',
      attachments: [],
      client: { call } as never,
      form: { body: 'Hello', subject: 'Subject', to: 'friend@example.com' },
      identity,
      mailboxRoleState: { draftsId: 'drafts-id', fallbackId: 'drafts-id', sentId: 'sent-id' },
    });

    expect(result).toEqual({
      failure: {
        kind: 'upstream-validation',
        message: 'Invalid reference to non-existing object "send-email" from "send-submission"',
      },
      kind: 'failure',
    });
  });

  it('maps forbidden submission method errors to auth-expired during send', async () => {
    const identity = toComposeIdentityOptions([{ email: 'owner@example.com', id: 'identity-1', name: 'Owner', replyTo: [], textSignature: 'Regards' }])[0]!;
    const call = vi.fn().mockResolvedValue({
      createdIds: { 'send-email': 'email-1' },
      ok: true,
      responses: [
        {
          accountId: 'primary',
          callId: 'send-email',
          kind: 'success',
          name: 'Email/set',
          response: { accountId: 'primary', created: { 'send-email': { id: 'email-1' } }, newState: 'email-state' },
        },
        {
          accountId: 'primary',
          callId: 'send-submission',
          error: { description: 'forbidden', type: 'forbidden' },
          kind: 'method-error',
          name: 'EmailSubmission/set',
        },
      ],
      session: {},
      sessionState: 'session-state',
    });

    const result = await submitComposeMessage({
      accountId: 'primary',
      attachments: [],
      client: { call } as never,
      form: { body: 'Hello', subject: 'Subject', to: 'friend@example.com' },
      identity,
      mailboxRoleState: { draftsId: 'drafts-id', fallbackId: 'drafts-id', sentId: 'sent-id' },
    });

    expect(result).toEqual({
      failure: {
        kind: 'auth-expired',
        message: 'forbidden',
      },
      kind: 'failure',
    });
  });

  it('keeps the request builder aligned with batched #creation-id send semantics', () => {
    const identity = toComposeIdentityOptions([{ email: 'owner@example.com', id: 'identity-1', name: 'Owner', replyTo: [], textSignature: 'Regards' }])[0]!;
    const prepared = buildComposeSubmissionRequest({
      attachments: [],
      form: { body: 'Hello', subject: 'Subject', to: 'friend@example.com' },
      identity,
      mailboxRoleState: { draftsId: 'drafts-id', fallbackId: 'drafts-id', sentId: 'sent-id' },
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }

    expect(prepared.submission.create).toEqual({
      'send-submission': {
        emailId: '#send-email',
        identityId: 'identity-1',
      },
    });
    expect(prepared.submission.onSuccessUpdateEmail).toEqual({
      '#send-submission': {
        'keywords/$draft': null,
        'mailboxIds/drafts-id': null,
        'mailboxIds/sent-id': true,
      },
    });
  });

  it('send flow submits the editable reply plus the read-only quote as one final body', async () => {
    const client = createClientMock();
    mockedUseJmapClient.mockReturnValue(client as never);
    mockSearchParams = new URLSearchParams('intent=reply&accountId=primary&threadId=thread-1&messageId=message-1');

    renderWithQueryClient(<ComposeForm sessionSummary={{ accountCount: 1, expiresAt: '2026-03-10T11:00:00.000Z', username: 'owner@example.com' }} />);

    fireEvent.change(await screen.findByTestId('compose-body'), { target: { value: '发送时也要拼回引用' } });
    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() => expect(client.call).toHaveBeenCalledTimes(1));

    const sendBatch = client.call.mock.calls[0]?.[0] as Array<{
      request: { create?: { 'send-email'?: { bodyValues?: { 'text-part'?: { value?: string } } } } };
    }>;
    const sendBody = sendBatch[0]?.request.create?.['send-email']?.bodyValues?.['text-part']?.value;

    expect(sendBody).toContain('发送时也要拼回引用\n\n-------- 原始邮件 --------');
    expect(sendBody).toContain('> 第一行');
  });
});
