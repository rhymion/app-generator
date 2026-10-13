import { describe, it, expect } from 'vitest';
import { diffChildRows, fieldChanged, wordDiff, type ChildSpec } from './_version_diff';

const spec = (over: Partial<ChildSpec>): ChildSpec => ({
  property_name: 'lines', title_key: 'lines', fields: ['note'], match: 'none', key_fields: [], ...over,
});

describe('wordDiff', () => {
  it('marks added and removed words and keeps the rest', () => {
    const parts = wordDiff('the quick fox', 'the slow fox');
    expect(parts.filter((p) => p.kind === 'removed').map((p) => p.text)).toEqual(['quick']);
    expect(parts.filter((p) => p.kind === 'added').map((p) => p.text)).toEqual(['slow']);
    expect(parts.map((p) => p.text).join('')).toContain('the ');
  });
  it('returns a single same part for equal text', () => {
    expect(wordDiff('a b', 'a b')).toEqual([{ text: 'a b', kind: 'same' }]);
  });
});

describe('fieldChanged', () => {
  it('treats null and undefined as equal', () => {
    expect(fieldChanged({ a: null }, {}, 'a')).toBe(false);
    expect(fieldChanged({ a: 1 }, { a: 2 }, 'a')).toBe(true);
  });
});

describe('diffChildRows', () => {
  it('pairs rows by natural key', () => {
    const d = diffChildRows(
      [{ sku: 'a', note: 'x' }, { sku: 'b', note: 'y' }],
      [{ sku: 'b', note: 'z' }, { sku: 'c', note: 'w' }],
      spec({ match: 'key', key_fields: ['sku'] }),
    );
    expect(d.map((r) => r.status)).toEqual(['removed', 'changed', 'added']);
    expect(d[1].changedFields).toEqual(['note']);
  });
  it('pairs rows by position under order', () => {
    const d = diffChildRows(
      [{ order: 2, note: 'b' }, { order: 1, note: 'a' }],
      [{ order: 1, note: 'a' }, { order: 2, note: 'c' }, { order: 3, note: 'd' }],
      spec({ match: 'order' }),
    );
    expect(d.map((r) => r.status)).toEqual(['unchanged', 'changed', 'added']);
  });
  it('reports additions and removals only when rows cannot be matched', () => {
    const d = diffChildRows([{ note: 'a' }], [{ note: 'a' }], spec({ match: 'none' }));
    expect(d.map((r) => r.status)).toEqual(['removed', 'added']);
  });
});
