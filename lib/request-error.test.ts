import { beforeEach, describe, expect, it, vi } from 'vitest';

const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('./logger', () => ({ logger: { error } }));

import { logRequestError } from './request-error';

describe('logRequestError', () => {
  beforeEach(() => error.mockClear());

  it('logs name, digest and location without the error message or stack', () => {
    const err = Object.assign(new TypeError('relation "user" column "api_key_hash" does not exist'), {
      digest: 'abc123',
    });
    logRequestError(err, { path: '/api/orders/7?token=secret#frag', method: 'GET' }, {
      routerKind: 'App Router',
      routePath: '/api/orders/[id]',
      routeType: 'route',
    });

    expect(error).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(error.mock.calls[0]);
    expect(serialized).not.toContain('api_key_hash');
    expect(serialized).not.toContain('does not exist');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('stack');
    expect(error.mock.calls[0][1]).toEqual({
      name: 'TypeError',
      digest: 'abc123',
      method: 'GET',
      path: '/api/orders/7',
      routerKind: 'App Router',
      routePath: '/api/orders/[id]',
      routeType: 'route',
    });
  });

  it('tolerates a thrown non-Error value', () => {
    logRequestError('boom: secret detail', { path: '/x', method: 'POST' }, {});
    expect(JSON.stringify(error.mock.calls[0])).not.toContain('secret detail');
    expect(error.mock.calls[0][1]).toMatchObject({ name: 'Error', path: '/x' });
  });
});
