import { describe, it, expect } from 'vitest';
import { formatSlowQueryLog } from './prisma-slow-query';

describe('formatSlowQueryLog', () => {
  it('does not contain raw bound values for a sensitive-column query', () => {
    const line = formatSlowQueryLog({
      duration: 120,
      query: 'SELECT "id" FROM "user" WHERE "email" = $1 AND "password_hash" = $2',
      params: '["alice@example.com","$2b$10$secrethashvalue"]',
    });
    expect(line).not.toContain('alice@example.com');
    expect(line).not.toContain('secrethashvalue');
    expect(line).toContain('$1');
    expect(line).toContain('params=[2 redacted]');
  });

  it('does not echo an unparseable params string', () => {
    const line = formatSlowQueryLog({ duration: 60, query: 'SELECT 1', params: 'raw-secret' });
    expect(line).not.toContain('raw-secret');
    expect(line).toContain('params=[0 redacted]');
  });
});
