# Parent Only

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `parent_only` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars |
| `description` | `string \| null` |  |  |  |
| `login_time` | `datetime \| null` |  |  |  |
| `logout_time` | `datetime \| null` |  |  |  |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

_(none)_

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/parent_only` | ✓ |
| New | `/en/parent_only/new` | ✓ |
| Edit | `/en/parent_only/edit/[id]` | ✓ |
| View | `/en/parent_only/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/parent_only

List all `Parent Only` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "...",
    "description": null,
    "login_time": "2024-01-01T00:00:00.000Z",
    "logout_time": "2024-01-01T00:00:00.000Z"
  }
]
```

### POST /api/parent_only

Create a new `Parent Only` record.

**Request Body**

```json
{
  "name": "...",
  "description": null,
  "login_time": "2024-01-01T00:00:00.000Z",
  "logout_time": "2024-01-01T00:00:00.000Z"
}
```


**Response `201 Created`** — the newly created record object.

### GET /api/parent_only/[id]

Retrieve a single `Parent Only` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/parent_only/[id]

Replace an existing `Parent Only` record. Accepts the same body as `POST /api/parent_only`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/parent_only/[id]

Delete a `Parent Only` record by its ID.

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

