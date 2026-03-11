'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getRealtimeAccess } from '@/lib/jmap/client';
import type { MailboxCollectionData } from '@/lib/jmap/mailbox-shell';
import { useJmapClient } from '@/lib/jmap/provider';
import { THREAD_LIST_EMAIL_QUERY_SORT, type ThreadListPageData } from '@/lib/jmap/thread-list';
import { type JmapExecutionError, type JmapRealtimeAccess } from '@/lib/jmap/types';
import { getQueryClient } from '@/lib/query/client';
import { createRealtimeStatusState, selectRealtimeRuntimeMode, type RealtimeStatusState, type RealtimeSyncReason } from '@/lib/realtime/status';

const POLL_INTERVAL_MS = 45_000;
const RESUME_DEBOUNCE_MS = 200;
const TOAST_DURATION_MS = 4_000;
const PUSH_ENABLE_PAYLOAD = JSON.stringify({
  '@type': 'WebSocketPushEnable',
  dataTypes: ['Mailbox', 'Email', 'Thread'],
});

interface UseRealtimeSyncInput {
  readonly activeAccountId: string | null;
  readonly activeMailboxId: string | null;
  readonly enabled: boolean;
}

interface ReconcileResult {
  readonly errorMessage: string | null;
  readonly mailboxInvalidated: boolean;
  readonly threadInvalidated: boolean;
}

interface RealtimeRouteDescriptor {
  readonly eventSourceUrl: string;
  readonly mode: Extract<JmapRealtimeAccess['mode'], 'event-source' | 'none'>;
  readonly websocketUrl: null;
}

function toBoundarySafePollingAccess(access: JmapRealtimeAccess): JmapRealtimeAccess {
  return {
    ...access,
    eventSourceUrl: '',
    mode: 'none',
    websocketUrl: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRealtimeRouteDescriptor(value: unknown): RealtimeRouteDescriptor | null {
  if (!isRecord(value) || !isRecord(value.realtime)) {
    return null;
  }

  const mode = value.realtime.mode;
  const eventSourceUrl = value.realtime.eventSourceUrl;
  const websocketUrl = value.realtime.websocketUrl;

  if ((mode !== 'none' && mode !== 'event-source') || typeof eventSourceUrl !== 'string') {
    return null;
  }

  if (websocketUrl !== null) {
    return null;
  }

  return {
    eventSourceUrl,
    mode,
    websocketUrl,
  };
}

async function loadRealtimeTransportAccess(client: ReturnType<typeof useJmapClient>): Promise<JmapExecutionError | JmapRealtimeAccess> {
  const baseAccess = await getRealtimeAccess(client);

  if ('kind' in baseAccess && baseAccess.kind !== 'realtime') {
    return baseAccess;
  }

  const boundarySafePollingAccess = toBoundarySafePollingAccess(baseAccess);

  try {
    const response = await fetch('/api/realtime', {
      credentials: 'include',
      headers: { accept: 'application/json' },
      method: 'GET',
    });

    if (!response.ok) {
      return boundarySafePollingAccess;
    }

    const payload: unknown = await response.json();
    const descriptor = parseRealtimeRouteDescriptor(payload);

    if (!descriptor) {
      return boundarySafePollingAccess;
    }

    return {
      ...boundarySafePollingAccess,
      eventSourceUrl: descriptor.eventSourceUrl,
      mode: descriptor.mode,
      websocketUrl: descriptor.websocketUrl,
    };
  } catch {
    return boundarySafePollingAccess;
  }
}

function hasChanges(response: {
  readonly created?: readonly string[];
  readonly destroyed?: readonly string[];
  readonly hasMoreChanges?: boolean;
  readonly removed?: readonly string[];
  readonly updated?: readonly string[];
  readonly added?: readonly { readonly id: string; readonly index: number }[];
}) {
  return (response.hasMoreChanges ?? false)
    || (response.created?.length ?? 0) > 0
    || (response.updated?.length ?? 0) > 0
    || (response.destroyed?.length ?? 0) > 0
    || (response.removed?.length ?? 0) > 0
    || (response.added?.length ?? 0) > 0;
}

function getMailboxSnapshot(queryClient: ReturnType<typeof getQueryClient>, accountId: string) {
  return queryClient.getQueryData<MailboxCollectionData>(['mailbox-shell', accountId]);
}

function getThreadSnapshot(queryClient: ReturnType<typeof getQueryClient>, accountId: string, mailboxId: string | null) {
  if (!mailboxId) {
    return undefined;
  }

  return queryClient
    .getQueriesData<ThreadListPageData>({ queryKey: ['thread-list', accountId, mailboxId] })
    .map(([, data]) => data)
    .find((data): data is ThreadListPageData => data !== undefined);
}

async function reconcileRealtimeState(input: {
  readonly accountId: string;
  readonly client: ReturnType<typeof useJmapClient>;
  readonly mailboxId: string | null;
  readonly queryClient: ReturnType<typeof getQueryClient>;
}): Promise<ReconcileResult> {
  const mailboxSnapshot = getMailboxSnapshot(input.queryClient, input.accountId);
  const threadSnapshot = getThreadSnapshot(input.queryClient, input.accountId, input.mailboxId);
  let mailboxInvalidated = mailboxSnapshot === undefined;
  let threadInvalidated = threadSnapshot === undefined && input.mailboxId !== null;
  let errorMessage: string | null = null;

  if (mailboxSnapshot?.state) {
    const mailboxChanges = await input.client.mailbox.changes({
      accountId: input.accountId,
      sinceState: mailboxSnapshot.state,
    });

    if (!mailboxChanges.ok) {
      errorMessage = mailboxChanges.error.message;
      mailboxInvalidated = true;
    } else if (mailboxChanges.result.kind !== 'success') {
      errorMessage = mailboxChanges.result.error.description ?? '邮箱同步失败。';
      mailboxInvalidated = true;
    } else if (hasChanges(mailboxChanges.result.response)) {
      mailboxInvalidated = true;
    }
  }

  if (threadSnapshot) {
    const queryChanges = await input.client.email.queryChanges({
      accountId: input.accountId,
      filter: {
        inMailbox: threadSnapshot.mailboxId,
      },
      sinceQueryState: threadSnapshot.sync.emailQueryState,
      sort: THREAD_LIST_EMAIL_QUERY_SORT,
    });

    if (!queryChanges.ok) {
      errorMessage = errorMessage ?? queryChanges.error.message;
      threadInvalidated = true;
    } else if (queryChanges.result.kind !== 'success') {
      errorMessage = errorMessage ?? queryChanges.result.error.description ?? '线程同步失败。';
      threadInvalidated = true;
    } else if (hasChanges(queryChanges.result.response)) {
      threadInvalidated = true;
    }

    if (threadSnapshot.sync.threadState) {
      const threadChanges = await input.client.thread.changes({
        accountId: input.accountId,
        sinceState: threadSnapshot.sync.threadState,
      });

      if (!threadChanges.ok) {
        errorMessage = errorMessage ?? threadChanges.error.message;
        threadInvalidated = true;
      } else if (threadChanges.result.kind !== 'success') {
        errorMessage = errorMessage ?? threadChanges.result.error.description ?? '线程同步失败。';
        threadInvalidated = true;
      } else if (hasChanges(threadChanges.result.response)) {
        threadInvalidated = true;
      }
    }
  }

  if (mailboxInvalidated) {
    await input.queryClient.invalidateQueries({ queryKey: ['mailbox-shell', input.accountId] });
  }

  if (threadInvalidated && input.mailboxId) {
    await input.queryClient.invalidateQueries({ queryKey: ['thread-list', input.accountId, input.mailboxId] });
  }

  return {
    errorMessage,
    mailboxInvalidated,
    threadInvalidated,
  };
}

export function useRealtimeSync(input: UseRealtimeSyncInput) {
  const client = useJmapClient();
  const queryClient = useMemo(() => getQueryClient(), []);
  const [state, setState] = useState<RealtimeStatusState>(() => createRealtimeStatusState());
  const pollTimerRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const hiddenRef = useRef(false);
  const syncingRef = useRef(false);
  const pendingRef = useRef<RealtimeSyncReason | null>(null);
  const transportCleanupRef = useRef<(() => void) | null>(null);

  const clearPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const clearToastTimer = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const clearTransport = useCallback(() => {
    transportCleanupRef.current?.();
    transportCleanupRef.current = null;
  }, []);

  const setPhase = useCallback((phase: RealtimeStatusState['phase'], extras?: Partial<Omit<RealtimeStatusState, 'phase' | 'statusLabel'>>) => {
    setState((current) => createRealtimeStatusState({
      capabilityMode: extras?.capabilityMode ?? current.capabilityMode,
      errorMessage: extras?.errorMessage ?? current.errorMessage,
      phase,
      runtimeMode: extras?.runtimeMode ?? current.runtimeMode,
      toastMessage: extras?.toastMessage ?? current.toastMessage,
    }));
  }, []);

  const queueSync = useCallback((reason: RealtimeSyncReason) => {
    if (syncingRef.current) {
      pendingRef.current = reason;
      return;
    }

    if (!input.activeAccountId) {
      return;
    }

    syncingRef.current = true;
    if (reason !== 'poll') {
      setPhase('reconnecting', { toastMessage: null });
    }

    void reconcileRealtimeState({
      accountId: input.activeAccountId,
      client,
      mailboxId: input.activeMailboxId,
      queryClient,
    }).then((result) => {
      syncingRef.current = false;

      if (result.errorMessage) {
        setPhase('error', { errorMessage: result.errorMessage, toastMessage: null });
      } else {
        const showToast = reason !== 'poll' && (result.mailboxInvalidated || result.threadInvalidated);
        setPhase('healthy', {
          errorMessage: null,
          toastMessage: showToast ? '已完成断线后的权威对账。' : null,
        });

        clearToastTimer();
        if (showToast) {
          toastTimerRef.current = window.setTimeout(() => {
            setState((current) => createRealtimeStatusState({ ...current, toastMessage: null }));
          }, TOAST_DURATION_MS);
        }
      }

      if (pendingRef.current) {
        const nextReason = pendingRef.current;
        pendingRef.current = null;
        queueSync(nextReason);
      }
    });
  }, [clearToastTimer, client, input.activeAccountId, input.activeMailboxId, queryClient, setPhase]);

  useEffect(() => {
    if (!input.enabled || !input.activeAccountId) {
      clearPolling();
      clearResumeTimer();
      clearToastTimer();
      clearTransport();
      hiddenRef.current = false;
      pendingRef.current = null;
      syncingRef.current = false;
      setState(createRealtimeStatusState());
      return;
    }

    let disposed = false;
    let currentAccess: JmapRealtimeAccess | null = null;

    const startPolling = () => {
      clearPolling();
      pollTimerRef.current = window.setInterval(() => {
        if (!disposed) {
          queueSync('poll');
        }
      }, POLL_INTERVAL_MS);
    };

    const connectTransport = (access: JmapRealtimeAccess) => {
      clearTransport();

      if (access.mode === 'none') {
        return;
      }

      if (access.mode === 'websocket') {
        if (typeof WebSocket === 'undefined' || !access.websocketUrl) {
          setPhase('healthy', { capabilityMode: access.mode, runtimeMode: 'polling' });
          return;
        }

        const socket = new WebSocket(access.websocketUrl);
        socket.onopen = () => {
          socket.send(PUSH_ENABLE_PAYLOAD);
          setPhase('healthy', {
            capabilityMode: access.mode,
            errorMessage: null,
            runtimeMode: 'websocket',
            toastMessage: null,
          });
        };
        socket.onmessage = () => {
          queueSync('push');
        };
        socket.onerror = () => {
          setPhase('reconnecting', {
            capabilityMode: access.mode,
            runtimeMode: 'polling',
            toastMessage: null,
          });
        };
        socket.onclose = () => {
          transportCleanupRef.current = null;
          setPhase('reconnecting', {
            capabilityMode: access.mode,
            runtimeMode: 'polling',
            toastMessage: null,
          });
        };
        transportCleanupRef.current = () => {
          socket.onopen = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.onclose = null;
          if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
        };
        return;
      }

      if (typeof EventSource === 'undefined' || access.eventSourceUrl.length === 0) {
        setPhase('healthy', { capabilityMode: access.mode, runtimeMode: 'polling' });
        return;
      }

      const source = new EventSource(access.eventSourceUrl, { withCredentials: true });
      source.onopen = () => {
        setPhase('healthy', {
          capabilityMode: access.mode,
          errorMessage: null,
          runtimeMode: 'event-source',
          toastMessage: null,
        });
      };
      source.onmessage = () => {
        queueSync('push');
      };
      source.onerror = () => {
        setPhase('reconnecting', {
          capabilityMode: access.mode,
          runtimeMode: 'polling',
          toastMessage: null,
        });
      };
      transportCleanupRef.current = () => {
        source.onopen = null;
        source.onmessage = null;
        source.onerror = null;
        source.close();
      };
    };

    const reconnectTransport = () => {
      if (!currentAccess || currentAccess.mode === 'none') {
        return;
      }

      connectTransport(currentAccess);
    };

    const handleOffline = () => {
      clearTransport();
      setPhase('reconnecting', { runtimeMode: 'polling', toastMessage: null });
    };

    const handleOnline = () => {
      clearResumeTimer();
      resumeTimerRef.current = window.setTimeout(() => {
        if (!disposed) {
          reconnectTransport();
          queueSync('reconnect');
        }
      }, RESUME_DEBOUNCE_MS);
    };

    const handleVisibilityChange = () => {
      const isHidden = document.visibilityState !== 'visible';

      if (!isHidden && hiddenRef.current) {
        clearResumeTimer();
        resumeTimerRef.current = window.setTimeout(() => {
          if (!disposed) {
            reconnectTransport();
            queueSync('resume');
          }
        }, RESUME_DEBOUNCE_MS);
      }

      hiddenRef.current = isHidden;
    };

    setPhase('connecting', { errorMessage: null, toastMessage: null });
    startPolling();

    void loadRealtimeTransportAccess(client).then((access) => {
      if (disposed) {
        return;
      }

      if ('kind' in access && access.kind !== 'realtime') {
        setPhase('healthy', {
          capabilityMode: 'none',
          errorMessage: null,
          runtimeMode: 'polling',
          toastMessage: null,
        });
        return;
      }

      currentAccess = access;
      setPhase('healthy', {
        capabilityMode: access.mode,
        errorMessage: null,
        runtimeMode: selectRealtimeRuntimeMode(access),
        toastMessage: null,
      });
      connectTransport(access);
    }).catch((error: unknown) => {
      if (disposed) {
        return;
      }

      setPhase('error', {
        errorMessage: error instanceof Error ? error.message : '实时同步初始化失败。',
        runtimeMode: 'polling',
        toastMessage: null,
      });
    });

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      disposed = true;
      clearPolling();
      clearResumeTimer();
      clearToastTimer();
      clearTransport();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [clearPolling, clearResumeTimer, clearToastTimer, clearTransport, client, input.activeAccountId, input.enabled, queueSync, setPhase]);

  return useMemo(() => state, [state]);
}
