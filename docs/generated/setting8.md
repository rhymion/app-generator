# Setting8

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `setting8` |
| Model | `xxxxx_xxxxx` |
| Operations | Create · Delete |
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

_(none)_

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/setting8` | ✗ |
| New | `/en/setting8/new` | ✓ |
| Edit | `/en/setting8/edit/[id]` | ✗ |
| View | `/en/setting8/view/[id]` | ✗ |

## API Reference

### Authentication

All endpoints require one of:

| Header | Format | Example |
|--------|--------|---------|
| `X-API-Key` | `<key>` | `X-API-Key: mk_abc123...` |
| `Authorization` | `Bearer <key>` | `Authorization: Bearer mk_abc123...` |

API keys are stored in `user_account.api_key` and start with the `mk_` prefix.

---

### POST /api/setting8

Create a new `Setting8` record.

**Request Body**

```json
{
  "name": "...",
  "description": null
}
```


**Response `201 Created`** — the newly created record object.

### DELETE /api/setting8/[id]

Delete a `Setting8` record by its ID.

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

