# Tip Tx

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `tip_tx` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `gross_amount` | `number` | ✓ |  | min: 0 |
| `operator_fee` | `number` | ✓ |  | min: 0 |
| `payment_fee` | `number` | ✓ |  | min: 0 |
| `contract_split_id` | `string` | ✓ |  | min 1 chars |
| `status` | `integer` | ✓ |  | min: 0, max: 2, values: `pending`, `held`, `paid` |
| `comment_id` | `string` | ✓ |  | FK → [comment](comment.md) (label: `message`), CUID |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `comment_id` | [`comment`](comment.md) | many-to-one |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/tip_tx` | ✓ |
| New | `/en/tip_tx/new` | ✓ |
| Edit | `/en/tip_tx/edit/[id]` | ✓ |
| View | `/en/tip_tx/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user.api_key` and start with the `mk_` prefix.

---

### GET /api/tip_tx

List all `Tip Tx` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "gross_amount": 0,
    "operator_fee": 0,
    "payment_fee": 0,
    "contract_split_id": "...",
    "status": 0,
    "comment_id": "..."
  }
]
```

### POST /api/tip_tx

Create a new `Tip Tx` record.

**Request Body**

```json
{
  "gross_amount": 0,
  "operator_fee": 0,
  "payment_fee": 0,
  "contract_split_id": "...",
  "status": pending,
  "comment_id": "..."
}
```


**Response `201 Created`** — the newly created record object.

### GET /api/tip_tx/[id]

Retrieve a single `Tip Tx` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/tip_tx/[id]

Replace an existing `Tip Tx` record. 
Accepts the same body as `POST /api/tip_tx`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/tip_tx/[id]

Delete a `Tip Tx` record by its ID.

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

---

## Bulk Operations

Bulk endpoints process each item independently, enabling **partial success**. The outer
request always returns `207 Multi-Status` as long as authentication passes; individual
item outcomes are reported in the `results` array.

### Response shape (`207 Multi-Status`)

```json
{
  "results": [
    { "index": 0, "success": true,  "data": { ... } },
    { "index": 1, "success": false, "error": "Not found: clxxx..." }
  ],
  "summary": { "total": 2, "succeeded": 1, "failed": 1 }
}
```

> Auth/permission failures at the **request** level (bad key, no permission at all) still
> return `401` / `403` — not `207`.

### POST /api/tip_tx/bulk

Bulk-create `Tip Tx` records. Each element in the request array is processed with
the same rules as `POST /api/tip_tx`.

**Request Body** — array of create objects:

```json
[
  {
    "gross_amount": 0,
    "operator_fee": 0,
    "payment_fee": 0,
    "contract_split_id": "...",
    "status": pending,
    "comment_id": "..."
  },
  { "..." : "..." }
]
```

**Response `207`** — `data` of each successful item contains `{ "id": "..." }`.

### PUT /api/tip_tx/bulk

Bulk-update `Tip Tx` records. Each element must include `id` in addition to the
fields accepted by `PUT /api/tip_tx/[id]`.

**Request Body** — array of update objects:

```json
[
  { "id": "clxxx...", 
    "gross_amount": 0,
    "operator_fee": 0,
    "payment_fee": 0,
    "contract_split_id": "...",
    "status": pending,
    "comment_id": "..."
  },
  { "id": "clyyy...", "..." : "..." }
]
```

**Response `207`** — `data` of each successful item is `{ "success": true }`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

### DELETE /api/tip_tx/bulk

Bulk-delete `Tip Tx` records by ID.

**Request Body** — array of id objects:

```json
[
  { "id": "clxxx..." },
  { "id": "clyyy..." }
]
```

**Response `207`** — `data` of each successful item is `null`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

