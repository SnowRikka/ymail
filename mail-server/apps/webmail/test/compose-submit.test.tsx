import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposeForm } from '@/components/compose/compose-form';
import { buildComposeSubmissionRequest, buildUploadProxyPath, classifyComposeExecutionError, submitComposeMessage, toComposeIdentityOptions, toStoredAttachments, uploadAttachmentThroughBff } from '@/lib/jmap/compose-submit';
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

const mockedUseJmapBootstrap = vi.mocked(useJmapBootstrap);
const mockedUseJmapClient = vi.mocked(useJmapClient);

function renderWithQueryClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function createClientMock() {
  return {
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

beforeEach(() => {
  mockPush.mockReset();
  mockSearchParams = new URLSearchParams('intent=new&accountId=primary');
  useComposeDraftStore.persist.clearStorage();
  useComposeDraftStore.setState({ drafts: {} });
  window.localStorage.removeItem(COMPOSE_DRAFT_STORAGE_KEY);

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
});
