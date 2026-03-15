# Product

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `product` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `code` | `string` | ✓ |  | min 1 chars |
| `name` | `string` | ✓ |  | min 1 chars |
| `price` | `number` | ✓ |  | min: 0 |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `images` | [`product_image`](product_image.md) | one-to-many · `list` |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/product` | ✓ |
| New | `/en/product/new` | ✓ |
| Edit | `/en/product/edit/[id]` | ✓ |
| View | `/en/product/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/product

List all `Product` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "code": "...",
    "name": "...",
    "price": 0
  }
]
```

### POST /api/product

Create a new `Product` record.

**Request Body**

```json
{
  "code": "...",
  "name": "...",
  "price": 0,
  "images": [{...}]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `images` | `object[]` | `product_image` child records (all replaced on update) |

**Response `201 Created`** — the newly created record object.

### GET /api/product/[id]

Retrieve a single `Product` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/product/[id]

Replace an existing `Product` record. Accepts the same body as `POST /api/product`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/product/[id]

Delete a `Product` record by its ID.

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

