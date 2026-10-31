import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from './security-headers';

const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));

describe('SECURITY_HEADERS', () => {
  it('sends the default hardening headers', () => {
    expect(byKey['Strict-Transport-Security']).toMatch(/^max-age=\d{7,}/);
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it("limits framing through frame-ancestors without restricting scripts or styles", () => {
    expect(byKey['Content-Security-Policy']).toBe("frame-ancestors 'none'");
  });

  it('lists each header once', () => {
    expect(new Set(SECURITY_HEADERS.map((h) => h.key)).size).toBe(SECURITY_HEADERS.length);
  });
});
