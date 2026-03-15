# Xxxxx Xxxxx

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `xxxxx_xxxxx` |
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
| List | `/en/xxxxx_xxxxx` | ✓ |
| New | `/en/xxxxx_xxxxx/new` | ✓ |
| Edit | `/en/xxxxx_xxxxx/edit/[id]` | ✓ |
| View | `/en/xxxxx_xxxxx/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/xxxxx_xxxxx

List all `Xxxxx Xxxxx` records the authenticated user has permission to read.

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

### POST /api/xxxxx_xxxxx

Create a new `Xxxxx Xxxxx` record.

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

### GET /api/xxxxx_xxxxx/[id]

Retrieve a single `Xxxxx Xxxxx` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/xxxxx_xxxxx/[id]

Replace an existing `Xxxxx Xxxxx` record. Accepts the same body as `POST /api/xxxxx_xxxxx`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/xxxxx_xxxxx/[id]

Delete a `Xxxxx Xxxxx` record by its ID.

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

