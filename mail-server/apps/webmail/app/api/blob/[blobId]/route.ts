import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from '@/lib/auth/cookie';
import { deleteAppSession, getAppSessionFromCookieValue } from '@/lib/auth/store';
import { fetchUpstreamJmapSession } from '@/lib/auth/upstream';
import { selectAccountForCapability } from '@/lib/jmap/capabilities';

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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ blobId: string }> },
) {
  const sessionId = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = getAppSessionFromCookieValue(sessionId);

  if (!session) {
    return unauthorizedResponse(Boolean(sessionId));
  }

  const upstreamSession = await fetchUpstreamJmapSession(session.authorizationHeader);

  if (!upstreamSession.ok) {
    if (upstreamSession.unauthorized) {
      deleteAppSession(session.id);
      return unauthorizedResponse(true);
    }

    return NextResponse.json({ message: upstreamSession.message }, { status: upstreamSession.status });
  }

  const accountSelection = selectAccountForCapability(upstreamSession.jmap, 'blob');

  if (!accountSelection.ok) {
    return NextResponse.json({ message: '当前账号暂不支持附件访问。' }, { status: 404 });
  }

  const { blobId } = await context.params;
  const query = request.nextUrl.searchParams.toString();
  const pathname = `/api/jmap/download/${encodeURIComponent(accountSelection.account.id)}/${encodeURIComponent(blobId)}`;

  return NextResponse.redirect(`${request.nextUrl.origin}${pathname}${query.length > 0 ? `?${query}` : ''}`);
}
