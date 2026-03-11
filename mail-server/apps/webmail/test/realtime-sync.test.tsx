import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MailShell } from '@/components/mail/mail-shell';
import { ToastProvider } from '@/components/system/toast-region';
import { getRealtimeAccess } from '@/lib/jmap/client';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';
import { getQueryClient } from '@/lib/query/client';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockReplace = vi.fn();

let mockPathname = '/mail/inbox';
let mockSearch = 'accountId=primary&mailboxId=inbox-id';
let intervalHandler: (() => void) | null = null;
let realtimeDescriptor: { readonly eventSourceUrl: string; readonly mode: 'event-source' | 'none'; readonly websocketUrl: null };

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 0;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
  }

  emitClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  emitError() {
    this.onerror?.();
  }

  emitMessage(data = '{}') {
    this.onmessage?.({ data });
  }

  emitOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: string) {
    this.sent.push(data);
  }
}

class MockEventSource {
  static instances: MockEventSource[] = [];

  onerror: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(readonly url: string, readonly options?: { readonly withCredentials?: boolean }) {
    MockEventSource.instances.push(this);
  }

  close() {
    return undefined;
  }

  emitError() {
    this.onerror?.();
  }

  emitMessage(data = '{}') {
    this.onmessage?.({ data });
  }

  emitOpen() {
    this.onopen?.();
  }
}

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush, refresh: mockRefresh, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock('@/lib/jmap/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jmap/provider')>('@/lib/jmap/provider');

  return {
    ...actual,
    useJmapBootstrap: vi.fn(),
    useJmapClient: vi.fn(),
  };
});

vi.mock('@/lib/jmap/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jmap/client')>('@/lib/jmap/client');

  return {
    ...actual,
    getRealtimeAccess: vi.fn(),
  };
});

const mockedUseJmapBootstrap = vi.mocked(useJmapBootstrap);
const mockedUseJmapClient = vi.mocked(useJmapClient);
const mockedGetRealtimeAccess = vi.mocked(getRealtimeAccess);

const session = {
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
  primaryAccounts: {
    blob: null,
    mail: 'primary',
    quota: null,
    sieve: null,
    submission: null,
  },
  username: 'tester@example.com',
} as const;

function createMockClient(versionRef: { current: 1 | 2 }) {
  const mailboxQuery = vi.fn(async () => ({
    ok: true,
    result: {
      kind: 'success',
      response: {
        accountId: 'primary',
        canCalculateChanges: false,
        ids: ['inbox-id'],
        position: 0,
        queryState: `mailbox-query-${versionRef.current}`,
        total: 1,
      },
    },
  }));

  const mailboxGet = vi.fn(async () => ({
    ok: true,
    result: {
      kind: 'success',
      response: {
        accountId: 'primary',
        list: [{ id: 'inbox-id', name: 'Inbox', role: 'inbox', totalThreads: versionRef.current === 1 ? 1 : 2, unreadThreads: versionRef.current === 1 ? 1 : 2 }],
        state: `mailbox-state-${versionRef.current}`,
      },
    },
  }));

  const emailQuery = vi.fn(async () => ({
    ok: true,
    result: {
      kind: 'success',
      response: {
        accountId: 'primary',
        canCalculateChanges: true,
        ids: versionRef.current === 1 ? ['email-1'] : ['email-2', 'email-1'],
        position: 0,
        queryState: `email-query-${versionRef.current}`,
        total: versionRef.current,
      },
    },
  }));

  const emailGet = vi.fn(async () => ({
    ok: true,
    result: {
      kind: 'success',
      response: {
        accountId: 'primary',
        list: versionRef.current === 1
          ? [{ from: [{ email: 'one@example.com', name: 'One' }], hasAttachment: false, id: 'email-1', keywords: {}, mailboxIds: { 'inbox-id': true }, preview: 'Preview one', receivedAt: '2026-03-10T10:00:00.000Z', subject: 'Thread one', threadId: 'thread-1' }]
          : [
              { from: [{ email: 'two@example.com', name: 'Two' }], hasAttachment: false, id: 'email-2', keywords: {}, mailboxIds: { 'inbox-id': true }, preview: 'Preview two', receivedAt: '2026-03-10T11:00:00.000Z', subject: 'Thread two', threadId: 'thread-2' },
              { from: [{ email: 'one@example.com', name: 'One' }], hasAttachment: false, id: 'email-1', keywords: {}, mailboxIds: { 'inbox-id': true }, preview: 'Preview one', receivedAt: '2026-03-10T10:00:00.000Z', subject: 'Thread one', threadId: 'thread-1' },
            ],
        state: `email-state-${versionRef.current}`,
      },
    },
  }));

  const threadGet = vi.fn(async () => ({
    ok: true,
    result: {
      kind: 'success',
      response: {
        accountId: 'primary',
        list: versionRef.current === 1
          ? [{ emailIds: ['email-1'], id: 'thread-1' }]
          : [{ emailIds: ['email-2'], id: 'thread-2' }, { emailIds: ['email-1'], id: 'thread-1' }],
        state: `thread-state-${versionRef.current}`,
      },
    },
  }));

  const mailboxChanges = vi.fn(async ({ sinceState }: { sinceState: string }) => ({
    ok: true,
    result: {
      kind: 'success',
      response: {
        accountId: 'primary',
        created: [],
        destroyed: [],
        hasMoreChanges: false,
        newState: `mailbox-state-${versionRef.current}`,
        oldState: sinceState,
        updated: sinceState === `mailbox-state-${versionRef.current}` ? [] : ['inbox-id'],
      },
    },
  }));

  const threadChanges = vi.fn(async ({ sinceState }: { sinceState: string }) => ({
    ok: true,
    result: {
      kind: 'success',
      response: {
        accountId: 'primary',
        created: sinceState === `thread-state-${versionRef.current}` ? [] : ['thread-2'],
        destroyed: [],
        hasMoreChanges: false,
        newState: `thread-state-${versionRef.current}`,
        oldState: sinceState,
        updated: [],
      },
    },
  }));

  const queryChanges = vi.fn(async ({ sinceQueryState }: { sinceQueryState: string }) => ({
    ok: true,
    result: {
      kind: 'success',
      response: {
        accountId: 'primary',
        added: sinceQueryState === `email-query-${versionRef.current}` ? [] : [{ id: 'email-2', index: 0 }],
        newQueryState: `email-query-${versionRef.current}`,
        oldQueryState: sinceQueryState,
        removed: [],
        total: versionRef.current,
      },
    },
  }));

  return {
    email: {
      get: emailGet,
      query: emailQuery,
      queryChanges,
    },
    mailbox: {
      changes: mailboxChanges,
      get: mailboxGet,
      query: mailboxQuery,
    },
    thread: {
      changes: threadChanges,
      get: threadGet,
    },
  };
}

function renderShell() {
  const queryClient = getQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MailShell eyebrow="收件箱" intro="intro" readerTitle="reader" sectionTitle="线程">
          <div>reader</div>
        </MailShell>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockPathname = '/mail/inbox';
  mockSearch = 'accountId=primary&mailboxId=inbox-id';
  intervalHandler = null;
  realtimeDescriptor = {
    eventSourceUrl: '',
    mode: 'none',
    websocketUrl: null,
  };
  MockWebSocket.instances = [];
  MockEventSource.instances = [];
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockReplace.mockReset();
  getQueryClient().clear();
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      authenticated: true,
      realtime: realtimeDescriptor,
    }),
  })));
  vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler) => {
    intervalHandler = typeof handler === 'function' ? (() => { handler(); }) : null;
    return 1;
  }) as typeof window.setInterval);
  vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
  mockedUseJmapBootstrap.mockReturnValue({
    data: {
      session,
      status: 'ready',
    },
    isLoading: false,
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('realtime-sync', () => {
  it('degrades none capability to polling and keeps visible sync status', async () => {
    const versionRef = { current: 1 as const };
    const client = createMockClient(versionRef);

    mockedUseJmapClient.mockReturnValue(client as never);
    mockedGetRealtimeAccess.mockResolvedValue({
      capability: { key: 'websocket', supported: false, urn: 'urn:ietf:params:jmap:websocket', value: null },
      eventSourceUrl: '',
      kind: 'realtime',
      mode: 'none',
      websocketUrl: null,
    });

    renderShell();

    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('轮询同步正常'));

    intervalHandler?.();

    await waitFor(() => {
      expect(client.mailbox.changes).toHaveBeenCalledTimes(1);
      expect(client.email.queryChanges).toHaveBeenCalledTimes(1);
      expect(client.thread.changes).toHaveBeenCalledTimes(1);
    });
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('consumes the same-origin SSE bridge for push-capable sessions and treats push as invalidation only', async () => {
    const versionRef: { current: 1 | 2 } = { current: 1 };
    const client = createMockClient(versionRef);
    realtimeDescriptor = {
      eventSourceUrl: '/api/realtime/stream',
      mode: 'event-source',
      websocketUrl: null,
    };

    mockedUseJmapClient.mockReturnValue(client as never);
    mockedGetRealtimeAccess.mockResolvedValue({
      capability: { key: 'websocket', supported: true, urn: 'urn:ietf:params:jmap:websocket', value: { supportsPush: true, url: 'wss://example.test/ws' } },
      eventSourceUrl: 'https://example.test/events',
      kind: 'realtime',
      mode: 'websocket',
      websocketUrl: 'wss://example.test/ws',
    });

    renderShell();

    await waitFor(() => expect(screen.getByTestId('thread-row-thread-1')).toBeInTheDocument());
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));

    const source = MockEventSource.instances.at(-1);

    act(() => {
      source?.emitOpen();
    });

    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('事件流同步正常'));
    expect(source?.url).toBe('/api/realtime/stream');
    expect(source?.options).toEqual({ withCredentials: true });
    expect(MockWebSocket.instances).toHaveLength(0);

    versionRef.current = 2;
    act(() => {
      source?.emitMessage('{"@type":"StateChange"}');
    });

    await waitFor(() => {
      expect(screen.getByTestId('thread-row-thread-2')).toBeInTheDocument();
      expect(screen.getByText('未读 2')).toBeInTheDocument();
      expect(screen.getByTestId('live-update-toast')).toHaveTextContent('已完成断线后的权威对账。');
    });
    expect(client.mailbox.changes).toHaveBeenCalled();
    expect(client.email.queryChanges).toHaveBeenCalled();
    expect(client.thread.changes).toHaveBeenCalled();
  });

  it('consumes event-source transport and falls back safely on transport error', async () => {
    const versionRef: { current: 1 | 2 } = { current: 1 };
    const client = createMockClient(versionRef);
    realtimeDescriptor = {
      eventSourceUrl: '/api/realtime/stream',
      mode: 'event-source',
      websocketUrl: null,
    };

    mockedUseJmapClient.mockReturnValue(client as never);
    mockedGetRealtimeAccess.mockResolvedValue({
      capability: { key: 'websocket', supported: true, urn: 'urn:ietf:params:jmap:websocket', value: { supportsPush: false, url: 'wss://example.test/ws' } },
      eventSourceUrl: 'https://example.test/events',
      kind: 'realtime',
      mode: 'event-source',
      websocketUrl: null,
    });

    renderShell();

    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    const source = MockEventSource.instances.at(-1);
    act(() => {
      source?.emitOpen();
    });
    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('事件流同步正常'));

    act(() => {
      source?.emitError();
    });
    expect(screen.getByTestId('sync-reconnecting')).toBeInTheDocument();

    expect(screen.getByTestId('sync-status')).toHaveTextContent('轮询重连中');
  });

  it('surfaces sync-error when authoritative reconcile fails', async () => {
    const versionRef = { current: 1 as const };
    const client = createMockClient(versionRef);
    client.mailbox.changes = vi.fn(async () => ({ ok: false, error: { kind: 'transport', message: 'sync failed', status: 502 } })) as unknown as typeof client.mailbox.changes;

    mockedUseJmapClient.mockReturnValue(client as never);
    mockedGetRealtimeAccess.mockResolvedValue({
      capability: { key: 'websocket', supported: false, urn: 'urn:ietf:params:jmap:websocket', value: null },
      eventSourceUrl: '',
      kind: 'realtime',
      mode: 'none',
      websocketUrl: null,
    });

    renderShell();

    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('轮询同步正常'));

    intervalHandler?.();

    await waitFor(() => expect(screen.getByTestId('sync-error')).toHaveTextContent('sync failed'));
  });

  it('falls back to polling when same-origin realtime discovery fails', async () => {
    const versionRef = { current: 1 as const };
    const client = createMockClient(versionRef);

    mockedUseJmapClient.mockReturnValue(client as never);
    mockedGetRealtimeAccess.mockResolvedValue({
      capability: { key: 'websocket', supported: true, urn: 'urn:ietf:params:jmap:websocket', value: { supportsPush: true, url: 'wss://example.test/ws' } },
      eventSourceUrl: 'https://example.test/events',
      kind: 'realtime',
      mode: 'websocket',
      websocketUrl: 'wss://example.test/ws',
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
    })));

    renderShell();

    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('轮询同步正常'));
    expect(MockEventSource.instances).toHaveLength(0);
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
