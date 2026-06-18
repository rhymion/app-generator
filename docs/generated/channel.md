# Channel

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `channel` |
| Operations | List · View · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars |
| `kind` | `integer` | ✓ |  | min: 0, max: 1, values: `general`, `consider` |
| `organization_id` | `string` | ✓ |  | FK → [organization](organization.md) (label: `name`), CUID |
| `commentable_id` | `string` | ✓ |  | FK → [commentable](commentable.md) (label: `id`), CUID |
| `fc_linkable_id` | `string` |  |  | FK → [fc_linkable](fc_linkable.md) (label: `name`), CUID |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `organization_id` | [`organization`](organization.md) | many-to-one |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/channel` | ✓ |
| New | `/en/channel/new` | ✗ |
| Edit | `/en/channel/edit/[id]` | ✓ |
| View | `/en/channel/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user.api_key` and start with the `mk_` prefix.

---

### GET /api/channel

List all `Channel` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "...",
    "kind": 0,
    "organization_id": "...",
    "commentable_id": "...",
    "fc_linkable_id": "..."
  }
]
```

### GET /api/channel/[id]

Retrieve a single `Channel` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/channel/[id]

Replace an existing `Channel` record. 

**Request Body**

```json
{
  "name": "...",
  "kind": general,
  "organization_id": "...",
  "commentable_id": "...",
  "fc_linkable_id": "..."
}
```


**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/channel/[id]

Delete a `Channel` record by its ID.

**Response `204 No Content`** — empty body on success.

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```


### Error Responses

| Status | Meaning |
|--------|---------|
| `400` | Bad request (validation error) |
| `401` | Missing or invalid API key |
| `403` | Insufficient permission for the operation |
| `404` | Record not found |
| `500` | Unexpected server error |

All error responses return `{ "error": "<message>" }`.

---

## Bulk Operations

Bulk endpoints process each item independently, enabling **partial success**. The outer
request always returns `207 Multi-Status` as long as authentication passes; individual
item outcomes are reported in the `results` array.

### Response shape (`207 Multi-Status`)

```json
{
  "results": [
    { "index": 0, "success": true,  "data": { ... } },
    { "index": 1, "success": false, "error": "Not found: clxxx..." }
  ],
  "summary": { "total": 2, "succeeded": 1, "failed": 1 }
}
```

> Auth/permission failures at the **request** level (bad key, no permission at all) still
> return `401` / `403` — not `207`.

### PUT /api/channel/bulk

Bulk-update `Channel` records. Each element must include `id` in addition to the
fields accepted by `PUT /api/channel/[id]`.

**Request Body** — array of update objects:

```json
[
  { "id": "clxxx...", 
    "name": "...",
    "kind": general,
    "organization_id": "...",
    "commentable_id": "...",
    "fc_linkable_id": "..."
  },
  { "id": "clyyy...", "..." : "..." }
]
```

**Response `207`** — `data` of each successful item is `{ "success": true }`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

### DELETE /api/channel/bulk

Bulk-delete `Channel` records by ID.

**Request Body** — array of id objects:

```json
[
  { "id": "clxxx..." },
  { "id": "clyyy..." }
]
```

**Response `207`** — `data` of each successful item is `null`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

