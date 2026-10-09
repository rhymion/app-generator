import { describe, it, expect } from 'vitest';
import {
  EMPTY_LIST_QUERY,
  countActiveFilters,
  cycleSort,
  filterChoices,
  setFilterValue,
  toListQuery,
  type ListQuerySpec,
} from './_list_query';

const spec: ListQuerySpec = {
  fields: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'qty', label: 'Quantity', kind: 'number' },
    { key: 'status', label: 'Status', kind: 'enum', options: ['open', 'closed'], optionLabels: { open: 'Open' } },
    { key: 'active', label: 'Active', kind: 'boolean' },
    { key: 'created_at', label: 'Created', kind: 'date' },
  ],
  sortKeys: ['name', 'qty', 'status', 'created_at'],
  filterKeys: ['name', 'qty', 'status', 'active'],
  searchKey: 'name',
};

describe('cycleSort', () => {
  it('steps one column through ascending, descending and off', () => {
    const asc = cycleSort([], 'name', true);
    expect(asc).toEqual([{ field: 'name', dir: 'asc' }]);
    const desc = cycleSort(asc, 'name', true);
    expect(desc).toEqual([{ field: 'name', dir: 'desc' }]);
    expect(cycleSort(desc, 'name', true)).toEqual([]);
  });

  it('keeps several sort columns in the order they were added', () => {
    let sort = cycleSort([], 'qty', true);
    sort = cycleSort(sort, 'name', true);
    expect(sort).toEqual([
      { field: 'qty', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
    sort = cycleSort(sort, 'qty', true);
    expect(sort).toEqual([
      { field: 'qty', dir: 'desc' },
      { field: 'name', dir: 'asc' },
    ]);
    sort = cycleSort(sort, 'qty', true);
    expect(sort).toEqual([{ field: 'name', dir: 'asc' }]);
  });

  it('replaces the other sort columns when not in multi mode', () => {
    const sort = cycleSort([{ field: 'qty', dir: 'desc' }], 'name', false);
    expect(sort).toEqual([{ field: 'name', dir: 'asc' }]);
    expect(cycleSort(sort, 'name', false)).toEqual([{ field: 'name', dir: 'desc' }]);
    expect(cycleSort([{ field: 'name', dir: 'desc' }], 'name', false)).toEqual([]);
  });

  it('does not change the sort it was given', () => {
    const before = [{ field: 'qty', dir: 'asc' as const }];
    cycleSort(before, 'qty', true);
    expect(before).toEqual([{ field: 'qty', dir: 'asc' }]);
  });
});

describe('filters', () => {
  it('sets and clears a field', () => {
    const one = setFilterValue({}, 'name', 'bolt');
    const two = setFilterValue(one, 'qty', '5');
    expect(two).toEqual({ name: 'bolt', qty: '5' });
    expect(countActiveFilters(two)).toBe(2);
    expect(setFilterValue(two, 'name', '')).toEqual({ qty: '5' });
    expect(one).toEqual({ name: 'bolt' });
  });
});

describe('toListQuery', () => {
  it('turns an empty state into an unfiltered, unsorted request', () => {
    expect(toListQuery(EMPTY_LIST_QUERY, spec)).toEqual({ sort: [], filter: {} });
  });

  it('keeps every filtered field at once', () => {
    const query = toListQuery(
      { search: '', sort: [], filters: { name: 'bolt', qty: '5', status: 'open', active: 'true' } },
      spec,
    );
    expect(query.filter).toEqual({ name: 'bolt', qty: '5', status: 'open', active: 'true' });
  });

  it('sends the search text through the search column', () => {
    expect(toListQuery({ search: '  nut ', sort: [], filters: { qty: '5' } }, spec).filter).toEqual({
      qty: '5',
      name: 'nut',
    });
  });

  it('lets the search text win over a filter on the search column', () => {
    expect(toListQuery({ search: 'nut', sort: [], filters: { name: 'bolt' } }, spec).filter).toEqual({ name: 'nut' });
  });

  it('has no search when the entity has no search column', () => {
    expect(toListQuery({ search: 'nut', sort: [], filters: {} }, { ...spec, searchKey: null }).filter).toEqual({});
  });

  it('drops blank filters and fields the entity does not offer', () => {
    const query = toListQuery(
      {
        search: '',
        sort: [
          { field: 'qty', dir: 'desc' },
          { field: 'secret', dir: 'asc' },
        ],
        filters: { name: '', created_at: '2026-01-01', ghost: 'x' },
      },
      spec,
    );
    expect(query).toEqual({ sort: [{ field: 'qty', dir: 'desc' }], filter: {} });
  });

  it('keeps the sort priority order', () => {
    const sort = [
      { field: 'status', dir: 'asc' as const },
      { field: 'qty', dir: 'desc' as const },
    ];
    expect(toListQuery({ search: '', sort, filters: {} }, spec).sort).toEqual(sort);
  });
});

describe('filterChoices', () => {
  it('lists enum members with their labels', () => {
    expect(filterChoices(spec.fields[2])).toEqual([
      { value: 'open', label: 'Open' },
      { value: 'closed', label: 'closed' },
    ]);
  });

  it('names the two answers of a boolean', () => {
    expect(filterChoices(spec.fields[3], (value) => (value ? 'Yes' : 'No'))).toEqual([
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ]);
  });

  it('is null for a free-text field', () => {
    expect(filterChoices(spec.fields[0])).toBeNull();
    expect(filterChoices(spec.fields[1])).toBeNull();
  });
});
