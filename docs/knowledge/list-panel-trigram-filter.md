# List Panel Trigram Search: `x-trigram-filter`

The list search box ([list-search-panel.md](list-search-panel.md)) sends `?search=<text>` and the REST list matches it, case-insensitively, as a
substring of any search column.

The match is `COALESCE(col, '') ILIKE '%text%'`. The text is bound as a
parameter with `\`, `%` and `_` escaped. A text filter on a search column uses the same match.
Text is sent as typed, of any length: a 1-2 character term has no trigram to look up, so the index
cannot narrow it and the planner scans the table, as it does without the index.

Which columns are searched:

1. An entity that is a cross-entity search target (`x-generator.search.default_scope`,
   `x-generate.search`; an `x-audit` entity is excluded unless it opts in, see [search.md](search.md))
   searches the columns of its search trigram index: the union of `text_fields` and `bigm_fields`
   (`x-search.text_fields` when given, else the derived text columns). It has a search box by default
   and no new index: the box shares the `idx_<table>_<column>_gin_trgm_v2` indexes of the search.
2. `x-trigram-filter` on a column under the entity's `fields:` overrides that. `true` adds the
   column, also on an entity that is not a search target, and gives that column its own `_v2` index.
   `false` removes the column from the search box (the cross-entity search still reads it and
   keeps its index).
3. An entity that is not a search target and declares nothing has no search box and no index.

`x-trigram-filter` is a boolean on a text column (a string column that is not an id, foreign key,
enum, date/time/uri, Decimal or write-only column); `validate.py` rejects any other type or a
`true` on another kind of column. Like `x-pii` and `x-mention` it is read from the column wherever
the merged schema carries it, so a key placed outside `fields:` is not detected and has no effect.
It is carried from `fields:` to the entity's properties like any other column annotation and back
by `convert_to_user_schema.py`.

The getter selects the matching ids with literal `COALESCE("col", '') ILIKE $pattern` SQL, the
expression the `_v2` index is built on (Prisma's `contains` renders the bare column, which that index
does not serve), then applies the entity's own access scope to those rows.

## Where the indexes are created

The `_v2` indexes are not Prisma migrations (`gin_trgm_ops` makes `prisma migrate dev` drift).
`lib/db-init.ts`'s `ensureSearchIndexes()` creates them with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`;
`instrumentation.ts` calls it on every Node.js server start, so any deployment or test run that
starts the generated Next.js server (`next start`, `next dev`, Vercel, Cloud Run) creates them,
and a failure is logged without stopping the server. `scripts/create-gin-indexes.sql` holds the same
statements for a manual run with `psql`; nothing runs it automatically. Without an index the search
is correct but scans the table. The legacy bare `idx_<table>_<column>_gin_trgm` indexes are left
as they are.


## Many matches

The getter selects the matching ids (`LIMIT 10001`) and narrows the Prisma query by `id IN (...)`.
When more than `TRIGRAM_ID_LIMIT` (10,000, `lib/_trigram_match.ts`) rows match, the list is
matched with Prisma's case-insensitive `contains` instead, the same rows without the id list: a
longer id list exceeds the database's bind-parameter limit, and a term that matches that many rows
is not narrowed by the index anyway. The result of a search is the same on either path.

## Measured cost

`EXPLAIN (ANALYZE)` on `COALESCE(name, '') ILIKE '%term%' OR COALESCE(description, '') ILIKE
'%term%'` with the two `_v2` indexes, rows of about 70 characters of hexadecimal words, warm
cache (the first of two runs is the nearer to a cold cache):

| Rows | Term | Plan | Time |
|---|---|---|---|
| 10,000 | `a` / `ab` (most / a quarter of rows) | Seq Scan | 6-18 ms (no index: 6-17 ms) |
| 10,000 | `abc` (166 rows) | Bitmap Index Scan | ~1 ms (no index: 11 ms) |
| 100,000 | `a` / `ab` | Seq Scan | 60-100 ms (no index: 95-110 ms) |
| 100,000 | `abc` (1,696 rows) / `3f9a` (198 rows) | Bitmap Index Scan | 4 ms / 1.4 ms (no index: ~100 ms) |
| 1,000,000 | `a` / `ab` | Seq Scan | 0.65-1.1 s (no index: 0.77-1.06 s) |
| 1,000,000 | `abc` (16,996 rows) | Bitmap Index Scan | 47-223 ms (no index: 0.5-0.6 s) |
| 1,000,000 | `3f9a` (1,998 rows) | Bitmap Index Scan | 8-50 ms (no index: 0.5 s) |
| 1,000,000 | a term without a match | Bitmap Index Scan | 0.1-2 ms (no index: 0.5 s) |

A 1-2 character term never costs more than the scan the list did before; a 3-character or longer
term costs from a tenth to a hundredth of it. The UI sends the text of any length (no minimum).
