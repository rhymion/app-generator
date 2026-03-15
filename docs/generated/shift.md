# Shift

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `shift` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |
| Chart | `week` view, grouped by `user_account` |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `user_account_id` | `string` | ✓ |  | FK → [user_account](user_account.md) (label: `name`), CUID |
| `start_time` | `datetime` | ✓ |  |  |
| `end_time` | `datetime` | ✓ |  |  |
| `status` | `integer` | ✓ |  | min: 0, max: 2, values: `Scheduled`, `Approved`, `Cancelled` |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `user_account_id` | [`user_account`](user_account.md) | many-to-one |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/shift` | ✓ |
| New | `/en/shift/new` | ✓ |
| Edit | `/en/shift/edit/[id]` | ✓ |
| View | `/en/shift/view/[id]` | ✓ |
| Chart | `/en/shift/chart` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/shift

List all `Shift` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "user_account_id": "...",
    "start_time": "2024-01-01T00:00:00.000Z",
    "end_time": "2024-01-01T00:00:00.000Z",
    "status": 0
  }
]
```

### POST /api/shift

Create a new `Shift` record.

**Request Body**

```json
{
  "user_account_id": "...",
  "start_time": "2024-01-01T00:00:00.000Z",
  "end_time": "2024-01-01T00:00:00.000Z",
  "status": Scheduled
}
```


**Response `201 Created`** — the newly created record object.

### GET /api/shift/[id]

Retrieve a single `Shift` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/shift/[id]

Replace an existing `Shift` record. Accepts the same body as `POST /api/shift`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/shift/[id]

Delete a `Shift` record by its ID.

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

