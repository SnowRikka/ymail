import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from '@/lib/auth/cookie';
import { deleteAppSession, getAppSessionFromCookieValue } from '@/lib/auth/store';
import { fetchUpstreamJmapSession } from '@/lib/auth/upstream';
import { buildBlobDownloadUrl } from '@/lib/jmap/session';

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

function sanitizeName(value: string | null) {
  if (!value) {
    return 'attachment';
  }

  return value.replace(/[\\/\r\n\t]+/g, '_').trim() || 'attachment';
}

function sanitizeType(value: string | null) {
  if (!value) {
    return 'application/octet-stream';
  }

  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value) ? value : 'application/octet-stream';
}

function buildDisposition(disposition: 'attachment' | 'inline', name: string) {
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ accountId: string; blobId: string }> },
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

  const { accountId, blobId } = await context.params;
  const name = sanitizeName(request.nextUrl.searchParams.get('name'));
  const type = sanitizeType(request.nextUrl.searchParams.get('type'));
  const forceDownload = request.nextUrl.searchParams.get('download') === '1';

  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(buildBlobDownloadUrl(upstreamSession.jmap.downloadUrl, accountId, blobId, { name, type }), {
      headers: {
        accept: '*/*',
        authorization: session.authorizationHeader,
      },
      method: 'GET',
    });
  } catch {
    return NextResponse.json({ message: '附件下载服务暂时不可用。' }, { status: 502 });
  }

  if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
    deleteAppSession(session.id);
    return unauthorizedResponse(true);
  }

  if (!upstreamResponse.ok) {
    return NextResponse.json({ message: '附件暂时不可访问。' }, { status: upstreamResponse.status });
  }

  const headers = new Headers();
  headers.set('cache-control', 'private, no-store');
  headers.set('content-disposition', buildDisposition(forceDownload ? 'attachment' : 'inline', name));
  headers.set('content-type', upstreamResponse.headers.get('content-type') ?? type);
  headers.set('x-content-type-options', 'nosniff');

  const contentLength = upstreamResponse.headers.get('content-length');
  if (contentLength) {
    headers.set('content-length', contentLength);
  }

  return new NextResponse(upstreamResponse.body, {
    headers,
    status: upstreamResponse.status,
  });
}
