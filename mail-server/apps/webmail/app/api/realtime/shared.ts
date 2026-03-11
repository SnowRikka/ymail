import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from '@/lib/auth/cookie';
import { deleteAppSession, getAppSessionFromCookieValue } from '@/lib/auth/store';
import { fetchUpstreamJmapSession } from '@/lib/auth/upstream';
import { createPlaywrightTestJmapSession, isPlaywrightTestSession } from '@/lib/jmap/playwright-test-mode';
import type { JmapCapabilityState, JmapSessionResource } from '@/lib/jmap/types';

export const REALTIME_STREAM_PATH = '/api/realtime/stream';

type AppSession = NonNullable<ReturnType<typeof getAppSessionFromCookieValue>>;

type RealtimeSessionResult =
  | {
      readonly ok: false;
      readonly response: NextResponse;
    }
  | {
      readonly jmapSession: JmapSessionResource;
      readonly ok: true;
      readonly session: AppSession;
    };

export type RealtimeRouteDescriptor = {
  readonly capability: JmapCapabilityState<'websocket'>;
  readonly eventSourceUrl: string;
  readonly mode: 'event-source' | 'none';
  readonly websocketUrl: null;
};

export function unauthorizedResponse(clearCookie: boolean) {
  const response = NextResponse.json({ message: '登录状态已失效，请重新登录。' }, { status: 401 });

  if (clearCookie) {
    response.cookies.set({
      ...getExpiredAuthCookieOptions(),
      name: AUTH_COOKIE_NAME,
      value: '',
    });
  }

  return response;
}

export function createRealtimeRouteDescriptor(capability: JmapCapabilityState<'websocket'>): RealtimeRouteDescriptor {
  if (!capability.supported) {
    return {
      capability,
      eventSourceUrl: '',
      mode: 'none',
      websocketUrl: null,
    };
  }

  return {
    capability,
    eventSourceUrl: REALTIME_STREAM_PATH,
    mode: 'event-source',
    websocketUrl: null,
  };
}

export async function resolveRealtimeSession(request: NextRequest): Promise<RealtimeSessionResult> {
  const sessionId = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = getAppSessionFromCookieValue(sessionId);

  if (!session) {
    return {
      ok: false,
      response: unauthorizedResponse(Boolean(sessionId)),
    };
  }

  if (isPlaywrightTestSession(session)) {
    return {
      jmapSession: createPlaywrightTestJmapSession(session.username),
      ok: true,
      session,
    };
  }

  const upstreamSession = await fetchUpstreamJmapSession(session.authorizationHeader);

  if (!upstreamSession.ok) {
    if (upstreamSession.unauthorized) {
      deleteAppSession(session.id);
      return {
        ok: false,
        response: unauthorizedResponse(true),
      };
    }

    return {
      ok: false,
      response: NextResponse.json({ message: upstreamSession.message }, { status: upstreamSession.status }),
    };
  }

  return {
    jmapSession: upstreamSession.jmap,
    ok: true,
    session,
  };
}
