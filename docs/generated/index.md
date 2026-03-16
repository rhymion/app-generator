# API & UI Reference

> Auto-generated — run the code generator to update this file. Do not edit manually.

This reference documents all generated entities: their UI pages and REST API endpoints.

## Entities

| Entity | Operations | API | Chart | Detail |
|--------|-----------|:---:|:-----:|--------|
| [Db Table](db_table.md) | List · View · Create · Update · Delete | ✓ |  | [→](db_table.md) |
| [Xxxxx Xxxxx](xxxxx_xxxxx.md) | List · View · Create · Update · Delete | ✓ |  | [→](xxxxx_xxxxx.md) |
| [Parent1](parent1.md) | List · View · Create · Update · Delete | ✓ |  | [→](parent1.md) |
| [Parent Only](parent_only.md) | List · View · Create · Update · Delete | ✓ |  | [→](parent_only.md) |
| [User Account](user_account.md) | List · View · Update · Delete | ✓ |  | [→](user_account.md) |
| [Setting](setting.md) | List · View · Update | ✓ |  | [→](setting.md) |
| [Setting1](setting1.md) | List · View · Create · Update · Delete | ✓ |  | [→](setting1.md) |
| [Setting2](setting2.md) | List · View · Create |  |  | [→](setting2.md) |
| [Setting3](setting3.md) | List · Update · Delete |  |  | [→](setting3.md) |
| [Setting4](setting4.md) | List | ✓ |  | [→](setting4.md) |
| [Setting5](setting5.md) | View · Update | ✓ |  | [→](setting5.md) |
| [Setting6](setting6.md) | View · Delete |  |  | [→](setting6.md) |
| [Setting7](setting7.md) | Create · Update |  |  | [→](setting7.md) |
| [Setting8](setting8.md) | Create · Delete | ✓ |  | [→](setting8.md) |
| [Role](role.md) | List · View · Create · Update · Delete | ✓ |  | [→](role.md) |
| [Organization](organization.md) | List · View · Create · Update · Delete | ✓ |  | [→](organization.md) |
| [Permission](permission.md) | List · View · Create · Update · Delete | ✓ |  | [→](permission.md) |
| [Procedure](procedure.md) | List · View · Create · Update · Delete | ✓ |  | [→](procedure.md) |
| [Resource](resource.md) | List · View · Create · Update · Delete | ✓ |  | [→](resource.md) |
| [Booking](booking.md) | List · View · Create · Update · Delete | ✓ | ✓ | [→](booking.md) |
| [Shift Template](shift_template.md) | List · View · Create · Update · Delete | ✓ |  | [→](shift_template.md) |
| [Shift](shift.md) | List · View · Create · Update · Delete | ✓ | ✓ | [→](shift.md) |
| [Product](product.md) | List · View · Create · Update · Delete | ✓ |  | [→](product.md) |
| [Inventory](inventory.md) | List · View · Create · Update · Delete | ✓ |  | [→](inventory.md) |
| [Purchase Order](purchase_order.md) | List · View · Create · Update · Delete | ✓ |  | [→](purchase_order.md) |

## UI Conventions

All UI pages are served under the locale prefix (default: `/en/`).

| Pattern | Description |
|---------|-------------|
| `/en/{entity}` | List page — searchable DataGrid of all records |
| `/en/{entity}/new` | Create form |
| `/en/{entity}/edit/[id]` | Edit form |
| `/en/{entity}/view/[id]` | Read-only detail view |
| `/en/{entity}/chart` | Gantt chart (only for chart-enabled entities) |

## API Authentication

All API endpoints are located under `/api/` (no locale prefix).

Authenticate by including **one** of the following headers:

```
X-API-Key: <your-api-key>
```
```
Authorization: Bearer <your-api-key>
```

API keys are stored in `user_account.api_key` and prefixed with `mk_`.
Obtain or regenerate a key from the User Account edit page.

## API Conventions

### Single-resource endpoints

| Method | Path | Operation |
|--------|------|-----------|
| `GET` | `/api/{entity}` | List all records (permission-filtered) |
| `POST` | `/api/{entity}` | Create a new record |
| `GET` | `/api/{entity}/[id]` | Get a single record |
| `PUT` | `/api/{entity}/[id]` | Replace a record |
| `DELETE` | `/api/{entity}/[id]` | Delete a record |

### Bulk endpoints

Bulk endpoints are generated alongside any entity that has at least one of create / update / delete enabled.

| Method | Path | Operation |
|--------|------|-----------|
| `POST` | `/api/{entity}/bulk` | Bulk-create records |
| `PUT` | `/api/{entity}/bulk` | Bulk-update records |
| `DELETE` | `/api/{entity}/bulk` | Bulk-delete records |

Bulk endpoints always return **`207 Multi-Status`** (when auth succeeds) with the shape:

```json
{
  "results": [
    { "index": 0, "success": true,  "data": { ... } },
    { "index": 1, "success": false, "error": "Not found: clxxx..." }
  ],
  "summary": { "total": 2, "succeeded": 1, "failed": 1 }
}
```

Each item in the request array is processed independently — one failure does not prevent
the others from succeeding. See each entity's detail page for the exact request body shape.

**Standard error shape**: `{ "error": "<message>" }`

| Status | Meaning |
|--------|---------|
| `400` | Validation error |
| `401` | Missing or invalid API key |
| `403` | Insufficient permission |
| `404` | Record not found |
| `500` | Unexpected server error |

## Permissions

Permissions are role-based. Each entity has four permission slots — `create`, `read`, `update`, `delete` — that can be granted at three scopes:

| Scope | Meaning |
|-------|---------|
| **General** | Access to all records |
| **Creator** | Access only to records the user created |
| **Assignee** | Access only to records assigned to the user |

Permissions are managed via the **Role** and **Permission** entities.
