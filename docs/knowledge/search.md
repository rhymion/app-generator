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
| Search engine | PostgreSQL FTS (`tsvector` / `ts_headline`) + pg_bigm (Japanese 2-gram) |
| Header entry point | Search icon in `app/@header/page.tsx` (authenticated users only) |

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
GET /api/search?q=<query>[&entity=<entityName>]
```

| Parameter | Required | Description |
|---|---|---|
| `q` | Yes | Search query string |
| `entity` | No | Filter results to a single entity type |

### Response

```json
{
  "results": [
    {
      "entity": "post",
      "id": "clxxx...",
      "snippet": "...matched <mark>text</mark> here...",
      "labelField": "My Post Title",
      "score": 1
    }
  ],
  "facets": {
    "post": 12,
    "comment": 5
  }
}
```

- `snippet` — `ts_headline` output with `<<<`/`>>>` markers converted to `<mark>` tags (XSS-safe)
- `facets` — per-entity hit counts; rendered as filter chips above results in the UI
- Authorization filters are applied per entity using the same `build<Entity>AccessWhere` /
  `RichPermissions` logic as list pages — no separate permission configuration needed

---

## Japanese Search (pg_bigm)

Japanese text search uses a custom PostgreSQL Docker image (`app-postgres-bigm:16`) with the
pg_bigm extension bundled (`docker/pg_bigm.tar.gz`).

### How it works

- GIN bigm indexes are created in a migration when pg_bigm is available.
- The search WHERE clause uses `LIKE '%'||q||'%'` containment (GIN index-accelerated).
  - Note: the pg_bigm `=%` operator was evaluated and rejected — it uses padding bigrams
    and fails for mid-string Japanese matches (e.g., `'権限' =% 'text containing 権限'` returns
    FALSE). `LIKE` containment is the correct approach.
- English queries fall through to standard FTS (`tsvector`) path.

### Docker setup

```dockerfile
# Dockerfile.postgres
FROM postgres:16
# ... pg_bigm bundled tarball install
```

The `docker-compose.yml` (or local dev setup) must use the custom image instead of `postgres:16`.

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
