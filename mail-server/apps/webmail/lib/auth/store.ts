import { randomBytes } from 'node:crypto';

import { AUTH_SESSION_MAX_AGE_SECONDS, isOpaqueSessionId } from '@/lib/auth/cookie';
import type { SafeSessionSummary } from '@/lib/auth/types';

type AppSession = {
  accountCount: number;
  authorizationHeader: string;
  createdAt: number;
  expiresAt: number;
  id: string;
  testMode: boolean;
  username: string;
};

declare global {
  var __webmailAuthSessionStore: Map<string, AppSession> | undefined;
}

function getSessionStore() {
  globalThis.__webmailAuthSessionStore ??= new Map<string, AppSession>();
  return globalThis.__webmailAuthSessionStore;
}

function getExpiry(now: number) {
  return now + AUTH_SESSION_MAX_AGE_SECONDS * 1000;
}

function pruneExpiredSessions(now: number) {
  const sessionStore = getSessionStore();

  for (const [sessionId, session] of sessionStore) {
    if (session.expiresAt <= now) {
      sessionStore.delete(sessionId);
    }
  }
}

export function createAppSession(
  input: Pick<AppSession, 'accountCount' | 'authorizationHeader' | 'username'> & Partial<Pick<AppSession, 'testMode'>>,
  now = Date.now(),
) {
  pruneExpiredSessions(now);

  const session: AppSession = {
    ...input,
    createdAt: now,
    expiresAt: getExpiry(now),
    id: randomBytes(32).toString('hex'),
    testMode: input.testMode === true,
  };

  getSessionStore().set(session.id, session);
  return session;
}

export function getAppSessionById(sessionId?: string | null, options?: { now?: number; touch?: boolean }) {
  if (!isOpaqueSessionId(sessionId)) {
    return null;
  }

  const now = options?.now ?? Date.now();
  const touch = options?.touch ?? true;
  const sessionStore = getSessionStore();

  pruneExpiredSessions(now);

  const session = sessionStore.get(sessionId);

  if (!session) {
    return null;
  }

  if (touch) {
    const nextSession = { ...session, expiresAt: getExpiry(now) };
    sessionStore.set(sessionId, nextSession);
    return nextSession;
  }

  return session;
}

export function getAppSessionFromCookieValue(cookieValue?: string | null, options?: { now?: number; touch?: boolean }) {
  return getAppSessionById(cookieValue, options);
}

export function deleteAppSession(sessionId?: string | null) {
  if (!isOpaqueSessionId(sessionId)) {
    return false;
  }

  return getSessionStore().delete(sessionId);
}

export function toSafeSessionSummary(session: Pick<AppSession, 'accountCount' | 'expiresAt' | 'username'>): SafeSessionSummary {
  return {
    accountCount: session.accountCount,
    expiresAt: new Date(session.expiresAt).toISOString(),
    username: session.username,
  };
}

export function resetAuthSessionStoreForTests() {
  getSessionStore().clear();
}
