import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from '@/lib/auth/cookie';
import { deleteAppSession } from '@/lib/auth/store';

export async function POST(request: NextRequest) {
  deleteAppSession(request.cookies.get(AUTH_COOKIE_NAME)?.value);

  const response = NextResponse.json({ authenticated: false });
  response.cookies.set({
    ...getExpiredAuthCookieOptions(),
    name: AUTH_COOKIE_NAME,
    value: '',
  });

  return response;
}
