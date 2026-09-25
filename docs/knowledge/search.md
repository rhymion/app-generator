# Cross-Entity Full-Text Search

Added in v1.5.0. Enables a single `GET /api/search` endpoint that queries multiple entities in
one UNION ALL query, with per-entity tenant and permission filters applied.

---

## Overview

| What | Where |
|---|---|
| Schema opt-in | `x-generate.search: true` on each entity definition |
| Generated API | `app/api/search/route.ts` |
| Generated UI | `app/[locale]/search/page.tsx` |
| Search engine | PostgreSQL FTS (`tsvector` / `ts_headline`) + pg_trgm (`%` operator + `ILIKE`, both GIN-accelerated) |
| Index provisioning | `instrumentation.ts` → `lib/db-init.ts`'s `ensureSearchIndexes()`, on every server cold start |
| Header entry point | Search icon in `app/[locale]/@header/page.tsx` (authenticated users only) |

---

## Enabling Search on an Entity

Add `x-generate.search: true` inside the entity's `x-generate` block:

```yaml
post:
  x-generate:
    list: true
    view: true
    edit: true
    create: true
    search: true          # ← enables this entity in UNION ALL search
```

`text_fields` (the columns to search) are **auto-derived** by the generator — no manual
configuration needed. The derivation logic excludes:

- Primary keys and CUID-pattern strings
- Foreign keys (`*_id` suffix)
- Enum fields
- Date/URI format fields
- Fields marked `x-search: false`

Entities left with no text fields after exclusion are silently skipped from the UNION.

---

## Special Schema Flags

### `x-search: false` (field-level opt-out)

Exclude a specific string field from search text regardless of type:

```yaml
user:
  properties:
    api_key:
      type: string
      x-search: false    # never included in search text_fields
```

### `x-audit: true` entities

Entities with `x-audit: true` default to `search: false` (audit-safe). To include them:

```yaml
audit_log:
  x-generate:
    search: true          # explicit opt-in overrides the x-audit default
  x-audit: true
```

### `x-search.org_id_field` (non-standard organization key)

For entities where the organization foreign key is not `organization_id`:

```yaml
organization_detail:
  x-search:
    org_id_field: id      # uses organization_detail.id as the org isolation key
```

---

## Generated API: `GET /api/search`

### Request

```
GET /api/search?q=<query>[&entityTypes=<entityName>[,<entityName>...]][&page=<n>][&pageSize=<n>]
```

| Parameter | Required | Description |
|---|---|---|
| `q` | Yes | Search query string, minimum 2 characters (HTTP 400 if shorter or missing) |
| `entityTypes` | No | Comma-separated list of entity types to filter to (e.g. `organization,comment`) — not a single `entity` param |
| `page` | No | 0-based page index (default `0`) |
| `pageSize` | No | Items per page (default `20`, max `100`) |

### Response

```json
{
  "results": [
    {
      "entity_type": "post",
      "id": "clxxx...",
      "snippet": "...matched <mark>text</mark> here...",
      "rank": 1
    }
  ],
  "total": 1,
  "page": 0,
  "pageSize": 20,
  "facets": {
    "post": 12,
    "comment": 5
  }
}
```

- Each result row is `{ entity_type, id, snippet, rank }` (`lib/search/helpers.ts`'s `SearchResult`
  interface) — there is no `labelField`; the UI (`search_page.tsx.jinja2`) renders only a
  formatted `entity_type` chip and the snippet, not a per-record display label.
- `rank` combines three signals, summed: `1.0` for an FTS (`tsvector`) hit, `GREATEST(...)` over
  pg_trgm `similarity()` per text field, and `GREATEST(...) * 0.5` over the ILIKE-containment
  matches described below (`code_generator/templates/search_helpers.ts.jinja2`).
- `snippet` — `ts_headline` output with `<<<`/`>>>` markers converted to `<mark>` tags client-side
  in the search page (XSS-safe)
- `total`/`page`/`pageSize` echo the effective pagination; `facets` — per-entity hit counts;
  rendered as filter chips above results in the UI
- Authorization filters are applied per entity using the same `build<Entity>AccessWhere` /
  `RichPermissions` logic as list pages — no separate permission configuration needed

---

## Japanese Search (pg_trgm, superseded pg_bigm)

**This mechanism changed after v1.5.0.** Japanese (and now all-language) substring matching
runs on the standard `pg_trgm` contrib extension, not `pg_bigm` — no custom PostgreSQL Docker
image is needed. `docker-compose.dev.yml`/`docker-compose.test.yml`/`docker-compose.prod.yml`
all use plain `postgres:18`. `docker/Dockerfile.postgres` and `docker/pg_bigm.tar.gz` still exist
in the tree but are no longer referenced by any compose file, script, or generator code (grep
confirmed, 2026-09-12) — they appear to be orphaned leftovers from the original pg_bigm design.

The switch is recorded in `code_generator/generate.py`'s comment: "C3=A: use pg_trgm (Cloud SQL
compatible) instead of pg_bigm (Cloud SQL unsupported)" (landed in commit `77fa04ef`, "Enable
setup for GCP", 2026-07-01 — after this doc was originally written at `e17703ee`, 2026-06-24,
which is why the doc never caught up). Internal variable names in
`code_generator/templates/search_helpers.ts.jinja2` (`bigm_where_sql`, `bigm_fields`,
`bigm_similarity_fields_sql`) still use the old `bigm` naming, but their content is now
pg_trgm/ILIKE-based, not pg_bigm.

### How it works

- Two index-provisioning mechanisms exist, generated together whenever any entity has
  `search: true`:
  - `instrumentation.ts` (`code_generator/templates/instrumentation.ts.jinja2`) — Next.js's own
    `register()` hook, called once per server instance bootstrap on both Vercel and GCP/Cloud
    Run (one wiring point reaches both deployment targets). It imports and awaits
    `lib/db-init.ts`'s `ensureSearchIndexes()` — the automatic, always-on path.
  - `scripts/create-gin-indexes.sql` (`code_generator/templates/create_gin_indexes.sql.jinja2`)
    — the same indexes as plain SQL, kept as a manual/migration-time fallback:
    `psql "$DATABASE_URL" -f scripts/create-gin-indexes.sql`.
  - Neither creates indexes via a Prisma migration — the SQL template's own header comment
    explains why: Prisma 7's `ops: raw("gin_trgm_ops")` syntax works, but `prisma migrate dev`
    enters an infinite drop/recreate drift loop on it (Prisma issue #16275, unresolved), so
    index-creation SQL is kept out of `prisma/schema.prisma` entirely.
  - Each searchable entity gets three kinds of index, all via `CREATE INDEX CONCURRENTLY IF NOT
    EXISTS` (non-blocking, and once an index already exists a fast existence check rather than a
    rebuild, so `ensureSearchIndexes()` running on every cold start is cheap after the first
    successful run):
    - `idx_<model>_<field>_gin_trgm`: a bare-column `GIN ... USING GIN (<field> gin_trgm_ops)`
      trigram index per searchable text field. **Dead weight** — no query ever matches this
      expression verbatim (see the Issue #725 fix (d) entry below) — kept only because dropping
      it is a separate, non-urgent follow-up, not because anything still uses it.
    - `idx_<model>_<field>_gin_trgm_v2`: an **expression** index,
      `GIN ... USING GIN ((COALESCE(<field>, '')) gin_trgm_ops)` — matches the `%`/`ILIKE` halves
      of the `WHERE` clause below verbatim (see Issue #725 fix (d)). This is the index actually
      used at runtime; the field set is the union of `text_fields` and `bigm_fields` (shared
      between `create_gin_indexes.sql.jinja2` and `db_init.ts.jinja2` via `generate.py`'s
      `trgm_index_fields`), so it's complete regardless of whether an entity narrows
      `x-search.bigm_fields`.
    - `idx_<model>_tsv_gin`: one `GIN ... USING GIN (to_tsvector('simple', COALESCE(<fields
      concatenated>, '')))` expression index per entity — must match the `WHERE` clause below
      verbatim for the planner to use it (unaffected by the fix (d) bug, since this expression
      already matched from the start).
  - Every query always evaluates three signals together, OR'd in the `WHERE` clause (not a
    language-based fallthrough): standard FTS (`to_tsvector('simple', ...) @@
    plainto_tsquery(...)`, backed by the tsvector expression index above), pg_trgm fuzzy
    matching via the `%` operator (backed by the trigram index), and `ILIKE '%'||q||'%'`
    containment (also backed by the trigram index) — the last of these is what actually carries
    Japanese mid-string matching, since `to_tsvector('simple', ...)` does no CJK segmentation.
  - The `%` operator, not `similarity(a, b) > threshold`, is what makes the fuzzy-match half of
    the `WHERE` clause index-optimizable: only `%` is recognized by the pg_trgm planner support
    function as trigram-indexable — `similarity(...)` is an opaque scalar function call in a
    filter, and Postgres never uses a trigram GIN index for it, confirmed via `EXPLAIN ANALYZE`
    (app-generator Issue #725). `%`'s threshold comes from the `pg_trgm.similarity_threshold`
    session GUC. `buildSearchQuery()` (`search_helpers.ts.jinja2`) does **not** set this GUC
    explicitly: PostgreSQL's own out-of-the-box default for it is 0.3 (confirmed against a live
    instance — `SHOW pg_trgm.similarity_threshold;` and `pg_settings.source = 'default'` with no
    `ALTER SYSTEM`/`ALTER DATABASE`/`ALTER ROLE` override), identical to the generator's
    `_SEARCH_SIMILARITY_THRESHOLD` constant (`code_generator/generate.py`), and nothing else this
    generator ever emits touches this GUC — so every connection already carries the right
    threshold with no explicit `SET` needed. `_SEARCH_SIMILARITY_THRESHOLD` has no per-schema
    override today, so this holds unconditionally. `similarity(...)` itself remains in the
    rank-scoring expression (`GREATEST(similarity(...))`, ordering only, not filtering) where
    index usage doesn't apply.
  - **Issue #725 fix (d)**: even with `%` (not `similarity(...)`) in the `WHERE` clause, the
    trigram index still went unused, because `generate.py`'s `sim_where_single`/
    `bigm_where_single` wrap every field in `COALESCE(field, '')` before applying `%`/`ILIKE`,
    while the trigram index (fix (b)/(c)'s `idx_<model>_<field>_gin_trgm`) was built on the bare
    column — a GIN index only matches a query expression that is syntactically identical to the
    one it was built on. Confirmed via `EXPLAIN ANALYZE` on a 60,000-row table: the real generated
    predicate (`COALESCE(name, '') % $q OR ...`, combined with the tsvector and `ILIKE` disjuncts
    via `BitmapOr`) forced a full-table (parallel) `Seq Scan` (`Disabled: true` even with
    `enable_seqscan = off` — no alternate plan existed, not merely a cost-based choice), 582ms for
    a single-row-match query — vs. 0.4ms once fixed. Fixed by adding a **second**, `_v2`-suffixed
    expression index per field matching the query's `COALESCE(field, '')` form verbatim (query
    side, `generate.py`, is untouched — zero risk of a search-result behavior change). The old
    bare-column index is left in place (dead weight, harmless) rather than dropped, to avoid a
    blocking `DROP INDEX`; removing it is a separate, non-urgent follow-up. While implementing
    this, also found and fixed an unrelated pre-existing drift between
    `create_gin_indexes.sql.jinja2` and `db_init.ts.jinja2`: the two templates independently named
    the bare-column index differently (`_gin_trgm` vs. `_trgm`) and iterated a different field set
    (`text_fields` vs. `bigm_fields`) for what was meant to be the same index — both templates now
    share a single derivation (`generate.py`'s `trgm_index_fields`, the union of `text_fields` and
    `bigm_fields`) for both the bare-column and `_v2` loops.
  - **Count, facet, and main-select run as three independent queries via `Promise.all`** (each
    its own pooled connection), not serialized through a single `prisma.$transaction(...)`. An
    earlier version of this fix (merged as part of Issue #725/#727) *did* wrap all three in
    `prisma.$transaction(async (tx) => {...})` with `SET LOCAL pg_trgm.similarity_threshold`,
    defensively guarding against a pooled connection carrying a stale threshold into an unrelated
    later request — a case that cannot happen today, since no code path sets this GUC to anything
    but its own default (see above). That transaction wrapper had no explicit `timeout`, so
    Prisma's 5000ms interactive-transaction default applied; at real data scale (N=30,000) the
    full search UNION (up to 25 entities' count+facet+main, serialized onto one connection) could
    exceed 5000ms, producing `P2028` on the search endpoint (reproduced 3/3 times against a clean
    test database with no other load). Removing the transaction eliminates this timeout exposure
    entirely and restores full parallelism. **If a per-schema `similarity_threshold` override is
    ever introduced**, this design must be revisited: reintroduce an explicit, connection-safe
    `SET` (transaction-wrapped, with a `timeout` sized to real measured query time, not Prisma's
    default) for schemas whose threshold differs from PostgreSQL's own default.
  - The historical note that "the pg_bigm `=%` operator was evaluated and rejected" is no longer
    relevant to the current mechanism — pg_bigm itself was replaced, not just its `=%` operator.

---

## Generated UI: `/search`

The search page (`app/[locale]/search/page.tsx`) is a client component that provides:

- Full-width search input box
- Entity-type chip per result (e.g., "Post", "Comment")
- Snippet with `<mark>` highlights
- "View details" link to the entity's detail page
- Facet chips above results (per-entity hit counts; clicking filters by that entity)
- Mobile-responsive layout

The page is only reachable by authenticated users (middleware redirects `/search` to `/login`
for unauthenticated requests).

---

## Zero-Entity Cleanup

If `generate-code` runs and no entities have `search: true`, all generated search files are
deleted automatically:

- `lib/search/helpers.ts`
- `app/api/search/route.ts`
- `app/[locale]/search/page.tsx`
- `app/[locale]/search/actions.ts`
- `scripts/create-gin-indexes.sql`
- `instrumentation.ts`

(`code_generator/generate.py`'s `_stale_search_files` list — confirmed against the source.
`lib/db-init.ts` is not in this cleanup list, so it is not deleted when search entities go to
zero — harmless, since `instrumentation.ts` (its only caller) is deleted, so no import breaks;
it just lingers as an unused file. Pre-existing gap, not introduced by the Issue #725 fix.)

This keeps the project free of dead code when search is disabled.

---

## Authorization Design

Search reuses the existing permission system — no separate configuration:

| Permission type | Behavior in search |
|---|---|
| `general.read = true` | Entity rows visible to all authenticated users in the org |
| `general.read = false` | Only rows where `creator_id = userId` or `assignee_id = userId` |
| `x-audit: true` | Excluded by default (opt in with `x-generate.search: true`) |
| `x-search.org_id_field` | Custom key used for org isolation WHERE clause |

For detailed authorization model documentation, see
[multi-tenancy-and-permissions.md](../multi-tenancy-and-permissions.md) and
[authorization-default-deny.md](../authorization-default-deny.md).
