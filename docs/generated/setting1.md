# Setting1

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `setting1` |
| Model | `xxxxx_xxxxx` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars |
| `description` | `string \| null` |  |  |  |
| `team` | `string \| null` |  |  |  |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `yyyyy_yyyyys` | [`yyyyy_yyyyy`](yyyyy_yyyyy.md) | one-to-many |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/setting1` | ✓ |
| New | `/en/setting1/new` | ✓ |
| Edit | `/en/setting1/edit/[id]` | ✓ |
| View | `/en/setting1/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/setting1

List all `Setting1` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "...",
    "description": null,
    "team": null
  }
]
```

### POST /api/setting1

Create a new `Setting1` record.

**Request Body**

```json
{
  "name": "...",
  "description": null,
  "team": null,
  "yyyyy_yyyyys": [{...}]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `yyyyy_yyyyys` | `object[]` | `yyyyy_yyyyy` child records (all replaced on update) |

**Response `201 Created`** — the newly created record object.

### GET /api/setting1/[id]

Retrieve a single `Setting1` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/setting1/[id]

Replace an existing `Setting1` record. Accepts the same body as `POST /api/setting1`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/setting1/[id]

Delete a `Setting1` record by its ID.

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

