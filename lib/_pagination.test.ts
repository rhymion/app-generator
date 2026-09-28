import { describe, expect, it } from 'vitest';

import { buildFilter, buildOrderBy } from './_pagination';

/**
 * Per-kind × operator coverage for buildFilter/buildOrderBy's clause-shape
 * dispatch (app-generator#753/#755/#756/cmd_1200(a)). This is the layer
 * every real crash in that lineage lived in (a pure function, no schema/
 * entity/browser needed) -- see docs/knowledge/list-filter-sort-typed-
 * columns.md's operator table, which this file exercises directly.
 */

describe('buildFilter', () => {
  describe('enum kind', () => {
    const kinds = { status: 'enum' as const };
    const enumMembers = { status: ['OPEN', 'CLOSED'] };

    it('defaults to equals for a bare value', () => {
      expect(buildFilter({ status: 'OPEN' }, new Set(['status']), kinds, {}, enumMembers)).toEqual([
        { status: 'OPEN' },
      ]);
    });

    it('applies not', () => {
      expect(
        buildFilter({ status: { operator: 'not', value: 'OPEN' } }, new Set(['status']), kinds, {}, enumMembers),
      ).toEqual([{ status: { not: { equals: 'OPEN' } } }]);
    });

    it('applies isAnyOf as an in-list', () => {
      expect(
        buildFilter(
          { status: { operator: 'isAnyOf', value: ['OPEN', 'CLOSED'] } },
          new Set(['status']),
          kinds,
          {},
          enumMembers,
        ),
      ).toEqual([{ status: { in: ['OPEN', 'CLOSED'] } }]);
    });

    it('drops a value that is not a real enum member (#756 Finding 3 -- e.g. a translated display label)', () => {
      expect(
        buildFilter({ status: 'Open (translated)' }, new Set(['status']), kinds, {}, enumMembers),
      ).toEqual([]);
    });

    it('filters isAnyOf down to only the valid members, dropping invalid ones', () => {
      expect(
        buildFilter(
          { status: { operator: 'isAnyOf', value: ['OPEN', 'bogus'] } },
          new Set(['status']),
          kinds,
          {},
          enumMembers,
        ),
      ).toEqual([{ status: { in: ['OPEN'] } }]);
    });

    it('drops the clause entirely when isAnyOf has no valid members left', () => {
      expect(
        buildFilter(
          { status: { operator: 'isAnyOf', value: ['bogus'] } },
          new Set(['status']),
          kinds,
          {},
          enumMembers,
        ),
      ).toEqual([]);
    });
  });

  describe('boolean kind (#756 Finding 2)', () => {
    const kinds = { is_active: 'boolean' as const };

    it('coerces the string "true" (the plain text filter box input) to a real boolean', () => {
      expect(buildFilter({ is_active: 'true' }, new Set(['is_active']), kinds)).toEqual([
        { is_active: true },
      ]);
    });

    it('coerces the string "false" to a real boolean', () => {
      expect(buildFilter({ is_active: 'false' }, new Set(['is_active']), kinds)).toEqual([
        { is_active: false },
      ]);
    });

    it('accepts a real boolean value unchanged', () => {
      expect(buildFilter({ is_active: true }, new Set(['is_active']), kinds)).toEqual([
        { is_active: true },
      ]);
    });
  });

  describe('number kind', () => {
    const kinds = { priority: 'number' as const };

    it('defaults to an exact equals for a bare value', () => {
      expect(buildFilter({ priority: 5 }, new Set(['priority']), kinds)).toEqual([{ priority: 5 }]);
    });

    it.each([
      ['!=', { not: { equals: 5 } }],
      ['>', { gt: 5 }],
      ['>=', { gte: 5 }],
      ['<', { lt: 5 }],
      ['<=', { lte: 5 }],
    ] as const)('applies operator %s', (operator, expected) => {
      expect(
        buildFilter({ priority: { operator, value: 5 } }, new Set(['priority']), kinds),
      ).toEqual([{ priority: expected }]);
    });

    it('drops the clause for a non-numeric value (NaN-guarded) rather than crashing', () => {
      expect(buildFilter({ priority: 'not-a-number' }, new Set(['priority']), kinds)).toEqual([]);
    });
  });

  describe('decimal kind (#756: JS-number IEEE-754 re-quantization)', () => {
    const kinds = { unit_price: 'decimal' as const };
    const decimalScales = { unit_price: 2 };

    it('re-quantizes a JS-number value that lost precision through the browser number input', () => {
      // 99.99 typed into <input type="number"> round-trips through IEEE-754
      // as 99.98999999999999488... -- toFixed(2) recovers the exact string.
      const imprecise = 99.99;
      expect(
        buildFilter({ unit_price: imprecise }, new Set(['unit_price']), kinds, {}, {}, decimalScales),
      ).toEqual([{ unit_price: '99.99' }]);
    });

    it('leaves a string value untouched (REST caller via parsePageOpts never went through the number input)', () => {
      expect(
        buildFilter({ unit_price: '99.99' }, new Set(['unit_price']), kinds, {}, {}, decimalScales),
      ).toEqual([{ unit_price: '99.99' }]);
    });

    it.each([
      ['!=', { not: { equals: '10.00' } }],
      ['>', { gt: '10.00' }],
      ['>=', { gte: '10.00' }],
      ['<', { lt: '10.00' }],
      ['<=', { lte: '10.00' }],
    ] as const)('applies operator %s after re-quantizing', (operator, expected) => {
      expect(
        buildFilter(
          { unit_price: { operator, value: 10 } },
          new Set(['unit_price']),
          kinds,
          {},
          {},
          decimalScales,
        ),
      ).toEqual([{ unit_price: expected }]);
    });

    it('drops the clause for an empty value', () => {
      expect(buildFilter({ unit_price: '' }, new Set(['unit_price']), kinds, {}, {}, decimalScales)).toEqual(
        [],
      );
    });
  });

  describe('date kind (covers format: date / date-time / time -- all three dispatch through this same clause shape)', () => {
    const kinds = { due_at: 'date' as const };
    const d = new Date('2026-01-15T00:00:00.000Z');

    it('defaults to an exact equals for a bare value', () => {
      expect(buildFilter({ due_at: d.toISOString() }, new Set(['due_at']), kinds)).toEqual([
        { due_at: d },
      ]);
    });

    it.each([
      ['not', { not: { equals: d } }],
      ['after', { gt: d }],
      ['onOrAfter', { gte: d }],
      ['before', { lt: d }],
      ['onOrBefore', { lte: d }],
    ] as const)('applies operator %s', (operator, expected) => {
      expect(
        buildFilter({ due_at: { operator, value: d.toISOString() } }, new Set(['due_at']), kinds),
      ).toEqual([{ due_at: expected }]);
    });

    it('drops the clause for an unparseable date rather than crashing (#753 crash class)', () => {
      expect(buildFilter({ due_at: 'not-a-date' }, new Set(['due_at']), kinds)).toEqual([]);
    });
  });

  describe('string kind (default)', () => {
    it('defaults to a case-insensitive contains when no kind is given for the column', () => {
      expect(buildFilter({ name: 'foo' }, new Set(['name']))).toEqual([
        { name: { contains: 'foo', mode: 'insensitive' } },
      ]);
    });

    it.each([
      ['equals', { equals: 'foo', mode: 'insensitive' }],
      ['startsWith', { startsWith: 'foo', mode: 'insensitive' }],
      ['endsWith', { endsWith: 'foo', mode: 'insensitive' }],
    ] as const)('applies operator %s', (operator, expected) => {
      expect(
        buildFilter({ name: { operator, value: 'foo' } }, new Set(['name']), { name: 'string' }),
      ).toEqual([{ name: expected }]);
    });

    it('applies isAnyOf as an in-list', () => {
      expect(
        buildFilter(
          { name: { operator: 'isAnyOf', value: ['foo', 'bar'] } },
          new Set(['name']),
          { name: 'string' },
        ),
      ).toEqual([{ name: { in: ['foo', 'bar'] } }]);
    });
  });

  describe('cross-cutting behavior (independent of kind)', () => {
    it('drops a field outside the allow-list', () => {
      expect(buildFilter({ secret: 'x' }, new Set(['name']))).toEqual([]);
    });

    it('drops an empty-string value', () => {
      expect(buildFilter({ name: '' }, new Set(['name']))).toEqual([]);
    });

    it('drops a null value', () => {
      expect(buildFilter({ name: null }, new Set(['name']))).toEqual([]);
    });

    it('drops an empty-array value', () => {
      expect(buildFilter({ name: { operator: 'isAnyOf', value: [] } }, new Set(['name']))).toEqual([]);
    });

    it('filters a relation (FK labelField) column via a nested contains, ignoring the operator/kinds/allow-list', () => {
      const relations = { assignee: { field: 'name' } };
      expect(
        buildFilter(
          { assignee: { operator: 'is', value: 'Ann' } },
          new Set([]),
          {},
          relations,
        ),
      ).toEqual([{ assignee: { name: { contains: 'Ann', mode: 'insensitive' } } }]);
    });

    it('returns an empty array when filter is undefined', () => {
      expect(buildFilter(undefined, new Set(['name']))).toEqual([]);
    });
  });
});

describe('buildOrderBy', () => {
  it('defaults to id asc when sort is empty or undefined', () => {
    expect(buildOrderBy(undefined, new Set(['name']))).toEqual([{ id: 'asc' }]);
    expect(buildOrderBy([], new Set(['name']))).toEqual([{ id: 'asc' }]);
  });

  it('sorts by an allowed field in the requested direction', () => {
    expect(buildOrderBy([{ field: 'name', dir: 'desc' }], new Set(['name']))).toEqual([
      { name: 'desc' },
    ]);
  });

  it('drops a field outside the allow-list (and not a relation)', () => {
    expect(buildOrderBy([{ field: 'secret', dir: 'asc' }], new Set(['name']))).toEqual([
      { id: 'asc' },
    ]);
  });

  it('sorts a relation display column by the related row\'s labelField via a nested one-hop orderBy', () => {
    const relations = { assignee: { field: 'name' } };
    expect(buildOrderBy([{ field: 'assignee', dir: 'asc' }], new Set([]), relations)).toEqual([
      { assignee: { name: 'asc' } },
    ]);
  });

  it('keeps only allow-listed/relation fields when mixed with disallowed ones, preserving order', () => {
    const relations = { assignee: { field: 'name' } };
    expect(
      buildOrderBy(
        [
          { field: 'secret', dir: 'asc' },
          { field: 'name', dir: 'desc' },
          { field: 'assignee', dir: 'asc' },
        ],
        new Set(['name']),
        relations,
      ),
    ).toEqual([{ name: 'desc' }, { assignee: { name: 'asc' } }]);
  });
});
