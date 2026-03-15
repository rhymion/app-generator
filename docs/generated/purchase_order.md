# Purchase Order

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `purchase_order` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `order_no` | `string` | ✓ |  | min 1 chars |
| `customer_id` | `string` | ✓ |  | FK → [user_account](user_account.md) (label: `name`), CUID |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `customer_id` | [`user_account`](user_account.md) | many-to-one |
| `items` | [`purchase_per_item`](purchase_per_item.md) | one-to-many |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/purchase_order` | ✓ |
| New | `/en/purchase_order/new` | ✓ |
| Edit | `/en/purchase_order/edit/[id]` | ✓ |
| View | `/en/purchase_order/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/purchase_order

List all `Purchase Order` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "order_no": "...",
    "customer_id": "..."
  }
]
```

### POST /api/purchase_order

Create a new `Purchase Order` record.

**Request Body**

```json
{
  "order_no": "...",
  "customer_id": "...",
  "items": [{...}]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `items` | `object[]` | `purchase_per_item` child records (all replaced on update) |

**Response `201 Created`** — the newly created record object.

### GET /api/purchase_order/[id]

Retrieve a single `Purchase Order` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/purchase_order/[id]

Replace an existing `Purchase Order` record. Accepts the same body as `POST /api/purchase_order`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/purchase_order/[id]

Delete a `Purchase Order` record by its ID.

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

