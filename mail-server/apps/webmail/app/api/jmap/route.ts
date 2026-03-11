import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from '@/lib/auth/cookie';
import { deleteAppSession, getAppSessionFromCookieValue } from '@/lib/auth/store';
import { getUpstreamJmapUrl } from '@/lib/auth/upstream';
import { createPlaywrightTestJmapResponse, isPlaywrightTestSession } from '@/lib/jmap/playwright-test-mode';

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

export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = getAppSessionFromCookieValue(sessionId);

  if (!session) {
    return unauthorizedResponse(Boolean(sessionId));
  }

  if (isPlaywrightTestSession(session)) {
    return NextResponse.json(createPlaywrightTestJmapResponse({ body: await request.text(), username: session.username }));
  }

  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(getUpstreamJmapUrl(), {
      body: await request.text(),
      headers: {
        accept: 'application/json',
        authorization: session.authorizationHeader,
        'content-type': request.headers.get('content-type') ?? 'application/json',
      },
      method: 'POST',
    });
  } catch {
    return NextResponse.json({ message: '邮箱数据服务暂时不可用。' }, { status: 502 });
  }

  if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
    deleteAppSession(session.id);
    return unauthorizedResponse(true);
  }

  return new NextResponse(await upstreamResponse.text(), {
    headers: {
      'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
    },
    status: upstreamResponse.status,
  });
}
