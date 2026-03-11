import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from '@/lib/auth/cookie';
import { getAppSessionFromCookieValue, deleteAppSession, toSafeSessionSummary } from '@/lib/auth/store';
import { fetchUpstreamJmapSession } from '@/lib/auth/upstream';
import type { AuthSessionResponse } from '@/lib/auth/types';
import { createPlaywrightTestJmapSession, isPlaywrightTestSession } from '@/lib/jmap/playwright-test-mode';

export async function GET(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = getAppSessionFromCookieValue(cookieValue);

  if (!session) {
    const response = NextResponse.json({ authenticated: false });

    if (cookieValue) {
      response.cookies.set({
        ...getExpiredAuthCookieOptions(),
        name: AUTH_COOKIE_NAME,
        value: '',
      });
    }

    return response;
  }

  if (isPlaywrightTestSession(session)) {
    return NextResponse.json<AuthSessionResponse>({
      authenticated: true,
      jmap: createPlaywrightTestJmapSession(session.username),
      session: toSafeSessionSummary(session),
    });
  }

  const upstreamSession = await fetchUpstreamJmapSession(session.authorizationHeader);

  if (!upstreamSession.ok) {
    if (upstreamSession.unauthorized) {
      deleteAppSession(session.id);

      const response = NextResponse.json<AuthSessionResponse>({ authenticated: false });
      response.cookies.set({
        ...getExpiredAuthCookieOptions(),
        name: AUTH_COOKIE_NAME,
        value: '',
      });
      return response;
    }

    return NextResponse.json({ message: upstreamSession.message }, { status: upstreamSession.status });
  }

  return NextResponse.json<AuthSessionResponse>({
    authenticated: true,
    jmap: upstreamSession.jmap,
    session: toSafeSessionSummary(session),
  });
}
