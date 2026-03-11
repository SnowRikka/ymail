import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, isOpaqueSessionId } from '@/lib/auth/cookie';
import { isProtectedMailboxPath, toLoginRedirect } from '@/lib/auth/guard';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedMailboxPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (isOpaqueSessionId(sessionCookie)) {
    return NextResponse.next();
  }

  const redirectUrl = new URL(toLoginRedirect(pathname), request.url);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ['/mail/:path*'],
};
