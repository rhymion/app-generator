# List Search Panel: Multi-Column Sort, Multi-Field Filter and Search

## What this covers

Every generated entity list (`/{entity}`) has a panel above the grid (Desktop Web) or the cards
(Mobile Web) with:

- **Search.** A search box that matches the list's title column.
- **Sort.** A sort panel with every sortable column. A tap on a column cycles ascending, descending
  and off. Several columns can be sorted at once; the order they were chosen in is their priority
  (the chip shows `↑ 1`, `↓ 2`, …).
- **Filter.** A filter panel with a control for every text, number, decimal, boolean and enum column
  and for each relation display column: a text box, or a chip per enum member or *Yes* / *No*.
  Every filtered field applies at once (AND). *Clear* resets the filters.

The panel is one hand-written component for every entity, `components/_standard/ListQueryPanel.tsx`.
It is not generated per entity: what it offers comes from a small spec the list page passes in.

This is the Web side of the same panel the Expo list has (see
[mobile-app.md](mobile-app.md#list-sort-filter-search-and-bulk-delete)); the two share their logic
(below). The panel does not change what the REST list accepts. Every scalar column can still be
sorted and filtered; narrowing the set is a separate piece of work.

## Why not the grid's own filter panel

`@mui/x-data-grid` (the MIT build) forces `disableMultipleColumnsFiltering` and
`disableMultipleColumnsSorting`, so its own header menu sorts and filters one column at a time. The
server never had that limit: `parsePageOpts()` reads `sort=a:asc,b:desc` and one `f.<field>=` per
field, `buildOrderBy()` makes one `orderBy` entry per sort item and `buildFilter()` ANDs one clause
per filter field (`lib/_pagination.ts`). The panel drives those parameters; it adds no dependency
and no `x-*` key.

## Shared logic: `lib/_list_query.ts`

Pure TypeScript (no React, DOM, `next/*` or UI library, and no imports at all). The Expo app gets a
byte-for-byte copy in `mobile/lib/_list_query.ts`, the same way it gets `submit_predicate.ts`
([shared-ui-hooks.md](shared-ui-hooks.md)). It holds everything the Web and the native panel must
agree on:

| Export | Meaning |
|---|---|
| `ListQuerySpec` | What one entity's panel offers: `fields` (`key`, `label`, `kind`, enum `options` and `optionLabels`), `sortKeys`, `filterKeys`, `searchKey` |
| `ListQueryState` | What the user entered: `search`, `sort` (priority order), `filters` (text per field key) |
| `cycleSort(sort, key, multi)` | Ascending, then descending, then off. With `multi` the column joins the other sort columns; without it, it replaces them (the native list sorts one column at a time) |
| `setFilterValue`, `countActiveFilters` | Set or clear one field's filter, count the filtered fields |
| `toListQuery(state, spec)` | The REST list request: `{ sort, filter }`. Sort columns and filters the spec does not offer are dropped. The search text goes through `filter[searchKey]`; when that column also has a filter, the search text wins |
| `filterChoices(field, booleanLabel)` | The fixed choices of an enum or boolean field, or `null` for free text |

`lib/_list_query.test.ts` covers the module. `code_generator/tests/test_list_query_panel.py` checks
that the Expo copy is identical and that the native list builds its request through it.

## The spec: generated per list page

`page_list_context()` (`generators.py`, `_list_query_code()`) builds the `listQuery` prop from the
same data `getters.ts` renders `SORTABLE_FIELDS`, `FILTERABLE_FIELDS`, `FIELD_KINDS` and
`RELATION_FILTER_FIELDS` from (`sort_filter_fields`, `sort_filter_field_kinds`,
`sort_filter_relation_fields`, `sort_filter_enum_members`), so the panel offers exactly what the
list accepts:

- A `string` column is `text`; `enum`, `boolean`, `number` and `decimal` keep their kind; a `date`
  column (also `date-time` and `time`) is sort-only.
- Record id columns (`id`, `creator_id`, `assignee_id`) and foreign key columns are left out. A
  foreign key's relation display column (the ones `RELATION_FILTER_FIELDS` lists) is offered as a
  `text` column that sorts and filters by the related record's label.
- `label` is `Fields.<camelCase key>` when the translation exists and the title-cased column name
  otherwise.
- An enum column also carries `optionLabels` when the list translates its members for display.
- `searchKey` is the primary column when it is text, else the first displayed text column, else the
  first text column; an entity with no text column has no search box.

## How the Web lists use it

`ResponsiveListClient` passes `listQuery` to the layout it picks: `DataGridClient` above 768px,
`CardListClient` below. Both show the panel only when `listQuery` is set and the list is
server-paged (`fetchPage`); a list without it behaves as before.

- A change to the search, the sort or a filter queries again from the first page. Text typed into the
  search box or a filter box waits 300 ms (`LIST_QUERY_DEBOUNCE_MS`) for the typing to pause; a
  click (sort, choice, clear) applies at once.
- **Desktop grid.** The grid keeps its header sort and its own filter menu. The panel owns the sort:
  the grid shows the first panel sort column it has a column for, and a click on a column header
  replaces the whole sort with that one column. Filters from the panel and from the grid's menu apply
  together; on a field both filter, the grid's filter wins.
- **Cards.** The cards have no header, so the panel is the only way to sort and filter them.

## Tests

- `lib/_list_query.test.ts` — the shared logic.
- `components/_standard/ListQueryPanel.test.tsx` — the panel: several sort columns and their order,
  several filtered fields, enum labels, clearing, debounced typing.
- `components/_standard/ResponsiveListClient.listQuery.test.tsx` — the request each layout sends
  (desktop and phone-sized viewport), and a header click replacing the panel sort.
- `code_generator/tests/test_list_query_panel.py` — the generated spec, the clients' wiring and the
  Expo copy.
- `cypress/e2e/list_query_panel.cy.ts` (desktop) and `cypress/e2e/mobile/list_query_panel.cy.ts`
  (375px viewport) — search, multi-field filter, multi-column sort and their combination against the
  `role` list, plus the header click on the grid. The existing generated filter/sort specs and
  `list_filter_sort_relation_column.cy.ts` run unchanged against the grid's own header controls.
