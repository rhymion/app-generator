# Permission

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `permission` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars |
| `create` | `boolean` | ✓ |  |  |
| `read` | `boolean` | ✓ |  |  |
| `update` | `boolean` | ✓ |  |  |
| `delete` | `boolean` | ✓ |  |  |
| `role_id` | `string \| null` |  |  | FK → [role](role.md) (label: `name`), CUID |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `role_id` | [`role`](role.md) | many-to-one |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/permission` | ✓ |
| New | `/en/permission/new` | ✓ |
| Edit | `/en/permission/edit/[id]` | ✓ |
| View | `/en/permission/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/permission

List all `Permission` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "...",
    "create": false,
    "read": false,
    "update": false,
    "delete": false,
    "role_id": null
  }
]
```

### POST /api/permission

Create a new `Permission` record.

**Request Body**

```json
{
  "name": "...",
  "create": false,
  "read": false,
  "update": false,
  "delete": false,
  "role_id": null
}
```


**Response `201 Created`** — the newly created record object.

### GET /api/permission/[id]

Retrieve a single `Permission` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/permission/[id]

Replace an existing `Permission` record. Accepts the same body as `POST /api/permission`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/permission/[id]

Delete a `Permission` record by its ID.

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

