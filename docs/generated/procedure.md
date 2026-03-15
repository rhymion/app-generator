# Procedure

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `procedure` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars |
| `description` | `string \| null` |  |  |  |
| `parent_id` | `string \| null` |  |  | FK → [procedure](procedure.md) (label: `name`), CUID |
| `assignee_id` | `string \| null` |  |  | FK → [user_account](user_account.md) (label: `name`), CUID |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `parent_id` | [`procedure`](procedure.md) | many-to-one |
| `assignee_id` | [`user_account`](user_account.md) | many-to-one |
| `children` | [`procedure`](procedure.md) | one-to-many · `list` |
| `preceded_by` | [`procedure`](procedure.md) | many-to-many · `list` |
| `followed_by` | [`procedure`](procedure.md) | many-to-many · `list` |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/procedure` | ✓ |
| New | `/en/procedure/new` | ✓ |
| Edit | `/en/procedure/edit/[id]` | ✓ |
| View | `/en/procedure/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/procedure

List all `Procedure` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "...",
    "description": null,
    "parent_id": null,
    "assignee_id": null
  }
]
```

### POST /api/procedure

Create a new `Procedure` record.

**Request Body**

```json
{
  "name": "...",
  "description": null,
  "parent_id": null,
  "assignee_id": null,
  "children_ids": ["clxxx..."],
  "precededBy_ids": ["clxxx..."],
  "followedBy_ids": ["clxxx..."]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `children_ids` | `string[]` | IDs of `procedure` records to associate (replaces existing) |
| `precededBy_ids` | `string[]` | IDs of `procedure` records to associate (replaces existing) |
| `followedBy_ids` | `string[]` | IDs of `procedure` records to associate (replaces existing) |

**Response `201 Created`** — the newly created record object.

### GET /api/procedure/[id]

Retrieve a single `Procedure` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/procedure/[id]

Replace an existing `Procedure` record. Accepts the same body as `POST /api/procedure`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/procedure/[id]

Delete a `Procedure` record by its ID.

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

