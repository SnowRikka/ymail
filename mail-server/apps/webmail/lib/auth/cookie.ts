export const AUTH_COOKIE_NAME = 'webmail_session';
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

const AUTH_SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;

export function isOpaqueSessionId(value?: string | null): value is string {
  return typeof value === 'string' && AUTH_SESSION_ID_PATTERN.test(value);
}

export function getAuthCookieOptions() {
  return {
    httpOnly: true,
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export function getExpiredAuthCookieOptions() {
  return {
    ...getAuthCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  };
}
