# Music

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `music` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `title` | `string` | ✓ |  | min 1 chars |
| `kind` | `integer` | ✓ |  | min: 0, max: 3, values: `op`, `cd`, `bgm`, `insert` |
| `fc_linkable_id` | `string` |  |  | FK → [fc_linkable](fc_linkable.md) (label: `name`), CUID |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `scenes` | [`scene`](scene.md) | many-to-many · `list` |
| `composers` | [`creator`](creator.md) | many-to-many · `list` |
| `credits` | [`creator`](creator.md) | many-to-many · `list` |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/music` | ✓ |
| New | `/en/music/new` | ✓ |
| Edit | `/en/music/edit/[id]` | ✓ |
| View | `/en/music/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user.api_key` and start with the `mk_` prefix.

---

### GET /api/music

List all `Music` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "title": "...",
    "kind": 0,
    "fc_linkable_id": "..."
  }
]
```

### POST /api/music

Create a new `Music` record.

**Request Body**

```json
{
  "title": "...",
  "kind": op,
  "fc_linkable_id": "...",
  "scenes_ids": ["clxxx..."],
  "composers_ids": ["clxxx..."],
  "credits_ids": ["clxxx..."]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `scenes_ids` | `string[]` | IDs of `scene` records to associate (replaces existing) |
| `composers_ids` | `string[]` | IDs of `creator` records to associate (replaces existing) |
| `credits_ids` | `string[]` | IDs of `creator` records to associate (replaces existing) |

**Response `201 Created`** — the newly created record object.

### GET /api/music/[id]

Retrieve a single `Music` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/music/[id]

Replace an existing `Music` record. 
Accepts the same body as `POST /api/music`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/music/[id]

Delete a `Music` record by its ID.

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

### POST /api/music/bulk

Bulk-create `Music` records. Each element in the request array is processed with
the same rules as `POST /api/music`.

**Request Body** — array of create objects:

```json
[
  {
    "title": "...",
    "kind": op,
    "fc_linkable_id": "...",
    "scenes_ids": ["clxxx..."],
    "composers_ids": ["clxxx..."],
    "credits_ids": ["clxxx..."]
  },
  { "..." : "..." }
]
```

**Response `207`** — `data` of each successful item contains `{ "id": "..." }`.

### PUT /api/music/bulk

Bulk-update `Music` records. Each element must include `id` in addition to the
fields accepted by `PUT /api/music/[id]`.

**Request Body** — array of update objects:

```json
[
  { "id": "clxxx...", 
    "title": "...",
    "kind": op,
    "fc_linkable_id": "...",
    "scenes_ids": ["clxxx..."],
    "composers_ids": ["clxxx..."],
    "credits_ids": ["clxxx..."]
  },
  { "id": "clyyy...", "..." : "..." }
]
```

**Response `207`** — `data` of each successful item is `{ "success": true }`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

### DELETE /api/music/bulk

Bulk-delete `Music` records by ID.

**Request Body** — array of id objects:

```json
[
  { "id": "clxxx..." },
  { "id": "clyyy..." }
]
```

**Response `207`** — `data` of each successful item is `null`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

