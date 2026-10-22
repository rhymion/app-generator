import { describe, it, expect, vi } from 'vitest';

const catalog = vi.hoisted(() => [
  {
    name: 'task',
    label: 'Task',
    groupable_fields: [
      { name: 'status', label: 'Status', kind: 'enum', enum_values: ['open', 'closed'] },
      { name: 'points', label: 'Points', kind: 'number' },
      { name: 'created_at', label: 'Created at', kind: 'datetime', datetime_format: 'date-time' },
    ],
  },
]);

// The generated catalog is absent on a clean checkout; the rules under test only need its shape.
vi.mock('./catalog', () => ({
  DASHBOARDABLE_ENTITIES: catalog,
  findDashboardEntity: (name: string) => catalog.find((e) => e.name === name),
  findDashboardField: (entity: string, field: string) =>
    catalog.find((e) => e.name === entity)?.groupable_fields.find((f) => f.name === field),
}));
const groupBy = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/prisma', () => ({ default: { task: { groupBy: (...a: unknown[]) => groupBy(...a), findMany: vi.fn().mockResolvedValue([]) } } }));

vi.mock('@/lib/api-auth', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
// Permission and row scope are covered by aggregate.test.ts; here the request is allowed.
vi.mock('./access-where', () => ({
  requireDashboardReadScope: vi.fn().mockResolvedValue([]),
  tryDashboardReadScope: vi.fn().mockResolvedValue([]),
  combineWhere: (_access: unknown, where: unknown) => where,
}));

import { aggregateForWidgetCore } from './aggregate-core';
import { WidgetProblemError } from './widget-problem';

async function problemOf(...args: Parameters<typeof aggregateForWidgetCore> extends [string, ...infer R] ? [...R] : never) {
  const error = await aggregateForWidgetCore('u1', ...args).then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(WidgetProblemError);
  return (error as WidgetProblemError).problem;
}

describe('aggregateForWidgetCore problems', () => {
  it('a data source that is not in the catalog', async () => {
    expect(await problemOf('gone', 'status')).toMatchObject({ code: 'dataSourceUnavailable', params: { entity: 'gone' } });
  });

  it('an unknown group-by field', async () => {
    expect(await problemOf('task', 'removed')).toMatchObject({ code: 'unknownField', setting: 'group_by_field', params: { field: 'removed' } });
  });

  it('an unknown series field', async () => {
    expect(await problemOf('task', 'status', null, 'removed')).toMatchObject({ code: 'unknownField', setting: 'series_field' });
  });

  it('an unknown filter field, on the legacy filter and on a typed condition', async () => {
    expect(await problemOf('task', 'status', { field: 'removed', value: 'x' })).toMatchObject({ code: 'unknownField', setting: 'filter_field' });
    expect(await problemOf('task', 'status', null, undefined, [{ field: 'removed', operator: 'equals', values: ['x'] }]))
      .toMatchObject({ code: 'unknownField', setting: 'filter_field', params: { field: 'removed' } });
  });

  it('a time bucket on a field that is not a date or time', async () => {
    expect(await problemOf('task', 'status', null, undefined, undefined, 'month')).toMatchObject({ code: 'bucketNeedsDatetime', params: { field: 'status', kind: 'enum' } });
  });

  it('a time zone on a field that is not a date-time', async () => {
    expect(await problemOf('task', 'status', null, undefined, undefined, undefined, 'asia_tokyo')).toMatchObject({ code: 'timezoneNeedsDatetime' });
  });

  it('a filter value that does not fit the filtered field', async () => {
    expect(await problemOf('task', 'status', { field: 'points', value: 'many' })).toMatchObject({ code: 'invalidFilterValue', params: { field: 'points', kind: 'number' } });
  });

  it('no matching data is not a problem', async () => {
    await expect(aggregateForWidgetCore('u1', 'task', 'status')).resolves.toEqual({ kind: 'single', data: [] });
  });
});
