# Dashboard

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `dashboard` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `widgets` | [`dashboard_widget`](dashboard_widget.md) | one-to-many |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/dashboard` | ✓ |
| New | `/en/dashboard/new` | ✓ |
| Edit | `/en/dashboard/edit/[id]` | ✓ |
| View | `/en/dashboard/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user.api_key` and start with the `mk_` prefix.

---

### GET /api/dashboard

List all `Dashboard` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "..."
  }
]
```

### POST /api/dashboard

Create a new `Dashboard` record.

**Request Body**

```json
{
  "name": "...",
  "widgets": [{...}]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `widgets` | `object[]` | `dashboard_widget` child records (all replaced on update) |

**Response `201 Created`** — the newly created record object.

### GET /api/dashboard/[id]

Retrieve a single `Dashboard` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/dashboard/[id]

Replace an existing `Dashboard` record. 
Accepts the same body as `POST /api/dashboard`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/dashboard/[id]

Delete a `Dashboard` record by its ID.

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

### POST /api/dashboard/bulk

Bulk-create `Dashboard` records. Each element in the request array is processed with
the same rules as `POST /api/dashboard`.

**Request Body** — array of create objects:

```json
[
  {
    "name": "...",
    "widgets": [{...}]
  },
  { "..." : "..." }
]
```

**Response `207`** — `data` of each successful item contains `{ "id": "..." }`.

### PUT /api/dashboard/bulk

Bulk-update `Dashboard` records. Each element must include `id` in addition to the
fields accepted by `PUT /api/dashboard/[id]`.

**Request Body** — array of update objects:

```json
[
  { "id": "clxxx...", 
    "name": "...",
    "widgets": [{...}]
  },
  { "id": "clyyy...", "..." : "..." }
]
```

**Response `207`** — `data` of each successful item is `{ "success": true }`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

### DELETE /api/dashboard/bulk

Bulk-delete `Dashboard` records by ID.

**Request Body** — array of id objects:

```json
[
  { "id": "clxxx..." },
  { "id": "clyyy..." }
]
```

**Response `207`** — `data` of each successful item is `null`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

