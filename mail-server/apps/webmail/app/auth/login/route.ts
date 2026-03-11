import { NextResponse } from 'next/server';

import { AUTH_COOKIE_NAME, getAuthCookieOptions } from '@/lib/auth/cookie';
import { sanitizeNextPath } from '@/lib/auth/guard';
import { createAppSession, toSafeSessionSummary } from '@/lib/auth/store';
import { verifyUpstreamCredentials } from '@/lib/auth/upstream';

type LoginRequestBody = {
  next?: string;
  password?: string;
  username?: string;
};

export async function POST(request: Request) {
  let body: LoginRequestBody;

  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json({ message: '登录请求格式不正确。' }, { status: 400 });
  }

  const username = body.username?.trim();
  const password = body.password;

  if (!username || !password) {
    return NextResponse.json({ message: '请输入邮箱地址和密码。' }, { status: 400 });
  }

  const verified = await verifyUpstreamCredentials(username, password);

  if (!verified.ok) {
    return NextResponse.json({ message: verified.message }, { status: verified.status });
  }

  const session = createAppSession({
    accountCount: verified.accountCount,
    authorizationHeader: verified.authorizationHeader,
    username: verified.username,
  });

  const response = NextResponse.json({
    authenticated: true,
    redirectTo: sanitizeNextPath(body.next),
    session: toSafeSessionSummary(session),
  });

  response.cookies.set({
    ...getAuthCookieOptions(),
    name: AUTH_COOKIE_NAME,
    value: session.id,
  });

  return response;
}
