# Shift Template

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `shift_template` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `user_account_id` | `string` | ✓ |  | FK → [user_account](user_account.md) (label: `name`), CUID |
| `day_of_week` | `integer` | ✓ |  | min: 0, max: 6, values: `Sunday`, `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday` |
| `start_time` | `time` | ✓ |  |  |
| `end_time` | `time` | ✓ |  |  |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `user_account_id` | [`user_account`](user_account.md) | many-to-one |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/shift_template` | ✓ |
| New | `/en/shift_template/new` | ✓ |
| Edit | `/en/shift_template/edit/[id]` | ✓ |
| View | `/en/shift_template/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/shift_template

List all `Shift Template` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "user_account_id": "...",
    "day_of_week": 0,
    "start_time": "09:00:00",
    "end_time": "09:00:00"
  }
]
```

### POST /api/shift_template

Create a new `Shift Template` record.

**Request Body**

```json
{
  "user_account_id": "...",
  "day_of_week": Sunday,
  "start_time": "09:00:00",
  "end_time": "09:00:00"
}
```


**Response `201 Created`** — the newly created record object.

### GET /api/shift_template/[id]

Retrieve a single `Shift Template` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/shift_template/[id]

Replace an existing `Shift Template` record. Accepts the same body as `POST /api/shift_template`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/shift_template/[id]

Delete a `Shift Template` record by its ID.

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

