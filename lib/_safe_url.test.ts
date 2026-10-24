import { describe, it, expect } from 'vitest';

import { isSafeUrl } from './_safe_url';

describe('isSafeUrl', () => {
  it.each([
    '/uploads/a.png',
    'http://example.com/a.png',
    'https://example.com/a.png?x=1',
  ])('accepts %s', (v) => {
    expect(isSafeUrl(v)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/a.png',
    '/\\evil.example/a.png',
    'httpx://example.com',
    'http:evil',
    'https://exa mple.com',
    'http://example.com/\n',
    'a.png',
    '',
  ])('rejects %j', (v) => {
    expect(isSafeUrl(v)).toBe(false);
  });

  it.each([null, undefined, 42, {}, new File([], 'a.png')])('rejects non-string %#', (v) => {
    expect(isSafeUrl(v)).toBe(false);
  });
});
