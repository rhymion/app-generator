import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'cookie-user' } })),
}));

import { getActorOverride, runAsActor } from './_request_scope';
import { getSessionUserId, getSessionUserIdOrThrow } from './authz';

describe('runAsActor', () => {
  it('has no actor outside a run', () => {
    expect(getActorOverride()).toBeUndefined();
  });

  it('makes the session lookup resolve to the actor inside the run, across awaits', async () => {
    const seen = await runAsActor('token-user', async () => {
      await Promise.resolve();
      return [await getSessionUserId(), await getSessionUserIdOrThrow()];
    });
    expect(seen).toEqual(['token-user', 'token-user']);
  });

  it('falls back to the session cookie outside the run and after it ends', async () => {
    expect(await getSessionUserId()).toBe('cookie-user');
    await runAsActor('token-user', async () => undefined);
    expect(await getSessionUserId()).toBe('cookie-user');
  });

  it('keeps concurrent runs apart', async () => {
    const [a, b] = await Promise.all([
      runAsActor('user-a', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getSessionUserId();
      }),
      runAsActor('user-b', async () => getSessionUserId()),
    ]);
    expect([a, b]).toEqual(['user-a', 'user-b']);
  });
});
