import { describe, it, expect } from 'vitest';
import {
  allowedActions,
  buildTaskRows,
  formatBusinessDate,
  httpStatusForActionCode,
  isStuck,
  parseBusinessDate,
  positiveIntOr,
  toRunRowJson,
  type RunRecord,
} from './admin-view';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const now = new Date('2026-09-30T12:00:00.000Z');

function record(over: Partial<RunRecord> & Pick<RunRecord, 'task_id' | 'status'>): RunRecord {
  return {
    id: `id_${over.task_id}`,
    business_date: d('2026-09-30'),
    started_at: new Date('2026-09-30T11:59:00.000Z'),
    finished_at: null,
    error_message: null,
    ...over,
  };
}

const deps = { a: [], b: ['a'], c: ['b'], side: [] as string[] };
const intervals = { a: '0 3 * * *', b: null, c: null, side: null };

function rows(records: RunRecord[], stuckAfterMinutes = 60) {
  return buildTaskRows({ dependencies: deps, intervals, records, businessDate: d('2026-09-30'), now, stuckAfterMinutes });
}
const statusOf = (r: ReturnType<typeof rows>) => Object.fromEntries(r.map((x) => [x.taskId, x.status]));

describe('buildTaskRows', () => {
  it('lists every declared task in declaration order, including those with no record', () => {
    const r = rows([]);
    expect(r.map((x) => x.taskId)).toEqual(['a', 'b', 'c', 'side']);
    expect(r.every((x) => x.recordId === null)).toBe(true);
  });

  it('a task with no record and no predecessors is pending; one behind an unmet predecessor is blocked by name', () => {
    const r = rows([]);
    expect(statusOf(r)).toEqual({ a: 'pending', b: 'blocked', c: 'blocked', side: 'pending' });
    expect(r.find((x) => x.taskId === 'b')?.blockedBy).toEqual(['a']);
  });

  it('a succeeded or not_due predecessor releases its successor', () => {
    expect(statusOf(rows([record({ task_id: 'a', status: 'succeeded' })])).b).toBe('pending');
    expect(statusOf(rows([record({ task_id: 'a', status: 'not_due' })])).b).toBe('pending');
    expect(statusOf(rows([record({ task_id: 'a', status: 'failed' })])).b).toBe('blocked');
  });

  it('carries the recorded error message and times through for a failed record', () => {
    const finished = new Date('2026-09-30T11:59:30.000Z');
    const [a] = rows([record({ task_id: 'a', status: 'failed', error_message: 'boom', finished_at: finished })]);
    expect(a).toMatchObject({ status: 'failed', errorMessage: 'boom', finishedAt: finished, recordId: 'id_a' });
  });

  it('a running record older than the threshold shows as stuck, a fresh one as running', () => {
    const old = new Date('2026-09-30T10:00:00.000Z');
    expect(statusOf(rows([record({ task_id: 'a', status: 'running', started_at: old })])).a).toBe('stuck');
    expect(statusOf(rows([record({ task_id: 'a', status: 'running' })])).a).toBe('running');
  });

  it('ignores records of other business dates', () => {
    const r = rows([record({ task_id: 'a', status: 'succeeded', business_date: d('2026-09-29') })]);
    expect(statusOf(r).a).toBe('pending');
  });

  it('exposes the declared interval', () => {
    expect(rows([]).find((x) => x.taskId === 'a')?.interval).toBe('0 3 * * *');
    expect(rows([]).find((x) => x.taskId === 'b')?.interval).toBeNull();
  });
});

describe('allowedActions', () => {
  it('opens nothing for a succeeded or fresh running row', () => {
    expect(allowedActions('succeeded')).toEqual({ rerun: false, resolve: false, skip: false });
    expect(allowedActions('running')).toEqual({ rerun: false, resolve: false, skip: false });
  });
  it('opens all three for a failed or stuck row', () => {
    expect(allowedActions('failed')).toEqual({ rerun: true, resolve: true, skip: true });
    expect(allowedActions('stuck')).toEqual({ rerun: true, resolve: true, skip: true });
  });
  it('offers rerun and skip, but not resolve, where there is no failure to resolve', () => {
    for (const s of ['not_due', 'blocked', 'pending'] as const) {
      expect(allowedActions(s)).toEqual({ rerun: true, resolve: false, skip: true });
    }
  });
});

describe('isStuck / positiveIntOr / date helpers', () => {
  it('isStuck is strictly greater-than the threshold and only for running', () => {
    const start = new Date('2026-09-30T11:00:00.000Z');
    expect(isStuck({ status: 'running', started_at: start }, now, 60)).toBe(false);
    expect(isStuck({ status: 'running', started_at: start }, now, 59)).toBe(true);
    expect(isStuck({ status: 'failed', started_at: start }, now, 1)).toBe(false);
  });
  it('positiveIntOr falls back for null, zero, negatives and non-integers', () => {
    expect(positiveIntOr(15, 60)).toBe(15);
    for (const bad of [null, undefined, 0, -3, 1.5]) expect(positiveIntOr(bad, 60)).toBe(60);
  });
  it('parseBusinessDate accepts real dates only', () => {
    expect(parseBusinessDate('2026-09-30')).toEqual(d('2026-09-30'));
    for (const bad of [undefined, '', '2026-9-30', '2026-02-30', 'tomorrow']) expect(parseBusinessDate(bad)).toBeNull();
    expect(formatBusinessDate(d('2026-09-30'))).toBe('2026-09-30');
  });
});

describe('toRunRowJson', () => {
  it('serializes a row with snake_case keys and ISO timestamps', () => {
    const [row] = buildTaskRows({
      dependencies: { a: [] },
      intervals: { a: '0 3 * * *' },
      records: [
        {
          id: 'r1',
          task_id: 'a',
          business_date: d('2026-09-30'),
          status: 'failed',
          started_at: new Date('2026-09-30T03:00:00.000Z'),
          finished_at: new Date('2026-09-30T03:00:05.000Z'),
          error_message: 'boom',
        },
      ],
      businessDate: d('2026-09-30'),
      now: new Date('2026-09-30T12:00:00.000Z'),
      stuckAfterMinutes: 60,
    });
    expect(toRunRowJson(row)).toEqual({
      task_id: 'a',
      business_date: '2026-09-30',
      status: 'failed',
      started_at: '2026-09-30T03:00:00.000Z',
      finished_at: '2026-09-30T03:00:05.000Z',
      message: 'boom',
      blocked_by: [],
      interval: '0 3 * * *',
      actions: { rerun: true, resolve: true, skip: true },
    });
  });
  it('serializes a task with no record with null times and message', () => {
    const [row] = buildTaskRows({
      dependencies: { a: ['b'], b: [] },
      intervals: { a: null, b: null },
      records: [],
      businessDate: d('2026-09-30'),
      now: new Date('2026-09-30T12:00:00.000Z'),
      stuckAfterMinutes: 60,
    });
    expect(toRunRowJson(row)).toMatchObject({
      task_id: 'a',
      status: 'blocked',
      started_at: null,
      finished_at: null,
      message: null,
      blocked_by: ['b'],
      interval: null,
    });
  });
});

describe('httpStatusForActionCode', () => {
  it('maps every action result code to a status', () => {
    expect(httpStatusForActionCode('FORBIDDEN')).toBe(403);
    expect(httpStatusForActionCode('BAD_INPUT')).toBe(400);
    expect(httpStatusForActionCode('REASON_REQUIRED')).toBe(400);
    expect(httpStatusForActionCode('UNKNOWN_TASK')).toBe(404);
    for (const code of ['NOT_ALLOWED', 'BLOCKED', 'RUNNING']) expect(httpStatusForActionCode(code)).toBe(409);
    for (const code of ['FAILED', 'NO_ACTOR']) expect(httpStatusForActionCode(code)).toBe(500);
  });
});
