// @vitest-environment node
// The server path of lib/logger.ts (no `window`): one JSON line per call (Issue #1323).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

describe('logger (server)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)('logger.%s writes one redacted JSON line to console.%s', (level) => {
    const spy = vi.spyOn(console, level).mockImplementation(() => {});
    logger[level]('[tag] for a@b.com', { password: 'p', id: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(1);
    const rec = JSON.parse(String(spy.mock.calls[0][0]));
    expect(rec).toMatchObject({ level, message: '[tag] for [REDACTED:email]', context: { password: '[REDACTED]', id: 1 } });
    expect(Number.isNaN(Date.parse(rec.timestamp))).toBe(false);
  });

  it('writes the plain redacted arguments with LOG_FORMAT=text', () => {
    vi.stubEnv('LOG_FORMAT', 'text');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('[tag] a@b.com', { secret: 's' });
    expect(spy.mock.calls[0]).toEqual(['[tag] [REDACTED:email]', { secret: '[REDACTED]' }]);
  });
});
