import { describe, expect, it } from 'vitest';

import { createJmapClient, getRealtimeAccess } from '@/lib/jmap/client';
import { parseJmapSessionResource } from '@/lib/jmap/session';
import { createMethodCall } from '@/lib/jmap/methods';
import { JMAP_CAPABILITY_URNS, type JmapMethodCall } from '@/lib/jmap/types';

function createSessionPayload(overrides?: Partial<Record<string, unknown>>) {
  return {
    accounts: {
      accountA: {
        accountCapabilities: {
          [JMAP_CAPABILITY_URNS.blob]: {
            maxDataSources: 4,
            maxSizeBlobSet: 1000,
            supportedDigestAlgorithms: ['sha'],
            supportedTypeNames: ['Email'],
          },
          [JMAP_CAPABILITY_URNS.mail]: {
            emailQuerySortOptions: ['receivedAt'],
            maxMailboxDepth: 10,
            maxMailboxesPerEmail: null,
            maxSizeAttachmentsPerEmail: 5000,
            maxSizeMailboxName: 255,
            mayCreateTopLevelMailbox: true,
          },
          [JMAP_CAPABILITY_URNS.submission]: {
            maxDelayedSend: 0,
            submissionExtensions: {},
          },
        },
        isPersonal: true,
        isReadOnly: false,
        name: 'Primary',
      },
      accountB: {
        accountCapabilities: {
          [JMAP_CAPABILITY_URNS.mail]: {
            emailQuerySortOptions: ['receivedAt'],
            maxMailboxDepth: 5,
            maxMailboxesPerEmail: null,
            maxSizeAttachmentsPerEmail: 2000,
            maxSizeMailboxName: 255,
            mayCreateTopLevelMailbox: false,
          },
        },
        isPersonal: false,
        isReadOnly: true,
        name: 'Archive',
      },
    },
    apiUrl: 'https://mail.example.com/jmap',
    capabilities: {
      [JMAP_CAPABILITY_URNS.blob]: {
        maxDataSources: 4,
        maxSizeBlobSet: 1000,
        supportedDigestAlgorithms: ['sha'],
        supportedTypeNames: ['Email'],
      },
      [JMAP_CAPABILITY_URNS.core]: {
        collationAlgorithms: ['i;unicode-casemap'],
        maxCallsInRequest: 16,
        maxConcurrentRequests: 8,
        maxConcurrentUpload: 4,
        maxObjectsInGet: 256,
        maxObjectsInSet: 128,
        maxSizeRequest: 1000000,
        maxSizeUpload: 5000000,
      },
      [JMAP_CAPABILITY_URNS.mail]: {
        emailQuerySortOptions: ['receivedAt'],
        maxMailboxDepth: 10,
        maxMailboxesPerEmail: null,
        maxSizeAttachmentsPerEmail: 5000,
        maxSizeMailboxName: 255,
        mayCreateTopLevelMailbox: true,
      },
      [JMAP_CAPABILITY_URNS.submission]: {
        maxDelayedSend: 0,
        submissionExtensions: {},
      },
      [JMAP_CAPABILITY_URNS.websocket]: {
        supportsPush: false,
        url: 'wss://mail.example.com/jmap/ws',
      },
    },
    downloadUrl: 'https://mail.example.com/download/{accountId}/{blobId}/{name}?type={type}',
    eventSourceUrl: 'https://mail.example.com/events',
    primaryAccounts: {
      [JMAP_CAPABILITY_URNS.blob]: 'accountA',
      [JMAP_CAPABILITY_URNS.mail]: 'accountA',
      [JMAP_CAPABILITY_URNS.submission]: 'accountA',
    },
    state: 'state-1',
    uploadUrl: 'https://mail.example.com/upload/{accountId}',
    username: 'alice@example.com',
    ...overrides,
  };
}

function createFetchMock(sessionOverrides?: Partial<Record<string, unknown>>) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url === '/api/jmap/session') {
      return new Response(JSON.stringify(createSessionPayload(sessionOverrides)), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }

    if (url === '/api/jmap') {
      const body = JSON.parse(init?.body as string) as { methodCalls: [string, JmapMethodCall['request'], string][]; using: string[] };
      const methodResponses = body.methodCalls.map(([name, args, callId]) => {
        if (name === 'EmailSubmission/set') {
          return [
            'error',
            {
              description: 'submission blocked',
              type: 'forbidden',
            },
            callId,
          ];
        }

        return [
          name,
          name === 'Mailbox/get'
            ? { accountId: args.accountId, list: [{ id: 'inbox', name: 'Inbox' }], state: 'mailbox-state' }
            : { accountId: args.accountId, ids: ['message-1'], position: 0, queryState: 'query-state', canCalculateChanges: true },
          callId,
        ];
      });

      return new Response(
        JSON.stringify({
          createdIds: { temp1: 'email-1' },
          methodResponses,
          sessionState: 'session-state-2',
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    }

    return new Response('not-found', { status: 404 });
  };
}

function createNormalizedFetchMock(sessionOverrides?: Partial<Record<string, unknown>>) {
  const normalized = parseJmapSessionResource(createSessionPayload(sessionOverrides));

  if (!normalized) {
    throw new Error('Expected normalized session payload.');
  }

  return async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url === '/api/jmap/session') {
      return new Response(JSON.stringify(normalized), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }

    return new Response('not-found', { status: 404 });
  };
}

describe('jmap-client', () => {
  it('bootstraps from authenticated BFF session discovery', async () => {
    const client = createJmapClient(createFetchMock());
    const bootstrap = await client.bootstrap();

    expect(bootstrap.status).toBe('ready');
    if (bootstrap.status !== 'ready') {
      return;
    }

    expect(bootstrap.session.urls.api.proxyPath).toBe('/api/jmap');
    expect(bootstrap.session.capabilities.mail.supported).toBe(true);
    expect(bootstrap.session.primaryAccounts.mail).toBe('accountA');
    expect(bootstrap.session.accounts.accountB.isReadOnly).toBe(true);
  });

  it('bootstraps from already-normalized BFF session payloads', async () => {
    const client = createJmapClient(createNormalizedFetchMock());
    const bootstrap = await client.bootstrap();

    expect(bootstrap.status).toBe('ready');
    if (bootstrap.status !== 'ready') {
      return;
    }

    expect(bootstrap.session.capabilities.core.supported).toBe(true);
    expect(bootstrap.session.capabilities.mail.supported).toBe(true);
    expect(bootstrap.session.primaryAccounts.mail).toBe('accountA');
    expect(bootstrap.session.accounts.accountA.accountCapabilities.mail.supported).toBe(true);
  });

  it('degrades cleanly when capabilities are missing', async () => {
    const client = createJmapClient(
      createFetchMock({
        accounts: {
          accountA: {
            accountCapabilities: {
              [JMAP_CAPABILITY_URNS.mail]: {
                emailQuerySortOptions: ['receivedAt'],
                maxMailboxDepth: 10,
                maxMailboxesPerEmail: null,
                maxSizeAttachmentsPerEmail: 5000,
                maxSizeMailboxName: 255,
                mayCreateTopLevelMailbox: true,
              },
            },
            isPersonal: true,
            isReadOnly: false,
            name: 'Primary',
          },
        },
        capabilities: {
          [JMAP_CAPABILITY_URNS.core]: createSessionPayload().capabilities[JMAP_CAPABILITY_URNS.core],
          [JMAP_CAPABILITY_URNS.mail]: createSessionPayload().capabilities[JMAP_CAPABILITY_URNS.mail],
        },
        primaryAccounts: {
          [JMAP_CAPABILITY_URNS.mail]: 'accountA',
        },
      }),
    );

    const uploadAccess = await client.blob.uploadAccess();
    const realtime = await getRealtimeAccess(client);

    expect('kind' in uploadAccess && uploadAccess.kind === 'capability').toBe(true);
    expect('mode' in realtime && realtime.mode === 'none').toBe(true);
  });

  it('selects explicit or primary accounts safely', async () => {
    const client = createJmapClient(createFetchMock());
    const primary = await client.selectAccount('mail');
    const explicit = await client.selectAccount('mail', 'accountB');

    expect('ok' in primary && primary.ok && primary.account.id).toBe('accountA');
    expect('ok' in explicit && explicit.ok && explicit.account.id).toBe('accountB');
  });

  it('batches typed method calls through the single proxy surface', async () => {
    const requests: readonly JmapMethodCall[] = [
      createMethodCall('Mailbox/get', { ids: ['inbox'] }, 'mailboxes'),
      createMethodCall('Email/query', { limit: 20 }, 'emails'),
    ];

    const client = createJmapClient(createFetchMock());
    const result = await client.call(requests);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.responses).toHaveLength(2);
    expect(result.responses[0].callId).toBe('mailboxes');
    if (result.responses[0].kind === 'success' && result.responses[0].name === 'Mailbox/get') {
      expect(result.responses[0].response.list[0]?.id).toBe('inbox');
      expect(result.responses[0].response.list[0]?.name).toBe('Inbox');
    }
    expect(result.createdIds.temp1).toBe('email-1');
  });

  it('normalizes transport and method errors', async () => {
    const transportClient = createJmapClient(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/jmap/session') {
        return new Response(JSON.stringify({ message: 'boom' }), {
          headers: { 'content-type': 'application/json' },
          status: 502,
        });
      }

      return new Response('not-found', { status: 404 });
    });

    const transport = await transportClient.mailbox.get();
    expect(transport.ok).toBe(false);
    if (!transport.ok) {
      expect(transport.error.kind).toBe('transport');
    }

    const methodClient = createJmapClient(createFetchMock());
    const method = await methodClient.submission.set({ create: { temp1: { emailId: 'email-1', identityId: 'identity-1' } } });
    expect(method.ok).toBe(true);
    if (method.ok) {
      expect(method.result.kind).toBe('method-error');
      if (method.result.kind === 'method-error') {
        expect(method.result.error.type).toBe('forbidden');
      }
    }
  });

  it('returns unauthenticated when the session BFF rejects the cookie', async () => {
    const client = createJmapClient(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/jmap/session') {
        return new Response(JSON.stringify({ message: 'unauthorized' }), {
          headers: { 'content-type': 'application/json' },
          status: 401,
        });
      }

      return new Response('not-found', { status: 404 });
    });

    const bootstrap = await client.bootstrap();
    expect(bootstrap.status).toBe('unauthenticated');
  });
});
