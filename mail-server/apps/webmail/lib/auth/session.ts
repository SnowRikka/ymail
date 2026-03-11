import { cookies } from 'next/headers';

import { AUTH_COOKIE_NAME } from '@/lib/auth/cookie';
import { getAppSessionFromCookieValue, toSafeSessionSummary } from '@/lib/auth/store';

export async function getServerSession() {
  const cookieStore = await cookies();
  return getAppSessionFromCookieValue(cookieStore.get(AUTH_COOKIE_NAME)?.value);
}

export async function getServerSessionSummary() {
  const session = await getServerSession();
  return session ? toSafeSessionSummary(session) : null;
}

export async function hasServerSession() {
  return Boolean(await getServerSession());
}
