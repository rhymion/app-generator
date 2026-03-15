# Setting2

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `setting2` |
| Model | `xxxxx_xxxxx` |
| Operations | List · View · Create |
| API | No |

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
| List | `/en/setting2` | ✓ |
| New | `/en/setting2/new` | ✓ |
| Edit | `/en/setting2/edit/[id]` | ✗ |
| View | `/en/setting2/view/[id]` | ✓ |

