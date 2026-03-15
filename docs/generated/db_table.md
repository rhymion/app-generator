# Db Table

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `db_table` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars |
| `description` | `string \| null` |  |  |  |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `fields` | [`field`](field.md) | one-to-many |
| `db_table_comments` | [`db_table_comment`](db_table_comment.md) | one-to-many · `comments` |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/db_table` | ✓ |
| New | `/en/db_table/new` | ✓ |
| Edit | `/en/db_table/edit/[id]` | ✓ |
| View | `/en/db_table/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/db_table

List all `Db Table` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "...",
    "description": null
  }
]
```

### POST /api/db_table

Create a new `Db Table` record.

**Request Body**

```json
{
  "name": "...",
  "description": null,
  "fields": [{...}]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `fields` | `object[]` | `field` child records (all replaced on update) |

**Response `201 Created`** — the newly created record object.

### GET /api/db_table/[id]

Retrieve a single `Db Table` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/db_table/[id]

Replace an existing `Db Table` record. Accepts the same body as `POST /api/db_table`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/db_table/[id]

Delete a `Db Table` record by its ID.

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

