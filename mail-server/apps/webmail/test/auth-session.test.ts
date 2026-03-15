import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST as loginPost } from '@/app/auth/login/route';
import { POST as logoutPost } from '@/app/auth/logout/route';
import { GET as sessionGet } from '@/app/auth/session/route';
import { POST as jmapPost } from '@/app/api/jmap/route';
import { POST as uploadPost } from '@/app/api/jmap/upload/[accountId]/route';
import { AUTH_COOKIE_NAME, AUTH_SESSION_MAX_AGE_SECONDS, isOpaqueSessionId } from '@/lib/auth/cookie';
import { createAppSession, getAppSessionById, resetAuthSessionStoreForTests } from '@/lib/auth/store';

function readSetCookie(response: Response) {
  return response.headers.get('set-cookie') ?? '';
}

function readSessionIdFromCookie(setCookieHeader: string) {
  return setCookieHeader.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`))?.[1] ?? null;
}

describe('auth-session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'));
    vi.stubEnv('WEBMAIL_STALWART_BASE_URL', 'https://mail.example.com');
    resetAuthSessionStoreForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetAuthSessionStoreForTests();
  });

  it('creates an opaque cookie-backed app session on login success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accounts: {
            primary: {
              accountCapabilities: {
                'urn:ietf:params:jmap:mail': {
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
            secondary: {
              accountCapabilities: {
                'urn:ietf:params:jmap:mail': {
                  emailQuerySortOptions: ['receivedAt'],
                  maxMailboxDepth: 5,
                  maxMailboxesPerEmail: null,
                  maxSizeAttachmentsPerEmail: 5000,
                  maxSizeMailboxName: 255,
                  mayCreateTopLevelMailbox: false,
                },
              },
              isPersonal: false,
              isReadOnly: true,
              name: 'Secondary',
            },
          },
          apiUrl: 'https://mail.example.com/jmap',
          capabilities: {
            'urn:ietf:params:jmap:core': {
              collationAlgorithms: ['i;unicode-casemap'],
              maxCallsInRequest: 16,
              maxConcurrentRequests: 8,
              maxConcurrentUpload: 4,
              maxObjectsInGet: 256,
              maxObjectsInSet: 128,
              maxSizeRequest: 1000000,
              maxSizeUpload: 5000000,
            },
            'urn:ietf:params:jmap:mail': {
              emailQuerySortOptions: ['receivedAt'],
              maxMailboxDepth: 10,
              maxMailboxesPerEmail: null,
              maxSizeAttachmentsPerEmail: 5000,
              maxSizeMailboxName: 255,
              mayCreateTopLevelMailbox: true,
            },
          },
          downloadUrl: 'https://mail.example.com/download/{accountId}/{blobId}/{name}?type={type}',
          eventSourceUrl: 'https://mail.example.com/events',
          primaryAccounts: { 'urn:ietf:params:jmap:mail': 'primary' },
          state: 'state-1',
          uploadUrl: 'https://mail.example.com/upload/{accountId}',
          username: 'alice@example.com',
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    const response = await loginPost(
      new Request('http://localhost/auth/login', {
        body: JSON.stringify({ next: '/mail/inbox', password: 'secret', username: 'alice@example.com' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    const payload = await response.json();
    const cookieHeader = readSetCookie(response);
    const sessionId = readSessionIdFromCookie(cookieHeader);

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      authenticated: true,
      redirectTo: '/mail/inbox',
      session: {
        accountCount: 2,
        expiresAt: expect.any(String),
        username: 'alice@example.com',
      },
    });
    expect(cookieHeader).toContain(`${AUTH_COOKIE_NAME}=`);
    expect(sessionId).not.toBeNull();
    expect(isOpaqueSessionId(sessionId)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(JSON.stringify(payload)).not.toContain('authorization');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mail.example.com/jmap/session',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^Basic /),
        }),
        method: 'GET',
      }),
    );
  });

  it('returns only safe session metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accounts: {
            primary: {
              accountCapabilities: {
                'urn:ietf:params:jmap:mail': {
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
            'urn:ietf:params:jmap:core': {
              collationAlgorithms: ['i;unicode-casemap'],
              maxCallsInRequest: 16,
              maxConcurrentRequests: 8,
              maxConcurrentUpload: 4,
              maxObjectsInGet: 256,
              maxObjectsInSet: 128,
              maxSizeRequest: 1000000,
              maxSizeUpload: 5000000,
            },
            'urn:ietf:params:jmap:mail': {
              emailQuerySortOptions: ['receivedAt'],
              maxMailboxDepth: 10,
              maxMailboxesPerEmail: null,
              maxSizeAttachmentsPerEmail: 5000,
              maxSizeMailboxName: 255,
              mayCreateTopLevelMailbox: true,
            },
          },
          downloadUrl: 'https://mail.example.com/download/{accountId}/{blobId}/{name}?type={type}',
          eventSourceUrl: 'https://mail.example.com/events',
          primaryAccounts: { 'urn:ietf:params:jmap:mail': 'primary' },
          state: 'state-1',
          uploadUrl: 'https://mail.example.com/upload/{accountId}',
          username: 'safe@example.com',
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    const session = createAppSession({
      accountCount: 1,
      authorizationHeader: 'Basic hidden',
      username: 'safe@example.com',
    });

    const response = await sessionGet(
      new NextRequest('http://localhost/auth/session', {
        headers: { cookie: `${AUTH_COOKIE_NAME}=${session.id}` },
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      authenticated: true,
      session: {
        accountCount: 1,
        expiresAt: expect.any(String),
        username: 'safe@example.com',
      },
      jmap: expect.objectContaining({
        apiUrl: 'https://mail.example.com/jmap',
        username: 'safe@example.com',
      }),
    });
    expect(payload.session.authorizationHeader).toBeUndefined();
    expect(payload.session.id).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mail.example.com/jmap/session',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Basic hidden',
        }),
        method: 'GET',
      }),
    );
  });

  it('destroys the app session and clears the cookie on logout', async () => {
    const session = createAppSession({
      accountCount: 1,
      authorizationHeader: 'Basic hidden',
      username: 'logout@example.com',
    });

    const response = await logoutPost(
      new NextRequest('http://localhost/auth/logout', {
        headers: { cookie: `${AUTH_COOKIE_NAME}=${session.id}` },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(readSetCookie(response)).toContain(`${AUTH_COOKIE_NAME}=`);
    expect(readSetCookie(response)).toContain('Max-Age=0');
    expect(getAppSessionById(session.id, { touch: false })).toBeNull();
  });

  it('expires stale sessions and clears the cookie', async () => {
    const session = createAppSession(
      {
        accountCount: 1,
        authorizationHeader: 'Basic hidden',
        username: 'expired@example.com',
      },
      Date.now(),
    );

    vi.setSystemTime(new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000 + 1000));

    const response = await sessionGet(
      new NextRequest('http://localhost/auth/session', {
        headers: { cookie: `${AUTH_COOKIE_NAME}=${session.id}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(readSetCookie(response)).toContain('Max-Age=0');
  });

  it('fails closed for protected jmap proxy requests without a valid session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await jmapPost(
      new NextRequest('http://localhost/api/jmap', {
        body: JSON.stringify({ using: [], methodCalls: [] }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: '登录状态已失效，请重新登录。' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed and clears state when the proxy session is expired', async () => {
    const session = createAppSession({
      accountCount: 1,
      authorizationHeader: 'Basic hidden',
      username: 'proxy@example.com',
    });

    vi.setSystemTime(new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000 + 1000));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await jmapPost(
      new NextRequest('http://localhost/api/jmap', {
        body: JSON.stringify({ using: [], methodCalls: [] }),
        headers: {
          'content-type': 'application/json',
          cookie: `${AUTH_COOKIE_NAME}=${session.id}`,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: '登录状态已失效，请重新登录。' });
    expect(readSetCookie(response)).toContain('Max-Age=0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the cached upload URL so attachment uploads do not fail on avoidable session refetch 502s', async () => {
    const session = createAppSession({
      accountCount: 1,
      authorizationHeader: 'Basic hidden',
      uploadUrl: 'https://mail.example.com/upload/{accountId}',
      username: 'upload@example.com',
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://mail.example.com/upload/primary') {
        return new Response(JSON.stringify({ accountId: 'primary', blobId: 'blob-1', size: 4, type: 'text/plain' }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }

      return new Response('unexpected', { status: 500 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await uploadPost(
      new NextRequest('http://localhost/api/jmap/upload/primary', {
        body: new Uint8Array([1, 2, 3, 4]),
        headers: {
          'content-type': 'text/plain',
          cookie: `${AUTH_COOKIE_NAME}=${session.id}`,
          'x-file-name': encodeURIComponent('note.txt'),
        },
        method: 'POST',
      }),
      { params: Promise.resolve({ accountId: 'primary' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accountId: 'primary', blobId: 'blob-1', size: 4, type: 'text/plain' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mail.example.com/upload/primary',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Basic hidden',
          'x-file-name': 'note.txt',
        }),
        method: 'POST',
      }),
    );
  });
});
