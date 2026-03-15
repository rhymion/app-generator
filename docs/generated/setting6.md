# Setting6

> Auto-generated — run the code generator to update this file. Do not edit manually.

## Overview

| | |
|---|---|
| Entity | `setting6` |
| Model | `xxxxx_xxxxx` |
| Operations | View · Delete |
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

| Field / Property | Target Entity | Relationship Type |
|-----------------|---------------|-------------------|
| `yyyyy_yyyyys` | [`yyyyy_yyyyy`](yyyyy_yyyyy.md) | one-to-many |

## UI Pages

| Page | URL | Enabled |
|------|-----|:-------:|
| List | `/en/setting6` | ✗ |
| New | `/en/setting6/new` | ✗ |
| Edit | `/en/setting6/edit/[id]` | ✗ |
| View | `/en/setting6/view/[id]` | ✓ |

