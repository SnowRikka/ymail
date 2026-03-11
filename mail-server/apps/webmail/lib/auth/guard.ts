export const DEFAULT_AFTER_LOGIN_PATH = '/mail/inbox';

export function isProtectedMailboxPath(pathname: string) {
  return pathname === '/mail' || pathname.startsWith('/mail/');
}

export function sanitizeNextPath(pathname?: string | null) {
  return pathname && isProtectedMailboxPath(pathname) ? pathname : DEFAULT_AFTER_LOGIN_PATH;
}

export function toLoginRedirect(pathname: string) {
  const params = new URLSearchParams({ next: sanitizeNextPath(pathname) });
  return `/login?${params.toString()}`;
}
