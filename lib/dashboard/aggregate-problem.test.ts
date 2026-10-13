import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/authz', () => ({ getSessionUserIdOrThrow: vi.fn().mockResolvedValue('u1') }));
vi.mock('./aggregate-core', () => ({ aggregateForWidgetCore: vi.fn() }));

import { aggregateForWidget } from './aggregate';
import { aggregateForWidgetCore } from './aggregate-core';
import { AppError } from '@/lib/_errors';
import { WidgetProblemError } from './widget-problem';

const core = vi.mocked(aggregateForWidgetCore);

describe('aggregateForWidget (Server Action)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('wraps a successful aggregate', async () => {
    core.mockResolvedValue({ kind: 'single', data: [{ label: 'a', count: 1 }] });
    expect(await aggregateForWidget('task', 'status')).toEqual({ ok: true, output: { kind: 'single', data: [{ label: 'a', count: 1 }] } });
  });

  it('returns a typed problem as data instead of throwing it', async () => {
    const problem = { code: 'unknownField', setting: 'group_by_field', params: { entity: 'task', field: 'x' } } as const;
    core.mockRejectedValue(new WidgetProblemError(problem));
    expect(await aggregateForWidget('task', 'x')).toEqual({ ok: false, problem });
  });

  it('reports a refused read as the noPermission problem', async () => {
    core.mockRejectedValue(new AppError('PERMISSION_DENIED', 'no read'));
    expect(await aggregateForWidget('task', 'status')).toEqual({
      ok: false,
      problem: { code: 'noPermission', setting: 'entity_name', params: { entity: 'task' } },
    });
  });

  it('still throws an unexpected failure', async () => {
    core.mockRejectedValue(new Error('db down'));
    await expect(aggregateForWidget('task', 'status')).rejects.toThrow('db down');
  });
});
