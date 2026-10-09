// The state and query logic of the entity list's sort / filter / search panel.
//
// Pure TypeScript: no React, no DOM, no `next/*`, no UI library. Every client of the REST list
// renders its own panel (MUI on the Web, React Native in the Expo app) over this module, so the
// three surfaces cannot diverge on what a sort, a filter or the search box means. The Expo app
// copies this file into `mobile/lib/` unchanged.
//
// The query a panel produces is the REST list's own: `sort=<field>:<dir>,...` and one
// `f.<field>=<value>` per filtered field, which `parsePageOpts` (lib/_pagination.ts) reads.

export type SortItem = { field: string; dir: 'asc' | 'desc' };

/** One column the panel can sort or filter on. */
export interface ListFieldSpec {
  key: string;
  label: string;
  /** `text`, `number`, `decimal`, `boolean` or `enum` get a filter control; any other kind is sort-only. */
  kind: string;
  /** Members of an `enum` column. */
  options?: string[];
  /** Display label per enum member; a member without an entry shows as itself. */
  optionLabels?: Record<string, string>;
}

/** What one entity's panel offers; generated per entity from the REST list's own allow-list. */
export interface ListQuerySpec {
  fields: ListFieldSpec[];
  /** Keys the REST list can sort on. */
  sortKeys: string[];
  /** Keys the REST list can filter on with a control (text, number, decimal, boolean, enum). */
  filterKeys: string[];
  /** The column the search box matches (the list's title column), or null for no search box. */
  searchKey: string | null;
}

/** What the user has entered in the panel. */
export interface ListQueryState {
  search: string;
  /** Sort columns in priority order: the first item is the primary sort. */
  sort: SortItem[];
  /** Filter text per field key; an empty string means "not filtered". */
  filters: Record<string, string>;
}

/** The part of a REST list request that the panel decides. */
export interface ListQuery {
  sort: SortItem[];
  filter: Record<string, string>;
}

export const EMPTY_LIST_QUERY: ListQueryState = { search: '', sort: [], filters: {} };

/**
 * Advances a column's sort by one step: ascending, then descending, then off.
 * With `multi`, the column joins the other sort columns (a newly sorted column goes last);
 * without it, sorting a column replaces any other sort column.
 */
export function cycleSort(sort: SortItem[], key: string, multi: boolean): SortItem[] {
  const current = sort.find((item) => item.field === key);
  if (!multi) {
    return !current ? [{ field: key, dir: 'asc' }] : current.dir === 'asc' ? [{ field: key, dir: 'desc' }] : [];
  }
  if (!current) return [...sort, { field: key, dir: 'asc' }];
  if (current.dir === 'asc') return sort.map((item) => (item.field === key ? { field: key, dir: 'desc' } : item));
  return sort.filter((item) => item.field !== key);
}

/** Returns the filters with one field's text replaced; an empty text removes the field. */
export function setFilterValue(filters: Record<string, string>, key: string, value: string): Record<string, string> {
  const next = { ...filters };
  if (value === '') delete next[key];
  else next[key] = value;
  return next;
}

/** How many fields are filtered. */
export function countActiveFilters(filters: Record<string, string>): number {
  return Object.values(filters).filter((value) => value !== '').length;
}

/**
 * The REST list request for a panel state. Sort columns and filters the entity does not offer are
 * dropped. The search text narrows by the spec's search column through the same `f.<field>`
 * parameter a filter uses; when that column also has a filter, the search text wins.
 */
export function toListQuery(state: ListQueryState, spec: ListQuerySpec): ListQuery {
  const filter: Record<string, string> = {};
  for (const [key, value] of Object.entries(state.filters)) {
    if (value !== '' && spec.filterKeys.includes(key)) filter[key] = value;
  }
  const search = state.search.trim();
  if (spec.searchKey && search !== '') filter[spec.searchKey] = search;
  return { sort: state.sort.filter((item) => spec.sortKeys.includes(item.field)), filter };
}

/** A choice of a filter control: the filter text sent to the REST list, and what the user sees. */
export interface FilterChoice {
  value: string;
  label: string;
}

/**
 * The fixed choices of an `enum` or `boolean` field, or null when the field takes free text.
 * `booleanLabel` names a boolean's two answers (the raw `true` / `false` by default).
 */
export function filterChoices(
  field: ListFieldSpec,
  booleanLabel: (value: boolean) => string = (value) => String(value),
): FilterChoice[] | null {
  if (field.kind === 'enum') {
    return (field.options ?? []).map((option) => ({ value: option, label: field.optionLabels?.[option] ?? option }));
  }
  if (field.kind === 'boolean') {
    return [
      { value: 'true', label: booleanLabel(true) },
      { value: 'false', label: booleanLabel(false) },
    ];
  }
  return null;
}

/** The arrow shown next to a sorted column. */
export function sortArrow(dir: 'asc' | 'desc'): string {
  return dir === 'asc' ? '↑' : '↓';
}
