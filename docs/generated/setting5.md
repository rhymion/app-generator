# Setting5

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `setting5` |
| Model | `xxxxx_xxxxx` |
| Operations | View · Update |
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
| List | `/en/setting5` | ✗ |
| New | `/en/setting5/new` | ✗ |
| Edit | `/en/setting5/edit/[id]` | ✓ |
| View | `/en/setting5/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/setting5/[id]

Retrieve a single `Setting5` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/setting5/[id]

Replace an existing `Setting5` record. Accepts the same body as `POST /api/setting5`.

**Response `200 OK`**

```json
{ "success": true }
```

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

### PUT /api/setting5/bulk

Bulk-update `Setting5` records. Each element must include `id` in addition to the
fields accepted by `PUT /api/setting5/[id]`.

**Request Body** — array of update objects:

```json
[
  { "id": "clxxx...", 
    "name": "...",
    "yyyyy_yyyyys": [{...}]
  },
  { "id": "clyyy...", "..." : "..." }
]
```

**Response `207`** — `data` of each successful item is `{ "success": true }`.
Items with an unknown `id` report `"error": "Not found: <id>"`.

