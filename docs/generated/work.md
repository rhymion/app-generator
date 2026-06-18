# Work

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `work` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `title` | `string` | ✓ |  | min 1 chars |
| `pattern` | `integer` | ✓ |  | min: 0, max: 1, values: `A`, `B` |
| `status` | `integer` | ✓ |  | min: 0, max: 1, values: `pending`, `approved` |
| `channelable_id` | `string` |  |  | FK → [channelable](channelable.md) (label: `name`), CUID |
| `fc_linkable_id` | `string` |  |  | FK → [fc_linkable](fc_linkable.md) (label: `name`), CUID |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `characters` | [`character`](character.md) | many-to-many · `list` |
| `scenes` | [`scene`](scene.md) | many-to-many · `list` |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/work` | ✓ |
| New | `/en/work/new` | ✓ |
| Edit | `/en/work/edit/[id]` | ✓ |
| View | `/en/work/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user.api_key` and start with the `mk_` prefix.

---

### GET /api/work

List all `Work` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "title": "...",
    "pattern": 0,
    "status": 0,
    "channelable_id": "...",
    "fc_linkable_id": "..."
  }
]
```

### POST /api/work

Create a new `Work` record.

**Request Body**

```json
{
  "title": "...",
  "pattern": A,
  "status": pending,
  "channelable_id": "...",
  "fc_linkable_id": "...",
  "characters_ids": ["clxxx..."],
  "scenes_ids": ["clxxx..."]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `characters_ids` | `string[]` | IDs of `character` records to associate (replaces existing) |
| `scenes_ids` | `string[]` | IDs of `scene` records to associate (replaces existing) |

**Response `201 Created`** — the newly created record object.

### GET /api/work/[id]

Retrieve a single `Work` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/work/[id]

Replace an existing `Work` record. 
Accepts the same body as `POST /api/work`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/work/[id]

Delete a `Work` record by its ID.

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

### POST /api/work/bulk

Bulk-create `Work` records. Each element in the request array is processed with
the same rules as `POST /api/work`.

**Request Body** — array of create objects:

```json
[
  {
    "title": "...",
    "pattern": A,
    "status": pending,
    "channelable_id": "...",
    "fc_linkable_id": "...",
    "characters_ids": ["clxxx..."],
    "scenes_ids": ["clxxx..."]
  },
  { "..." : "..." }
]
```

**Response `207`** — `data` of each successful item contains `{ "id": "..." }`.

### PUT /api/work/bulk

Bulk-update `Work` records. Each element must include `id` in addition to the
fields accepted by `PUT /api/work/[id]`.

**Request Body** — array of update objects:

```json
[
  { "id": "clxxx...", 
    "title": "...",
    "pattern": A,
    "status": pending,
    "channelable_id": "...",
    "fc_linkable_id": "...",
    "characters_ids": ["clxxx..."],
    "scenes_ids": ["clxxx..."]
  },
  { "id": "clyyy...", "..." : "..." }
]
```

**Response `207`** — `data` of each successful item is `{ "success": true }`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

### DELETE /api/work/bulk

Bulk-delete `Work` records by ID.

**Request Body** — array of id objects:

```json
[
  { "id": "clxxx..." },
  { "id": "clyyy..." }
]
```

**Response `207`** — `data` of each successful item is `null`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

