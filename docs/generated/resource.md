# Resource

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `resource` |
| Operations | List · View · Create · Update · Delete |
| API | Yes — see [API Reference](#api-reference) below |

## Fields

| Field | Type | Required | Read-only | Notes |
|-------|------|:--------:|:---------:|-------|
| `id` | `string` | ✓ | ✓ | CUID |
| `name` | `string` | ✓ |  | min 1 chars |
| `description` | `string \| null` |  |  |  |
| `organization_id` | `string` | ✓ |  | FK → [organization](organization.md) (label: `name`), CUID |

> **Read-only** fields (`id`, `creator_id`, `created_at`, `updated_at`) are set automatically and cannot be written through the API or UI forms.

## Relationships

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `organization_id` | [`organization`](organization.md) | many-to-one |
| `resource_attachments` | [`resource_attachment`](resource_attachment.md) | one-to-many · `list` |
| `resource_images` | [`resource_image`](resource_image.md) | one-to-many · `list` |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/resource` | ✓ |
| New | `/en/resource/new` | ✓ |
| Edit | `/en/resource/edit/[id]` | ✓ |
| View | `/en/resource/view/[id]` | ✓ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### GET /api/resource

List all `Resource` records the authenticated user has permission to read.

**Response `200 OK`**

```json
[
  {
    "id": "clxxxxxxxxxxxxxxxxxxxxxxxx",
    "name": "...",
    "description": null,
    "organization_id": "..."
  }
]
```

### POST /api/resource

Create a new `Resource` record.

**Request Body**

```json
{
  "name": "...",
  "description": null,
  "organization_id": "...",
  "resource_attachments": [{...}],
  "resource_images": [{...}]
}
```

**Child / association fields**

| Field | Type | Description |
|-------|------|-------------|
| `resource_attachments` | `object[]` | `resource_attachment` child records (all replaced on update) |
| `resource_images` | `object[]` | `resource_image` child records (all replaced on update) |

**Response `201 Created`** — the newly created record object.

### GET /api/resource/[id]

Retrieve a single `Resource` record by its ID.

**Response `200 OK`** — the record object (same shape as a list item).

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### PUT /api/resource/[id]

Replace an existing `Resource` record. Accepts the same body as `POST /api/resource`.

**Response `200 OK`**

```json
{ "success": true }
```

**Response `404 Not Found`**

```json
{ "error": "Not found" }
```

### DELETE /api/resource/[id]

Delete a `Resource` record by its ID.

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

