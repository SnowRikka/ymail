import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from '@/lib/auth/cookie';
import { deleteAppSession, getAppSessionFromCookieValue } from '@/lib/auth/store';
import { fetchUpstreamJmapSession } from '@/lib/auth/upstream';

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

function buildUploadUrl(template: string, accountId: string) {
  return template.replace(/\{accountId\}/g, encodeURIComponent(accountId));
}

function readFileName(request: NextRequest) {
  const encoded = request.headers.get('x-file-name');

  if (!encoded) {
    return null;
  }

  try {
    const value = decodeURIComponent(encoded);
    return value.replace(/[\r\n]+/g, ' ').trim() || null;
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ accountId: string }> },
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

  const { accountId } = await context.params;

  let body: ArrayBuffer;

  try {
    body = await request.arrayBuffer();
  } catch {
    return NextResponse.json({ message: '附件读取失败，请重试。' }, { status: 400 });
  }

  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(buildUploadUrl(upstreamSession.jmap.uploadUrl, accountId), {
      body,
      headers: {
        accept: 'application/json',
        authorization: session.authorizationHeader,
        'content-length': String(body.byteLength),
        'content-type': request.headers.get('content-type') ?? 'application/octet-stream',
        ...(readFileName(request) ? { 'x-file-name': readFileName(request) as string } : {}),
      },
      method: 'POST',
    });
  } catch {
    return NextResponse.json({ message: '附件上传服务暂时不可用。' }, { status: 502 });
  }

  if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
    deleteAppSession(session.id);
    return unauthorizedResponse(true);
  }

  const text = await upstreamResponse.text();

  return new NextResponse(text, {
    headers: {
      'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
    },
    status: upstreamResponse.status,
  });
}
