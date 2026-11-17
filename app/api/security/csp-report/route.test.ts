import { beforeEach, describe, expect, it, vi } from 'vitest';

const { check, warn } = vi.hoisted(() => ({ check: vi.fn(), warn: vi.fn() }));

vi.mock('@/lib/rate-limit', () => ({ getRateLimiter: () => ({ check }) }));
vi.mock('@/lib/logger', () => ({ logger: { warn } }));

import { POST } from './route';

function post(body: string, headers: Record<string, string> = {}) {
  return POST(new Request('http://localhost/api/security/csp-report', { method: 'POST', body, headers }));
}

beforeEach(() => {
  check.mockReset();
  warn.mockReset();
  check.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

describe('POST /api/security/csp-report', () => {
  it('logs a stripped violation and answers 204', async () => {
    const res = await post(
      JSON.stringify({
        'csp-report': {
          'document-uri': 'https://app.example.com/en/x?email=a@b.c',
          'violated-directive': 'img-src',
          'blocked-uri': 'https://cdn.example.net/a.png?sig=secret',
          'script-sample': 'secret',
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[csp:violation]', {
      directive: 'img-src',
      blocked: 'https://cdn.example.net/a.png',
      page: 'https://app.example.com/en/x',
    });
  });

  it('answers 400 for a body that is not JSON and logs nothing', async () => {
    const res = await post('not json');
    expect(res.status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers 413 for an oversized body', async () => {
    const res = await post('x'.repeat(20_000));
    expect(res.status).toBe(413);
  });

  it('answers 429 with Retry-After when the rate limit is spent', async () => {
    check.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 });
    const res = await post('{}');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('7');
    expect(warn).not.toHaveBeenCalled();
  });
});
