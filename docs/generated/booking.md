# Booking

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `booking` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |
| Chart | `week` view, grouped by `resource` |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars |
| `resource_id` | `string` | ✓ |  | FK → [resource](resource.md) (label: `name`), CUID |
| `start_time` | `datetime` | ✓ |  |  |
| `end_time` | `datetime` | ✓ |  |  |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `resource_id` | [`resource`](resource.md) | many-to-one |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/booking` | ✓ |
| New | `/en/booking/new` | ✓ |
| Edit | `/en/booking/edit/[id]` | ✓ |
| View | `/en/booking/view/[id]` | ✓ |
| Chart | `/en/booking/chart` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/booking

List all `Booking` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "...",
    "resource_id": "...",
    "start_time": "2024-01-01T00:00:00.000Z",
    "end_time": "2024-01-01T00:00:00.000Z"
  }
]
```

### POST /api/booking

Create a new `Booking` record.

**Request Body**

```json
{
  "name": "...",
  "resource_id": "...",
  "start_time": "2024-01-01T00:00:00.000Z",
  "end_time": "2024-01-01T00:00:00.000Z"
}
```


**Response `201 Created`** — the newly created record object.

### GET /api/booking/[id]

Retrieve a single `Booking` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/booking/[id]

Replace an existing `Booking` record. Accepts the same body as `POST /api/booking`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/booking/[id]

Delete a `Booking` record by its ID.

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

### POST /api/booking/bulk

Bulk-create `Booking` records. Each element in the request array is processed with
the same rules as `POST /api/booking`.

**Request Body** — array of create objects:

```json
[
  {
    "name": "...",
    "resource_id": "...",
    "start_time": "2024-01-01T00:00:00.000Z",
    "end_time": "2024-01-01T00:00:00.000Z"
  },
  { "..." : "..." }
]
```

**Response `207`** — `data` of each successful item contains `{ "id": "..." }`.

### PUT /api/booking/bulk

Bulk-update `Booking` records. Each element must include `id` in addition to the
fields accepted by `PUT /api/booking/[id]`.

**Request Body** — array of update objects:

```json
[
  { "id": "clxxx...", 
    "name": "...",
    "resource_id": "...",
    "start_time": "2024-01-01T00:00:00.000Z",
    "end_time": "2024-01-01T00:00:00.000Z"
  },
  { "id": "clyyy...", "..." : "..." }
]
```

**Response `207`** — `data` of each successful item is `{ "success": true }`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

### DELETE /api/booking/bulk

Bulk-delete `Booking` records by ID.

**Request Body** — array of id objects:

```json
[
  { "id": "clxxx..." },
  { "id": "clyyy..." }
]
```

**Response `207`** — `data` of each successful item is `null`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

