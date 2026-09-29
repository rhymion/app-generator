import { describe, it, expect, vi } from 'vitest';
import {
  isDue,
  runAll,
  runAllExitCode,
  runOneExitCode,
  topologicalOrder,
  type RunAllDeps,
} from './run-all';
import type { ScheduledTaskResult } from './run-guard';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('topologicalOrder', () => {
  it('orders a chain by dependency, not declaration order', () => {
    expect(topologicalOrder({ c: ['b'], b: ['a'], a: [] })).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties between independent tasks by declaration order', () => {
    expect(topologicalOrder({ x: [], y: [], z: ['x'] })).toEqual(['x', 'y', 'z']);
    expect(topologicalOrder({ y: [], x: [], z: ['x'] })).toEqual(['y', 'x', 'z']);
  });

  it('ignores predecessors that are not declared tasks', () => {
    expect(topologicalOrder({ a: ['ghost'] })).toEqual(['a']);
  });

  it('throws on a cycle', () => {
    expect(() => topologicalOrder({ a: ['b'], b: ['a'] })).toThrow(/cycle/i);
  });
});

describe('isDue', () => {
  it('is always due without an interval', () => {
    expect(isDue(null, d('2026-09-28'), d('2026-09-29'))).toBe(true);
  });

  it('is due on the first night, whatever the interval says', () => {
    expect(isDue('45 21 1 * *', null, d('2026-09-29'))).toBe(true);
  });

  it('a daily cron is due every night regardless of its minute/hour', () => {
    expect(isDue('30 21 * * *', d('2026-09-28'), d('2026-09-29'))).toBe(true);
    expect(isDue('0 0 * * *', d('2026-09-28'), d('2026-09-29'))).toBe(true);
  });

  it('a weekly (Monday) task is not due mid-week and is due the next Monday', () => {
    // 2026-09-28 is a Monday.
    expect(isDue('30 21 * * 1', d('2026-09-28'), d('2026-09-29'))).toBe(false);
    expect(isDue('30 21 * * 1', d('2026-09-28'), d('2026-10-04'))).toBe(false);
    expect(isDue('30 21 * * 1', d('2026-09-28'), d('2026-10-05'))).toBe(true);
  });

  it('a monthly (1st) task becomes due on the 1st', () => {
    expect(isDue('45 21 1 * *', d('2026-09-01'), d('2026-09-30'))).toBe(false);
    expect(isDue('45 21 1 * *', d('2026-09-01'), d('2026-10-01'))).toBe(true);
  });

  it('is still due on a later night after a missed occurrence (catch-up)', () => {
    expect(isDue('45 21 1 * *', d('2026-09-01'), d('2026-10-03'))).toBe(true);
  });

  it('a long stop is due once — only the last success is consulted', () => {
    // Three missed Mondays: due (one catch-up run); after it succeeds, not due again.
    expect(isDue('30 21 * * 1', d('2026-09-07'), d('2026-09-29'))).toBe(true);
    expect(isDue('30 21 * * 1', d('2026-09-29'), d('2026-09-30'))).toBe(false);
  });
});

function fixture(over: Partial<RunAllDeps> & { outcomes?: Record<string, ScheduledTaskResult['outcome']> } = {}) {
  const outcomes = over.outcomes ?? {};
  const ran: string[] = [];
  const recordNotDue = vi.fn(async () => {});
  const deps: RunAllDeps = {
    dependencies: { a: [], b: ['a'], c: ['b'], side: [] },
    intervals: {},
    businessDate: d('2026-09-29'),
    lastSucceededBusinessDate: async () => null,
    recordNotDue,
    runTask: async (taskId) => {
      ran.push(taskId);
      const outcome = outcomes[taskId] ?? 'succeeded';
      return {
        taskId,
        businessDate: d('2026-09-29'),
        outcome,
        ...(outcome === 'failed' ? { error: new Error('boom') } : {}),
        ...(outcome === 'blocked' ? { blockedBy: ['b'] } : {}),
      };
    },
    ...over,
  };
  return { deps, ran, recordNotDue };
}

describe('runAll', () => {
  it('runs every task in dependency order', async () => {
    const { deps, ran } = fixture();
    const entries = await runAll(deps);
    expect(ran).toEqual(['a', 'b', 'c', 'side']);
    expect(runAllExitCode(entries)).toBe(0);
  });

  it('a failure does not stop unrelated branches; the downstream task is reported blocked', async () => {
    const { deps, ran } = fixture({ outcomes: { a: 'failed', b: 'blocked', c: 'blocked' } });
    const entries = await runAll(deps);
    expect(ran).toEqual(['a', 'b', 'c', 'side']);
    expect(entries.map((e) => e.outcome)).toEqual(['failed', 'blocked', 'blocked', 'succeeded']);
    expect(runAllExitCode(entries)).toBe(1);
  });

  it('records a not-due task, does not run it, and does not set the exit code', async () => {
    const { deps, ran, recordNotDue } = fixture({
      dependencies: { daily: [], weekly: [] },
      intervals: { daily: '0 17 * * *', weekly: '30 21 * * 1' },
      lastSucceededBusinessDate: async () => d('2026-09-28'),
    });
    const entries = await runAll(deps);
    expect(ran).toEqual(['daily']);
    expect(recordNotDue).toHaveBeenCalledExactlyOnceWith('weekly');
    expect(entries.map((e) => e.outcome)).toEqual(['succeeded', 'not_due']);
    expect(runAllExitCode(entries)).toBe(0);
  });

  it('a task with an interval that never succeeded runs unconditionally on its first night', async () => {
    const { deps, ran, recordNotDue } = fixture({
      dependencies: { monthly: [] },
      intervals: { monthly: '45 21 1 * *' },
    });
    await runAll(deps);
    expect(ran).toEqual(['monthly']);
    expect(recordNotDue).not.toHaveBeenCalled();
  });

  it('a task already succeeded tonight goes to the guard (which reports it), not to not_due', async () => {
    const { deps, ran, recordNotDue } = fixture({
      dependencies: { weekly: [] },
      intervals: { weekly: '30 21 * * 1' },
      lastSucceededBusinessDate: async () => d('2026-09-29'),
      outcomes: { weekly: 'already_succeeded' },
    });
    const entries = await runAll(deps);
    expect(ran).toEqual(['weekly']);
    expect(recordNotDue).not.toHaveBeenCalled();
    expect(entries[0].outcome).toBe('already_succeeded');
    expect(runAllExitCode(entries)).toBe(0);
  });
});

describe('exit codes', () => {
  it('task:run: 0 succeeded/already succeeded, 1 handler threw, 2 blocked', () => {
    expect(runOneExitCode('succeeded')).toBe(0);
    expect(runOneExitCode('already_succeeded')).toBe(0);
    expect(runOneExitCode('failed')).toBe(1);
    expect(runOneExitCode('blocked')).toBe(2);
    expect(runOneExitCode('already_running')).toBe(2);
  });
});
