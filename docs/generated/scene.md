# Scene

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `scene` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `label` | `string` | ✓ |  | min 1 chars |
| `work_id` | `string` | ✓ |  | FK → [work](work.md) (label: `title`), CUID |
| `episode` | `string` | ✓ |  | min 1 chars |
| `timestamp` | `string` | ✓ |  | min 1 chars |
| `channelable_id` | `string` |  |  | FK → [channelable](channelable.md) (label: `name`), CUID |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `work_id` | [`work`](work.md) | many-to-one |
| `characters` | [`character`](character.md) | many-to-many · `list` |
| `music` | [`music`](music.md) | many-to-many · `list` |
| `creators` | [`creator`](creator.md) | many-to-many · `list` |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/scene` | ✓ |
| New | `/en/scene/new` | ✓ |
| Edit | `/en/scene/edit/[id]` | ✓ |
| View | `/en/scene/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user.api_key` and start with the `mk_` prefix.

---

### GET /api/scene

List all `Scene` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "label": "...",
    "work_id": "...",
    "episode": "...",
    "timestamp": "...",
    "channelable_id": "..."
  }
]
```

### POST /api/scene

Create a new `Scene` record.

**Request Body**

```json
{
  "label": "...",
  "work_id": "...",
  "episode": "...",
  "timestamp": "...",
  "channelable_id": "...",
  "characters_ids": ["clxxx..."],
  "music_ids": ["clxxx..."],
  "creators_ids": ["clxxx..."]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `characters_ids` | `string[]` | IDs of `character` records to associate (replaces existing) |
| `music_ids` | `string[]` | IDs of `music` records to associate (replaces existing) |
| `creators_ids` | `string[]` | IDs of `creator` records to associate (replaces existing) |

**Response `201 Created`** — the newly created record object.

### GET /api/scene/[id]

Retrieve a single `Scene` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/scene/[id]

Replace an existing `Scene` record. 
Accepts the same body as `POST /api/scene`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/scene/[id]

Delete a `Scene` record by its ID.

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

### POST /api/scene/bulk

Bulk-create `Scene` records. Each element in the request array is processed with
the same rules as `POST /api/scene`.

**Request Body** — array of create objects:

```json
[
  {
    "label": "...",
    "work_id": "...",
    "episode": "...",
    "timestamp": "...",
    "channelable_id": "...",
    "characters_ids": ["clxxx..."],
    "music_ids": ["clxxx..."],
    "creators_ids": ["clxxx..."]
  },
  { "..." : "..." }
]
```

**Response `207`** — `data` of each successful item contains `{ "id": "..." }`.

### PUT /api/scene/bulk

Bulk-update `Scene` records. Each element must include `id` in addition to the
fields accepted by `PUT /api/scene/[id]`.

**Request Body** — array of update objects:

```json
[
  { "id": "clxxx...", 
    "label": "...",
    "work_id": "...",
    "episode": "...",
    "timestamp": "...",
    "channelable_id": "...",
    "characters_ids": ["clxxx..."],
    "music_ids": ["clxxx..."],
    "creators_ids": ["clxxx..."]
  },
  { "id": "clyyy...", "..." : "..." }
]
```

**Response `207`** — `data` of each successful item is `{ "success": true }`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

### DELETE /api/scene/bulk

Bulk-delete `Scene` records by ID.

**Request Body** — array of id objects:

```json
[
  { "id": "clxxx..." },
  { "id": "clyyy..." }
]
```

**Response `207`** — `data` of each successful item is `null`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

