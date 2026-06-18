# Plan

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `plan` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `tier` | `integer` | ✓ |  | min: 0, max: 2, values: `free`, `premium`, `vip` |
| `reaction_kinds_allowed` | `number` | ✓ |  | min: 0 |
| `sub_account_limit` | `number` | ✓ |  | min: 0 |
| `can_view_paid_posts` | `boolean` | ✓ |  |  |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `users` | [`user`](user.md) | many-to-many · `list` |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/plan` | ✓ |
| New | `/en/plan/new` | ✓ |
| Edit | `/en/plan/edit/[id]` | ✓ |
| View | `/en/plan/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user.api_key` and start with the `mk_` prefix.

---

### GET /api/plan

List all `Plan` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "tier": 0,
    "reaction_kinds_allowed": 0,
    "sub_account_limit": 0,
    "can_view_paid_posts": false
  }
]
```

### POST /api/plan

Create a new `Plan` record.

**Request Body**

```json
{
  "tier": free,
  "reaction_kinds_allowed": 0,
  "sub_account_limit": 0,
  "can_view_paid_posts": false,
  "users_ids": ["clxxx..."]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `users_ids` | `string[]` | IDs of `user` records to associate (replaces existing) |

**Response `201 Created`** — the newly created record object.

### GET /api/plan/[id]

Retrieve a single `Plan` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/plan/[id]

Replace an existing `Plan` record. 
Accepts the same body as `POST /api/plan`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/plan/[id]

Delete a `Plan` record by its ID.

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

### POST /api/plan/bulk

Bulk-create `Plan` records. Each element in the request array is processed with
the same rules as `POST /api/plan`.

**Request Body** — array of create objects:

```json
[
  {
    "tier": free,
    "reaction_kinds_allowed": 0,
    "sub_account_limit": 0,
    "can_view_paid_posts": false,
    "users_ids": ["clxxx..."]
  },
  { "..." : "..." }
]
```

**Response `207`** — `data` of each successful item contains `{ "id": "..." }`.

### PUT /api/plan/bulk

Bulk-update `Plan` records. Each element must include `id` in addition to the
fields accepted by `PUT /api/plan/[id]`.

**Request Body** — array of update objects:

```json
[
  { "id": "clxxx...", 
    "tier": free,
    "reaction_kinds_allowed": 0,
    "sub_account_limit": 0,
    "can_view_paid_posts": false,
    "users_ids": ["clxxx..."]
  },
  { "id": "clyyy...", "..." : "..." }
]
```

**Response `207`** — `data` of each successful item is `{ "success": true }`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

### DELETE /api/plan/bulk

Bulk-delete `Plan` records by ID.

**Request Body** — array of id objects:

```json
[
  { "id": "clxxx..." },
  { "id": "clyyy..." }
]
```

**Response `207`** — `data` of each successful item is `null`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

