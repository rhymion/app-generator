# Parent1

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `parent1` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars, max 100 chars |
| `organization_id` | `string` | ✓ |  | FK → [organization](organization.md) (label: `name`), CUID |
| `description` | `string \| null` |  |  |  |
| `price` | `number` | ✓ |  | min: 0, max: 1000000 |
| `due_date` | `datetime` | ✓ |  |  |
| `image_url` | `uri \| null` |  |  | URL |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `organization_id` | [`organization`](organization.md) | many-to-one |
| `parent1_child1s` | [`parent1_child1`](parent1_child1.md) | one-to-many |
| `parent1_child2s` | [`parent1_child2`](parent1_child2.md) | one-to-many |
| `parent1_lists` | [`parent1_list`](parent1_list.md) | one-to-many · `list` |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/parent1` | ✓ |
| New | `/en/parent1/new` | ✓ |
| Edit | `/en/parent1/edit/[id]` | ✓ |
| View | `/en/parent1/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/parent1

List all `Parent1` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "...",
    "organization_id": "...",
    "description": null,
    "price": 0,
    "due_date": "2024-01-01T00:00:00.000Z",
    "image_url": null
  }
]
```

### POST /api/parent1

Create a new `Parent1` record.

**Request Body**

```json
{
  "name": "...",
  "organization_id": "...",
  "description": null,
  "price": 0,
  "due_date": "2024-01-01T00:00:00.000Z",
  "image_url": null,
  "parent1_child1s": [{...}],
  "parent1_child2s": [{...}],
  "parent1_lists": [{...}]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `parent1_child1s` | `object[]` | `parent1_child1` child records (all replaced on update) |
| `parent1_child2s` | `object[]` | `parent1_child2` child records (all replaced on update) |
| `parent1_lists` | `object[]` | `parent1_list` child records (all replaced on update) |

**Response `201 Created`** — the newly created record object.

### GET /api/parent1/[id]

Retrieve a single `Parent1` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/parent1/[id]

Replace an existing `Parent1` record. Accepts the same body as `POST /api/parent1`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/parent1/[id]

Delete a `Parent1` record by its ID.

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

