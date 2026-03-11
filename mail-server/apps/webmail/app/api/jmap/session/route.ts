import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from '@/lib/auth/cookie';
import { deleteAppSession, getAppSessionFromCookieValue } from '@/lib/auth/store';
import { fetchUpstreamJmapSession } from '@/lib/auth/upstream';
import { createPlaywrightTestJmapSession, isPlaywrightTestSession } from '@/lib/jmap/playwright-test-mode';

function unauthorizedResponse(clearCookie: boolean) {
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

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = getAppSessionFromCookieValue(sessionId);

  if (!session) {
    return unauthorizedResponse(Boolean(sessionId));
  }

  if (isPlaywrightTestSession(session)) {
    return NextResponse.json(createPlaywrightTestJmapSession(session.username));
  }

  const upstreamSession = await fetchUpstreamJmapSession(session.authorizationHeader);

  if (!upstreamSession.ok) {
    if (upstreamSession.unauthorized) {
      deleteAppSession(session.id);
      return unauthorizedResponse(true);
    }

    return NextResponse.json({ message: upstreamSession.message }, { status: upstreamSession.status });
  }

  return NextResponse.json(upstreamSession.jmap);
}
