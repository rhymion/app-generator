import { afterEach, describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

const h = (init: Record<string, string>) => new Headers(init);

describe('clientIp', () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  it('ignores client-supplied left-most X-Forwarded-For entries (default: one trusted hop)', () => {
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('returns the only entry when the platform overwrites the header', () => {
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('does not let rotating a spoofed prefix change the key', () => {
    const a = clientIp(h({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }));
    const b = clientIp(h({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3, 203.0.113.9' }));
    expect(a).toBe(b);
  });

  it('honours TRUSTED_PROXY_HOPS for deployments with more trusted proxies', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('falls back to the left-most entry when the list is shorter than the hop count', () => {
    process.env.TRUSTED_PROXY_HOPS = '3';
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('ignores an invalid TRUSTED_PROXY_HOPS value', () => {
    process.env.TRUSTED_PROXY_HOPS = 'abc';
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('uses x-real-ip only when there is no X-Forwarded-For', () => {
    expect(clientIp(h({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIp(h({}))).toBe('unknown');
  });

  // One case per documented deployment shape (docs/knowledge/authentication.md,
  // "Trusted proxy rule"). Every case sends a forged left-most entry and must
  // still key on the address the platform recorded.
  describe.each([
    {
      platform: 'Vercel (the edge overwrites X-Forwarded-For with the peer address)',
      hops: undefined,
      header: '203.0.113.9',
      forged: '6.6.6.6, 203.0.113.9',
      expected: '203.0.113.9',
    },
    {
      platform: 'Cloud Run (the front end appends the peer address)',
      hops: undefined,
      header: '6.6.6.6, 203.0.113.9',
      forged: '1.1.1.1, 2.2.2.2, 6.6.6.6, 203.0.113.9',
      expected: '203.0.113.9',
    },
    {
      platform: 'Cloud Run behind an external HTTPS load balancer (two trusted hops)',
      hops: '2',
      header: '6.6.6.6, 203.0.113.9, 35.191.0.1',
      forged: '1.1.1.1, 6.6.6.6, 203.0.113.9, 35.191.0.1',
      expected: '203.0.113.9',
    },
  ])('$platform', ({ hops, header, forged, expected }) => {
    it('keys on the address the platform recorded', () => {
      if (hops) process.env.TRUSTED_PROXY_HOPS = hops;
      expect(clientIp(h({ 'x-forwarded-for': header }))).toBe(expected);
    });

    it('is not moved by extra forged entries on the left', () => {
      if (hops) process.env.TRUSTED_PROXY_HOPS = hops;
      expect(clientIp(h({ 'x-forwarded-for': forged }))).toBe(expected);
    });

    it('ignores a forged X-Real-IP when X-Forwarded-For is present', () => {
      if (hops) process.env.TRUSTED_PROXY_HOPS = hops;
      expect(clientIp(h({ 'x-forwarded-for': header, 'x-real-ip': '9.9.9.9' }))).toBe(expected);
    });
  });
});
