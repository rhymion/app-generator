# Inventory

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `inventory` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `product_id` | `string` | ✓ |  | FK → [product](product.md) (label: `name`), CUID |
| `quantity` | `number` | ✓ |  | min: 0 |
| `reserved_quantity` | `number` | ✓ |  | min: 0 |
| `location` | `string \| null` |  |  |  |
| `lot_number` | `string \| null` |  |  |  |
| `expiration_date` | `date \| null` |  |  |  |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `product_id` | [`product`](product.md) | many-to-one |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/inventory` | ✓ |
| New | `/en/inventory/new` | ✓ |
| Edit | `/en/inventory/edit/[id]` | ✓ |
| View | `/en/inventory/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/inventory

List all `Inventory` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "product_id": "...",
    "quantity": 0,
    "reserved_quantity": 0,
    "location": null,
    "lot_number": null,
    "expiration_date": null
  }
]
```

### POST /api/inventory

Create a new `Inventory` record.

**Request Body**

```json
{
  "product_id": "...",
  "quantity": 0,
  "reserved_quantity": 0,
  "location": null,
  "lot_number": null,
  "expiration_date": "2024-01-01"
}
```


**Response `201 Created`** — the newly created record object.

### GET /api/inventory/[id]

Retrieve a single `Inventory` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/inventory/[id]

Replace an existing `Inventory` record. Accepts the same body as `POST /api/inventory`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/inventory/[id]

Delete a `Inventory` record by its ID.

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

