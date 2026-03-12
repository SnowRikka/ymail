import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, isOpaqueSessionId } from '@/lib/auth/cookie';
import { isProtectedMailboxPath, sanitizeNextPath } from '@/lib/auth/guard';

function readHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || null;
}

function toProtocol(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.endsWith(':') ? value.slice(0, -1) : value;
  return normalized === 'http' || normalized === 'https' ? normalized : null;
}

function getPublicOrigin(request: NextRequest) {
  const host = readHeaderValue(request.headers.get('x-forwarded-host')) ?? readHeaderValue(request.headers.get('host'));
  const protocol = toProtocol(readHeaderValue(request.headers.get('x-forwarded-proto'))) ?? toProtocol(request.nextUrl.protocol);

  if (!host || !protocol) {
    return request.nextUrl.origin;
  }

  return `${protocol}://${host}`;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedMailboxPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (isOpaqueSessionId(sessionCookie)) {
    return NextResponse.next();
  }

  const redirectUrl = new URL('/login', getPublicOrigin(request));
  redirectUrl.search = new URLSearchParams({ next: sanitizeNextPath(pathname) }).toString();
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ['/mail/:path*'],
};
