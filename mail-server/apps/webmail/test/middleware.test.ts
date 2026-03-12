import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';

function createRequest(url: string, headers?: HeadersInit) {
  return new NextRequest(url, headers ? { headers } : undefined);
}

describe('middleware redirect handling', () => {
  it('uses host and forwarded proto for unauthenticated inbox redirects behind a proxy', () => {
    const response = middleware(
      createRequest('http://localhost:3014/mail/inbox', {
        host: 'mail.example.com',
        'x-forwarded-proto': 'https',
      }),
    );

    expect(response.headers.get('location')).toBe('https://mail.example.com/login?next=%2Fmail%2Finbox');
  });

  it('redirects unauthenticated mailbox requests with forwarded public origin headers', () => {
    const response = middleware(
      createRequest('http://localhost:3014/mail/inbox', {
        host: 'localhost:3014',
        'x-forwarded-host': 'mail.example.com',
        'x-forwarded-proto': 'https',
      }),
    );

    expect(response.headers.get('location')).toBe('https://mail.example.com/login?next=%2Fmail%2Finbox');
  });

  it('preserves sanitized next targets for the /mail index', () => {
    const response = middleware(createRequest('http://localhost:3014/mail', { host: 'mail.example.com' }));

    expect(response.headers.get('location')).toBe('http://mail.example.com/login?next=%2Fmail');
  });

  it('keeps the request origin when no public host headers are available', () => {
    const response = middleware(createRequest('http://localhost:3014/mail/inbox'));

    expect(response.headers.get('location')).toBe('http://localhost:3014/login?next=%2Fmail%2Finbox');
  });
});
