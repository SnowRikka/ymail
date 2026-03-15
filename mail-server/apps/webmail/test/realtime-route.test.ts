import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET as realtimeGet } from '@/app/api/realtime/route';
import { GET as realtimeStreamGet } from '@/app/api/realtime/stream/route';
import { AUTH_COOKIE_NAME } from '@/lib/auth/cookie';
import { createAppSession, getAppSessionById, resetAuthSessionStoreForTests } from '@/lib/auth/store';
import { JMAP_CAPABILITY_URNS } from '@/lib/jmap/types';

function createSessionPayload() {
  return {
    accounts: {
      primary: {
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
    apiUrl: 'https://mail.example.com/jmap',
    capabilities: {
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
      [JMAP_CAPABILITY_URNS.websocket]: {
        supportsPush: true,
        url: 'wss://mail.example.com/jmap/ws',
      },
    },
    downloadUrl: 'https://mail.example.com/download/{accountId}/{blobId}/{name}?type={type}',
    eventSourceUrl: 'https://mail.example.com/events',
    primaryAccounts: { [JMAP_CAPABILITY_URNS.mail]: 'primary' },
    state: 'state-1',
    uploadUrl: 'https://mail.example.com/upload/{accountId}',
    username: 'alice@example.com',
  };
}

describe('realtime-route', () => {
  beforeEach(() => {
    vi.stubEnv('WEBMAIL_STALWART_BASE_URL', 'https://mail.example.com');
    resetAuthSessionStoreForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetAuthSessionStoreForTests();
  });

  it('returns a same-origin realtime descriptor instead of upstream transport URLs', async () => {
    const session = createAppSession({
      accountCount: 1,
      authorizationHeader: 'Basic hidden',
      username: 'alice@example.com',
    });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(createSessionPayload()), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })));

    const response = await realtimeGet(new NextRequest('http://localhost/api/realtime', {
      headers: { cookie: `${AUTH_COOKIE_NAME}=${session.id}` },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      realtime: {
        capability: {
          key: 'websocket',
          supported: true,
          urn: JMAP_CAPABILITY_URNS.websocket,
          value: {
            supportsPush: true,
            url: 'wss://mail.example.com/jmap/ws',
          },
        },
        eventSourceUrl: '/api/realtime/stream',
        mode: 'event-source',
        websocketUrl: null,
      },
      session: {
        accountCount: 1,
        expiresAt: expect.any(String),
        username: 'alice@example.com',
      },
    });
  });

  it('proxies upstream SSE through the same-origin stream endpoint', async () => {
    const session = createAppSession({
      accountCount: 1,
      authorizationHeader: 'Basic hidden',
      username: 'alice@example.com',
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://mail.example.com/jmap/session') {
        return new Response(JSON.stringify(createSessionPayload()), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }

      if (url === 'https://mail.example.com/events') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"changed":["Mailbox"]}\n\n'));
            controller.close();
          },
        }), {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        });
      }

      return new Response('not-found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await realtimeStreamGet(new NextRequest('http://localhost/api/realtime/stream', {
      headers: { cookie: `${AUTH_COOKIE_NAME}=${session.id}` },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mail.example.com/events',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'text/event-stream',
          authorization: 'Basic hidden',
        }),
        method: 'GET',
      }),
    );

    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    const text = chunk ? new TextDecoder().decode(chunk.value) : '';

    expect(text).toContain('data: {"changed":["Mailbox"]}');
  });

  it.each([401, 403])('clears the cookie-backed session when upstream SSE auth expires with %s', async (status) => {
    const session = createAppSession({
      accountCount: 1,
      authorizationHeader: 'Basic hidden',
      username: 'alice@example.com',
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://mail.example.com/jmap/session') {
        return new Response(JSON.stringify(createSessionPayload()), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }

      return new Response(null, { status });
    }));

    const response = await realtimeStreamGet(new NextRequest('http://localhost/api/realtime/stream', {
      headers: { cookie: `${AUTH_COOKIE_NAME}=${session.id}` },
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_COOKIE_NAME}=`);
    expect(getAppSessionById(session.id)).toBeNull();
  });

  it('returns 204 so EventSource stops reconnecting when upstream SSE transport throws', async () => {
    const session = createAppSession({
      accountCount: 1,
      authorizationHeader: 'Basic hidden',
      username: 'alice@example.com',
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://mail.example.com/jmap/session') {
        return new Response(JSON.stringify(createSessionPayload()), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }

      throw new Error('transport unavailable');
    }));

    const response = await realtimeStreamGet(new NextRequest('http://localhost/api/realtime/stream', {
      headers: { cookie: `${AUTH_COOKIE_NAME}=${session.id}` },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(getAppSessionById(session.id)).not.toBeNull();
  });

  it('returns 204 for non-auth upstream SSE failures so polling fallback is stable', async () => {
    const session = createAppSession({
      accountCount: 1,
      authorizationHeader: 'Basic hidden',
      username: 'alice@example.com',
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://mail.example.com/jmap/session') {
        return new Response(JSON.stringify(createSessionPayload()), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }

      return new Response('temporarily unavailable', { status: 502 });
    }));

    const response = await realtimeStreamGet(new NextRequest('http://localhost/api/realtime/stream', {
      headers: { cookie: `${AUTH_COOKIE_NAME}=${session.id}` },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(getAppSessionById(session.id)).not.toBeNull();
  });
});
