import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// proxy.ts must not read the client-sendable forwarded headers itself: the only
// reader is resolveExternalUrl(), which checks them against the configured hosts.
describe('proxy.ts', () => {
  const source = readFileSync(join(__dirname, '..', 'proxy.ts'), 'utf8');
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');

  it('hands the forwarded host and protocol to resolveExternalUrl', () => {
    expect(code).toContain("from '@/lib/auth/external-url'");
    expect(code).toContain('resolveExternalUrl(');
  });

  it('builds no redirect URL from a raw x-forwarded-host or x-forwarded-proto value', () => {
    const reads = [...code.matchAll(/headers\.get\('x-forwarded-(host|proto)'\)/g)];
    // Two reads feed the resolver, one gates the Location rewrite on the header's presence.
    expect(reads.length).toBeLessThanOrEqual(3);
    expect(code).not.toMatch(/x-forwarded-(host|proto)'\)\s*\?\?/);
  });

  it('sets no-store on signed-in pages and Clear-Site-Data on sign-out', () => {
    expect(code).toContain("'Cache-Control', NO_STORE");
    expect(code).toContain("response.headers.set('Clear-Site-Data'");
    expect(code).toContain("'/api/auth/signout'");
  });
});
