# Schema YAML Configuration Guide

The code generator reads YAML files under `code_generator/` to produce TypeScript source files,
React components, API routes, and Cypress tests. This document explains every configuration
option, what it means, and what code it produces.

---

## 1. File Overview

Currently one schema file drives generation:

| File | Purpose |
|---|---|
| `code_generator/json_schema_db_table.yaml` | All application entities |

The file follows JSON Schema Draft-07 with custom `x-*` extension keywords.

---

## 2. Top-Level Structure

```yaml
$schema: "http://json-schema.org/draft-07/schema#"

definitions:
  some_entity:           # base entity — shared shape, no generation config
    type: object
    ...

  some_entity_detail:    # detail entity — triggers code generation
    x-generate: ...      # generation flags
    allOf:
      - $ref: "#/definitions/some_entity"
      - type: object
        properties:
          children: ...  # child collections added here
```

### Base entity vs detail entity

| Concept | Key | Purpose |
|---|---|---|
| Base entity | `some_entity` | Defines the core field set; used as `$ref` target |
| Detail entity | `some_entity_detail` | Extends the base and carries `x-generate` (or `x-generate` appears directly on the base in `parent_only` style — see §3) |
| Child model | `some_child` | Defines a child row's fields; no `x-generate` |

The generator always looks for a definition whose name ends in `_detail` (or that directly has
`x-generate`) to determine what to generate. The base entity name (without `_detail`) becomes
the Prisma model name and the TypeScript type name.

---

## 3. `x-generate` — Generation Flags

Place `x-generate` on the detail definition (or the base definition if there are no children).

```yaml
booking_detail:
  x-generate:
    list:       true   # Generate list page
    view:       true   # Generate view page + FormView component
    new:        true   # Generate create (new) page
    edit:       true   # Generate edit page
    delete:     true   # Generate delete button + handler
    invalidate: false  # Revalidate Next.js cache after mutations (rarely needed)
    api:        true   # Generate REST API routes
    test:       true   # Generate Cypress E2E and API tests
    fields:            # Optional: field whitelist (see §3.1)
      - name
      - resource_id
```

### What each flag generates

| Flag | Generated files |
|---|---|
| `list: true` | `app/[locale]/{entity}/page.tsx` (DataGrid list page) |
| `view: true` | `app/[locale]/{entity}/view/[id]/page.tsx` + `components/{entity}/FormView.tsx` |
| `new: true` | `app/[locale]/{entity}/new/page.tsx` |
| `edit: true` | `app/[locale]/{entity}/edit/[id]/page.tsx` |
| Any of new/edit/delete | `lib/{entity}/types.ts`, `lib/{entity}/getters.ts`, `lib/{entity}/service.ts`, `lib/{entity}/actions.ts`, `components/{entity}/FormUpsert.tsx` |
| `api: true` | `app/api/{entity}/route.ts`, `app/api/{entity}/[id]/route.ts` |
| `test: true` | `cypress/support/{entity}/helper.ts`, `cypress/e2e/{entity}.cy.ts`, `cypress/e2e/api/{entity}.cy.ts` (if `api: true` too) |

Files that are **never overwritten** (extension points):
- `lib/{entity}/service_validation.ts`
- `components/{entity}/form_validation.ts`
- `components/{entity}/{FieldName}.tsx`
- `components/{entity}/{ComponentName}.tsx`

These stubs are created once on first generation and then left alone.

### 3.1 `fields` whitelist

When `fields` is provided only those properties appear in the form and view pages.
`id`, `created_at`, `updated_at`, and `creator_id` are always included regardless.

```yaml
x-generate:
  fields:
    - name
    - description
```

Use this to hide internal or irrelevant fields from the UI while keeping them in the database.

### 3.2 `parent_only` pattern

If there are no child collections the detail entity can be omitted entirely. Place `x-generate`
directly on the base definition:

```yaml
parent_only:
  x-generate:
    list: true
    view: true
    ...
  type: object
  properties:
    ...
```

---

## 4. Field Definitions

Each field under `properties` maps to a Prisma column and a TypeScript type.

### 4.1 Standard field types

| JSON Schema `type` + `format` | TypeScript type | Prisma type | Notes |
|---|---|---|---|
| `string` | `string` | `String` | |
| `string` (nullable) | `string \| null` | `String?` | |
| `string` + `format: date-time` | `Date` | `DateTime @db.Timestamptz(3)` | Full timestamp with timezone |
| `string` + `format: date` | `Date` | `DateTime @db.Timestamptz(3)` | Date only; stored as midnight UTC |
| `string` + `format: time` | `Date` | `DateTime @db.Timetz(0)` | Time only |
| `string` + `format: uri` | `string` | `String?` | URL; rendered as image or link |
| `integer` or `number` | `number` | `Int` or `Float` | |
| `boolean` | `boolean` | `Boolean` | |

Nullable types: include `"null"` in a type array.

```yaml
description:
  type:
    - string
    - "null"
```

### 4.2 Validation constraints

These are enforced only in the frontend form; the generator does not add Prisma-level
constraints beyond what the Prisma schema already defines.

| Keyword | Effect in generated form |
|---|---|
| `minLength` | Input required to be at least N characters |
| `maxLength` | Input capped at N characters |
| `minimum` / `maximum` | Number field min/max |
| `pattern` | Regex pattern (mainly used for CUID id fields — not shown in form) |
| `format: date-time` | Renders MUI X DateTimePicker |
| `format: date` | Renders MUI X DatePicker |
| `format: time` | Renders MUI X TimePicker |
| `format: uri` | Renders image preview or link |
| `format: regex` | Hint that the value is a regex; rendered as text input |
| `default` | Pre-fills the field in new form |

### 4.3 Enum fields

```yaml
type:
  type: string
  enum:
    - string
    - number
    - boolean
    - date
```

Generates a `<Select>` component. Labels are derived from the enum values by title-casing.

Integer enum (enum values are shown as labels, array index is the stored value):

```yaml
day_of_week:
  type: integer
  minimum: 0
  maximum: 6
  enum:
    - Sunday
    - Monday
    - Tuesday
    - Wednesday
    - Thursday
    - Friday
    - Saturday
```

Prisma stores a plain `Int`. The generator maps index → label in both the form and the list page.

### 4.4 The `id` field

Every entity must have an `id` field:

```yaml
id:
  type: string
  pattern: "^c[a-z0-9]{24,}$"
```

Prisma counterpart uses `@id @default(cuid())`. The pattern is a CUID format check; the
generator uses it only to identify the ID field, not for client validation.

---

## 5. Many-to-One Relationships (`x-relationship`)

Declare a many-to-one FK field on the **base entity**:

```yaml
resource_id:
  type: string
  pattern: "^c[a-z0-9]{24,}$"
  x-relationship:
    type: many-to-one
    target: resource      # name of the target base entity definition
    labelField: name      # property on the target used as display label
```

Add the resolved object to the **detail entity**:

```yaml
booking_detail:
  allOf:
    - $ref: "#/definitions/booking"
    - type: object
      properties:
        resource:
          $ref: "#/definitions/resource"   # resolved object included here
```

### What this generates

**`types.ts`**
```typescript
export type ResourceOption = { id: string; name: string };  // labelField drives this

export type FormUpsertProps = Readonly<FormViewProps & {
  allResources?: Resource[];
  resourcePermissions?: ModelPermissions;
}>;
```

**`FormUpsert.tsx`** — renders an MUI Autocomplete:
```tsx
<Autocomplete
  options={allResources}
  getOptionLabel={r => r.name}     // labelField
  value={resourceOption}
  onChange={(_, r) => setResourceOption(r)}
/>
```

**`service.ts`** — writes the FK on create/update:
```typescript
data: { ..., resource_id: resource_id }
```

### Prisma alignment

The FK field name in the schema must exactly match the column name in Prisma:

```prisma
model booking {
  resource_id  String
  resource     resource @relation(fields: [resource_id], references: [id], onDelete: Cascade)
}
```

The resolved-object property (`resource`) must appear in the `_detail` definition as a `$ref`.
If it is missing, the generator will not include it in `include:` clauses.

---

## 6. Many-to-Many Relationships (`x-relationships`)

Declare on the **detail entity** using `x-relationships` (plural):

```yaml
user_account_detail:
  x-relationships:
    roles:                      # property name in the detail definition
      type: many-to-many
      target: role
  allOf:
    - $ref: "#/definitions/user_account"
    - type: object
      properties:
        roles:
          type: array
          x-outputType: list    # see §8
          items:
            $ref: "#/definitions/role"
```

### What this generates

**`service.ts`** — uses Prisma `.set()` (connect existing records):
```typescript
data: {
  roles: { set: roleIds.map(id => ({ id })) }
}
```

**`FormUpsert.tsx`** — renders a multi-select Autocomplete.

### Prisma alignment

Prisma must declare an implicit many-to-many:

```prisma
model user_account {
  roles role[] @relation("UserRoles")
}
model role {
  user_accounts user_account[] @relation("UserRoles")
}
```

No explicit join table is needed — Prisma manages it. The relation name in quotes (`"UserRoles"`)
disambiguates when there are multiple relations between the same two models.

---

## 7. One-to-Many Children (Child Collections)

Add child models as array properties in the detail definition **without** `x-relationships`:

```yaml
db_table_detail:
  allOf:
    - $ref: "#/definitions/db_table"
    - type: object
      required:
        - fields
      properties:
        fields:
          type: array
          items:
            $ref: "#/definitions/field"   # child model definition
```

### What this generates

The generator detects that `field` belongs to `db_table_detail` and generates an editable
child DataGrid in `FormUpsert.tsx`. On save, children are created/updated/deleted together
with the parent in a transaction.

**`service.ts`** — uses `.create` / `.update` / `.deleteMany`:
```typescript
await prisma.field.deleteMany({ where: { db_table_id: id, id: { notIn: keptIds } } });
await prisma.field.createMany({ data: newChildren });
```

### Prisma alignment

The child model must have a FK column pointing to the parent with `onDelete: Cascade`:

```prisma
model field {
  db_table_id  String
  db_table     db_table @relation("ParentTable", fields: [db_table_id], references: [id], onDelete: Cascade)
}
```

The child model itself does **not** need `x-generate`. It is never generated as a standalone page.

---

## 8. `x-outputType` — Array Rendering Mode

Controls how an array property is displayed in forms and views.

```yaml
some_child_array:
  type: array
  x-outputType: list      # or "comments" or omit
  items:
    $ref: "#/definitions/some_child"
```

| Value | Description |
|---|---|
| _(omitted)_ | Editable DataGrid inline in `FormUpsert.tsx` (create/edit/delete rows) |
| `list` | Read-only list in `FormView.tsx` (e.g., related records fetched separately) |
| `comments` | Comment thread UI: text input + list with edit/delete per comment; dedicated server actions |

### `comments` detail

A comment array requires its child model to have a `message` field and a FK back to the parent:

```yaml
db_table_comment:
  type: object
  required:
    - id
    - message
    - db_table_id
  properties:
    message:
      type: string
      minLength: 1
    db_table_id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
```

The generator creates dedicated `addComment`, `editComment`, `deleteComment` server actions.

---

## 9. `x-fileType` — File Upload Children

```yaml
resource_attachments:
  type: array
  x-outputType: list
  x-fileType: file         # or "image"
  items:
    $ref: "#/definitions/resource_attachment"
```

| Value | Description |
|---|---|
| `file` | Generic file upload input; stored path as URI |
| `image` | Image upload input; preview thumbnail shown |

The child model must have `name` and `path` fields. `path` stores the uploaded file URL.

---

## 10. `x-display` — List Page and Chart Configuration

Place on the **base entity** definition (not the detail entity).

```yaml
booking:
  x-display:
    table:
      - name:
          primary: true    # marks the clickable column (navigates to view/edit)
          width: 200
      - resource:
          width: 200       # column label comes from the property name (title-cased)
      - start_time:
          width: 200
    chart:
      span: week           # "week" | "month" | "year"
      row_by: resource     # relationship name to group rows by
```

### Table configuration

`x-display.table` is an array of single-key objects. The key is a field or relationship name.

| Property | Meaning |
|---|---|
| `primary: true` | This column's cell links to the view or edit page |
| `width` | Pixel width of the DataGrid column |

If `x-display` is omitted entirely, the list page shows all fields in definition order.

When a table column refers to a relationship name (e.g., `resource`), the generator renders
`resource.name` (the `labelField`) in that column.

### Chart configuration

```yaml
chart:
  span: week         # view window: "week" (7 days) | "month" | "year"
  row_by: resource   # relationship name; each unique value becomes a row in the Gantt chart
```

`row_by` must be a many-to-one relationship name defined in the entity's properties.
The entity must have `start_time` and `end_time` fields.

**Generated files:**
- `lib/{entity}/chart-getters.ts` — query that builds `GanttItem[]`
- `app/[locale]/{entity}/chart/page.tsx` — page wrapping `<GanttChart>`

### Combining table and chart

| `x-display` config | List page | Chart page |
|---|---|---|
| Omitted | Generated (all columns) | Not generated |
| `table` only | Generated (specified columns) | Not generated |
| `chart` only | Not generated | Generated |
| Both `table` and `chart` | Generated (specified columns + Chart button) | Generated |

---

## 11. `x-custom-component` — Custom UI Elements

### On a field (skip default rendering)

```yaml
password:
  type: string
  x-custom-component:
    target:
      - upsert      # skip this field in FormUpsert; render your own component
      # - view      # skip in FormView
```

The generator emits no default input for this field in the targeted form. You implement the
custom component in the extension point file `components/{entity}/{FieldName}.tsx`.

### On the detail entity (add a button)

```yaml
shift_template_detail:
  x-custom-component:
    name: CopyShiftsButton    # component name to import and render
```

The generator imports `CopyShiftsButton` from `components/shift_template/CopyShiftsButton.tsx`
and renders it inside `FormView.tsx`. You implement this file manually (it is never overwritten).

---

## 12. `x-display` on Fields (Table Display Hints)

Some entities carry display metadata directly on the base definition:

```yaml
permission:
  x-display:
    table:
      - name:
          width: 200
      - role:
          width: 200
```

This is the same format as described in §10. It overrides column layout in the list page.

---

## 13. Prisma Schema Alignment Rules

The code generator and Prisma schema are independent but the generated application requires
them to match. Breaking alignment causes runtime Prisma errors.

### Field naming

Every property in the YAML definition must have a corresponding Prisma column with the same name:

```yaml
# YAML
name:
  type: string
```

```prisma
// Prisma
model some_entity {
  name String
}
```

### Nullable fields

A YAML field with `"null"` in its type array must be optional in Prisma:

```yaml
description:
  type:
    - string
    - "null"
```

```prisma
description  String?
```

### Timestamps

Every entity that has `created_at` or `updated_at` in the YAML should have the Prisma defaults:

```prisma
created_at DateTime @default(now())
updated_at DateTime @updatedAt
```

The generator always includes these in queries. If they are missing from Prisma, runtime errors occur.

### Date/time columns

| YAML format | Prisma annotation |
|---|---|
| `date-time` | `@db.Timestamptz(3)` |
| `date` | `@db.Timestamptz(3)` |
| `time` | `@db.Timetz(0)` |

Using `DateTime` without a `@db.*` annotation stores in local time, which causes timezone
bugs. Always add the annotation for any date or datetime field.

### Many-to-one FK fields

The `_id` field in YAML must appear as both a bare column and a relation in Prisma:

```yaml
# YAML
resource_id:
  x-relationship:
    type: many-to-one
    target: resource
```

```prisma
resource_id  String
resource     resource @relation(fields: [resource_id], references: [id], onDelete: Cascade)
```

`onDelete: Cascade` is the standard; use `onDelete: SetNull` when the FK is optional and the
parent can be deleted without removing the child.

### Many-to-many

Prisma implicit many-to-many (no join table defined) is used for `x-relationships`:

```prisma
model user_account {
  roles role[] @relation("UserRoles")
}
model role {
  user_accounts user_account[] @relation("UserRoles")
}
```

The relation name string in quotes must match on both sides.

### Child (one-to-many) collections

The child model must have a `{parent}_id` FK column and the parent must list the child array:

```prisma
model db_table {
  fields field[] @relation("ParentTable")  // parent side
}

model field {
  db_table_id  String
  db_table     db_table @relation("ParentTable", fields: [db_table_id], references: [id], onDelete: Cascade)
}
```

### Self-referential relations

```prisma
model procedure {
  parent_id String?
  parent    procedure?  @relation("ParentChild", fields: [parent_id], references: [id])
  children  procedure[] @relation("ParentChild")
  preceded_by  procedure[] @relation("BeforeAfter")
  followed_by  procedure[] @relation("BeforeAfter")
}
```

Self-referential many-to-many must declare both directions with the same relation name.

### Enum / integer enum

Enums stored as strings use `String` in Prisma. Enums stored as integers use `Int`.
No Prisma-level enum type is needed; the generator treats them as plain scalars.

### `creator_id` / `updater_id`

Every entity that should track who created/edited it must have these columns:

```prisma
creator_id String
creator    user_account @relation("SomeEntityCreator", fields: [creator_id], references: [id])
updater_id String
updater    user_account @relation("SomeEntityUpdater", fields: [updater_id], references: [id])
```

The generator always writes `creator_id` and `updater_id` on create/update. If the columns
are missing, Prisma will throw at runtime.

---

## 14. Complete Example Walkthrough

### Goal

Generate a `booking` entity with:
- Full CRUD pages
- REST API
- Cypress tests
- A many-to-one relationship to `resource`
- A chart view grouped by resource

### YAML

```yaml
resource:
  type: object
  required: [id, name, organization_id]
  properties:
    id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
    name:
      type: string
      minLength: 1
    organization_id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
      x-relationship:
        type: many-to-one
        target: organization
        labelField: name

booking:
  type: object
  required: [id, name, resource_id, start_time, end_time]
  x-display:
    table:
      - name:
          primary: true
          width: 200
      - resource:
          width: 200
      - start_time:
          width: 200
      - end_time:
          width: 200
    chart:
      span: week
      row_by: resource
  properties:
    id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
    name:
      type: string
      minLength: 1
    resource_id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
      x-relationship:
        type: many-to-one
        target: resource
        labelField: name
    start_time:
      type: string
      format: date-time
    end_time:
      type: string
      format: date-time

booking_detail:
  x-generate:
    list: true
    view: true
    new: true
    edit: true
    delete: true
    invalidate: false
    api: true
    test: true
  allOf:
    - $ref: "#/definitions/booking"
    - type: object
      required:
        - resource
      properties:
        resource:
          $ref: "#/definitions/resource"
```

### Required Prisma model

```prisma
model booking {
  id           String   @id @default(cuid())
  name         String
  resource_id  String
  resource     resource @relation(fields: [resource_id], references: [id], onDelete: Cascade)
  start_time   DateTime @db.Timestamptz(3)
  end_time     DateTime @db.Timestamptz(3)
  created_at   DateTime @default(now())
  updated_at   DateTime @updatedAt
  creator_id   String
  creator      user_account @relation("BookingCreator", fields: [creator_id], references: [id])
  updater_id   String
  updater      user_account @relation("BookingUpdater", fields: [updater_id], references: [id])
}
```

### Generated files

```
lib/booking/types.ts
lib/booking/getters.ts
lib/booking/service.ts
lib/booking/service_validation.ts        (stub — not overwritten)
lib/booking/actions.ts
lib/booking/chart-getters.ts
components/booking/FormUpsert.tsx
components/booking/FormView.tsx
components/booking/form_validation.ts    (stub — not overwritten)
app/[locale]/booking/page.tsx            (list with chart button)
app/[locale]/booking/new/page.tsx
app/[locale]/booking/edit/[id]/page.tsx
app/[locale]/booking/view/[id]/page.tsx
app/[locale]/booking/chart/page.tsx
app/api/booking/route.ts
app/api/booking/[id]/route.ts
cypress/support/booking/helper.ts
cypress/e2e/booking.cy.ts
cypress/e2e/api/booking.cy.ts
cypress/support/generated-tasks.ts       (updated)
```

---

## 15. Quick Reference

### `x-generate` flags

| Flag | `true` generates |
|---|---|
| `list` | List page (DataGrid) |
| `view` | View page + FormView |
| `new` | Create page |
| `edit` | Edit page |
| `delete` | Delete handler in actions + service |
| `api` | REST API routes |
| `test` | Cypress E2E + API tests |
| `fields` | Restricts form/view to listed fields |

### Relationship keywords

| Keyword | Placement | Relationship type |
|---|---|---|
| `x-relationship` | On FK field in base entity | Many-to-one |
| `x-relationships` | On detail entity | Many-to-many |

### Array rendering (`x-outputType`)

| Value | Renders as |
|---|---|
| _(omitted)_ | Editable inline DataGrid |
| `list` | Read-only list in FormView |
| `comments` | Comment thread with add/edit/delete |

### Chart spans

| `span` | View window | Navigation step |
|---|---|---|
| `week` | 7 days | ±7 days |
| `month` | 1 month | ±1 month |
| `year` | 1 year | ±1 year |

### Field format → UI component

| `format` | UI component |
|---|---|
| `date-time` | MUI X DateTimePicker |
| `date` | MUI X DatePicker |
| `time` | MUI X TimePicker |
| `uri` | Image preview or link |
| _(none)_ | Text input or number input |

### Prisma type alignment

| YAML | Prisma |
|---|---|
| `string` | `String` |
| `string` (nullable) | `String?` |
| `integer` | `Int` |
| `boolean` | `Boolean` |
| `string` + `format: date-time` | `DateTime @db.Timestamptz(3)` |
| `string` + `format: date` | `DateTime @db.Timestamptz(3)` |
| `string` + `format: time` | `DateTime @db.Timetz(0)` |
