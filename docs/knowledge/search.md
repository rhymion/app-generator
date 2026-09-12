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
| Search engine | PostgreSQL FTS (`tsvector` / `ts_headline`) + pg_trgm (`similarity()` + `ILIKE`, GIN-accelerated) |
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
all use plain `postgres:16`. `docker/Dockerfile.postgres` and `docker/pg_bigm.tar.gz` still exist
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

- `CREATE EXTENSION IF NOT EXISTS pg_trgm;` plus one `GIN ... USING GIN (<field> gin_trgm_ops)`
  index per searchable text field are written to `scripts/create-gin-indexes.sql`
  (`code_generator/templates/create_gin_indexes.sql.jinja2`), **not** created in a Prisma
  migration — the template's own header comment explains why: Prisma 7's
  `ops: raw("gin_trgm_ops")` syntax works, but `prisma migrate dev` enters an infinite
  drop/recreate drift loop on it (Prisma issue #16275, unresolved), so the index-creation SQL is
  kept out of `prisma/schema.prisma` entirely and applied manually:
  `psql "$DATABASE_URL" -f scripts/create-gin-indexes.sql` (idempotent, safe to re-run).
- Every query always evaluates three signals together, OR'd in the `WHERE` clause (not a
  language-based fallthrough): standard FTS (`to_tsvector('simple', ...) @@ plainto_tsquery(...)`),
  pg_trgm fuzzy `similarity(...) > 0.3`, and `ILIKE '%'||q||'%'` containment (GIN-accelerated by
  the same `gin_trgm_ops` index) — the last of these is what actually carries Japanese mid-string
  matching, since `to_tsvector('simple', ...)` does no CJK segmentation.
- `lib/db-init.ts` (`code_generator/templates/db_init.ts.jinja2`) is also generated whenever any
  entity has `search: true` — it independently creates the `pg_trgm` extension plus five
  hardcoded indexes (`role`.name/description, `organization`.name/description,
  `dashboard`.name). Its exported `ensureSearchIndexes()` has no call site anywhere in the repo
  (grep confirmed, 2026-09-12) — apparently dead code, separate from and redundant with
  `scripts/create-gin-indexes.sql` above. Not otherwise documented here since it appears unused;
  flagged for whoever next touches the search generator.
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

(`code_generator/generate.py`'s `_stale_search_files` list — confirmed against the source, which
lists these same five paths. `lib/db-init.ts` is not in this cleanup list, so it is not deleted
when search entities go to zero — see the "dead code" note in the Japanese Search section above.)

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
