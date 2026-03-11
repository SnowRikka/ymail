import { NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getAuthCookieOptions } from '@/lib/auth/cookie';
import { createAppSession } from '@/lib/auth/store';
import { isPlaywrightTestEnabled } from '@/lib/jmap/playwright-test-mode';

type SessionRequestBody = {
  accountCount?: number;
  username?: string;
};

export async function POST(request: Request) {
  if (!isPlaywrightTestEnabled()) {
    return NextResponse.json({ message: 'Not found.' }, { status: 404 });
  }

  const body = ((await request.json().catch(() => ({}))) as SessionRequestBody) ?? {};
  const session = createAppSession({
    accountCount: body.accountCount ?? 1,
    authorizationHeader: 'Basic cGxheXdyaWdodDpwbGF5d3JpZ2h0',
    testMode: true,
    username: body.username?.trim() || 'playwright@example.com',
  });

  const response = NextResponse.json({ authenticated: true });

  response.cookies.set({
    ...getAuthCookieOptions(),
    name: AUTH_COOKIE_NAME,
    value: session.id,
  });

  return response;
}
