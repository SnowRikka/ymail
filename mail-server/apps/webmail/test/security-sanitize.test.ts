import { describe, expect, it } from 'vitest';

import { sanitizeHtml } from '@/lib/sanitize/html';

describe('security-sanitize', () => {
  it('strips dangerous markup and blocks remote images by default', () => {
    const result = sanitizeHtml(
      '<div><script>alert(1)</script><img src="https://evil.example/pixel.png" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><form action="https://evil.example"><input></form><p>safe</p></div>',
    );

    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('onerror');
    expect(result.html).not.toContain('javascript:');
    expect(result.html).not.toContain('<form');
    expect(result.blockedRemoteImages).toBe(1);
    expect(result.html).toContain('data-remote-image-blocked="true"');
    expect(result.html).toContain('safe');
  });

  it('rewrites cid images and preserves safe links', () => {
    const result = sanitizeHtml('<p><img src="cid:chart@local"></p><a href="https://example.com/path">safe</a>', {
      cidMap: {
        'chart@local': '/api/jmap/download/account/blob',
      },
    });

    expect(result.html).toContain('src="/api/jmap/download/account/blob"');
    expect(result.html).toContain('href="https://example.com/path"');
    expect(result.html).toContain('rel="noopener noreferrer nofollow"');
  });
});
