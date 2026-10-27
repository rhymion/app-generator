import bcrypt from 'bcryptjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyPassword } from './password-check';

describe('verifyPassword', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await bcrypt.hash('s3cret-pw', 10);
    expect(await verifyPassword('s3cret-pw', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it.each([null, undefined, ''])('still runs one bcrypt comparison and returns false when the hash is %j', async (hash) => {
    const spy = vi.spyOn(bcrypt, 'compare');
    expect(await verifyPassword('anything', hash)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('runs exactly one comparison for a stored hash too', async () => {
    const hash = await bcrypt.hash('pw', 10);
    const spy = vi.spyOn(bcrypt, 'compare');
    await verifyPassword('nope', hash);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
