# Prisma Schema Conventions

This document describes the conventions that **must** be followed when authoring `prisma/schema.prisma` for a my-next application. The code generator reads both the JSON schema and the Prisma schema; any inconsistency between them causes TypeScript build failures.

---

## 1. Model naming

### 1a. Standard case

Most entities follow a two-definition pattern: a base entity (e.g. `ai_agent`) plus a detail entity (e.g. `ai_agent_detail`) that carries `x-generate`. The Prisma model name matches the **base** entity name:

| JSON schema entity | Prisma model |
|---|---|
| `ai_agent` / `ai_agent_detail` | `model ai_agent` |
| `job_output` / `job_output_detail` | `model job_output` |

Do not rename, alias, or abbreviate the Prisma model name relative to the base entity.

### 1b. Re-use of an existing model (virtual entity / multiple interfaces)

An entity with `x-generate` does **not** need to have its own Prisma model when its `allOf.$ref` points to an existing entity that already has a model. The generated code uses the model of the referenced base entity.

Example from the system — `setting` provides a "My Account" interface over the `user` table:

```yaml
setting:
  x-generate:
    edit: true
    ...
  allOf:
    - $ref: "#/definitions/user"   # ← uses user model; no `setting` model needed
```

This pattern is also allowed for custom (non-system) entities. Use it when you need multiple distinct interfaces (pages, APIs) for the same underlying data — for example, separate views for different roles or use cases:

```yaml
# Two interfaces over the same Prisma model `order`
order_buyer_detail:
  x-generate: { ... }
  allOf:
    - $ref: "#/definitions/order"

order_admin_detail:
  x-generate: { ... }
  allOf:
    - $ref: "#/definitions/order"
```

**Rule:** determine the Prisma model by walking `allOf.$ref` to the base entity. Only that base entity needs a Prisma model.

---

## 2. Relation field naming (CRITICAL)

The code generator reads relation field names from the **JSON schema**, not from the Prisma schema. The Prisma field name for every relation array must exactly match the corresponding key in the JSON schema.

### 2a. Many-to-many relations (`x-relationships`)

The key in `x-relationships` on the detail entity is the Prisma field name.

JSON schema:
```yaml
procedure_detail:
  x-relationships:
    preceded_by:          # ← this key is the Prisma field name
      type: many-to-many
      target: procedure
    followed_by:          # ← this key is the Prisma field name
      type: many-to-many
      target: procedure
```

Prisma must use the same names:
```prisma
model procedure {
  preceded_by  procedure[] @relation("BeforeAfter")
  followed_by  procedure[] @relation("BeforeAfter")
}
```

### 2b. One-to-many child relations (properties on the detail entity)

When a detail entity lists a child array in its `properties`, that property name is the Prisma field name.

JSON schema:
```yaml
procedure_detail:
  properties:
    children:             # ← this key is the Prisma field name
      type: array
      items:
        $ref: "#/definitions/procedure"
```

Prisma must use the same name:
```prisma
model procedure {
  children  procedure[] @relation("ParentChild")
}
```

### 2c. Auto-derived one-to-many (no explicit JSON schema property)

When a child entity has a FK to a parent but the parent's detail entity does **not** declare the child array as a property, the code generator derives the include field name as `<child_model_name>s`. In this case the Prisma field name must follow that convention.

Example — `ai_agent_version` has `ai_agent_id` but `ai_agent_detail` properties do not name the child list:

```prisma
model ai_agent {
  ai_agent_versions  ai_agent_version[]   // ← derived: child model name + s
}
```

**Do not** use a shortened or semantic name (`versions`) for auto-derived relations — the mismatch will cause a TypeScript build error.

### 2d. Semantic names are valid when matched in JSON schema

Custom semantic names (e.g. `referenced_by`, `fields`, `images`) are valid as long as:
1. The JSON schema detail entity declares the same property name, **and**
2. The Prisma field uses the exact same name.

If you choose a custom name in Prisma, the JSON schema must use the identical key — otherwise the generated getters/includes will not compile.

---

## 3. Sync with JSON schema

The Prisma schema and JSON schema must always be in sync:

- Every entity with `x-generate` in the JSON schema needs a Prisma model.
- Every `x-relationship` FK field in the JSON schema (e.g., `ai_agent_id`) needs a matching `<name>_id String` column and `@relation` in Prisma.
- Every array property on a detail entity must have a matching relation field on the Prisma model, using the **same name** (see §2).

---

## 4. Required fields on every custom model

Every non-system independent model must include:

```prisma
id         String   @id @default(cuid())
created_at DateTime @default(now()) @db.Timestamptz(0)
updated_at DateTime @updatedAt @db.Timestamptz(0)
creator_id String
creator    user @relation("<ModelPascal>Creator", fields: [creator_id], references: [id])
updater_id String
updater    user @relation("<ModelPascal>Updater", fields: [updater_id], references: [id])
```

And reverse relations on `user`:

```prisma
created_<models> <model>[] @relation("<ModelPascal>Creator")
updated_<models> <model>[] @relation("<ModelPascal>Updater")
```

Embedded models (dependent — cannot exist without their parent, no `x-generate`) must include **only**:

```prisma
id         String   @id @default(cuid())
created_at DateTime @default(now()) @db.Timestamptz(0)
updated_at DateTime @updatedAt @db.Timestamptz(0)
```

**Prohibited on embedded models:** `creator_id`, `creator`, `updater_id`, `updater`. The generated service never writes these for embedded children, so their presence causes a TypeScript build error.

---

## 5. Required indexes

Every model that has any of the following columns **must** declare a matching `@@index([col])` (or a composite index whose **leftmost** column is that column):

| Column | Why |
|---|---|
| `creator_id` | Filters on this column scope rows for users with Creator-only permissions; without an index, every list query falls back to a full table scan as the dataset grows. |
| `assignee_id` | Same reasoning, for the Assignee role. |
| `organization_id` | Filters on this column scope rows to organizations the user belongs to. |

Postgres does not auto-index foreign-key columns. The code generator runs `validate_prisma_indexes()` before generation and will refuse to proceed if any required index is missing — this fails fast rather than silently shipping a slow query.

To add the indexes idempotently:

```bash
python3 scripts/add_required_indexes.py
```

The script emits `@@index([creator_id])`, `@@index([assignee_id])`, and `@@index([organization_id])` for every model that needs them, and exits cleanly when nothing is missing.

A composite index counts only when the required column is its first entry. `@@index([creator_id, name])` satisfies the rule for `creator_id`; `@@index([name, creator_id])` does not.

---

## 6. Relation disambiguation

Every `@relation` on a custom model must include a unique string name to prevent Prisma's "ambiguous relation" error. This is especially important for self-relations and models with multiple relations to the same target. Use a descriptive name that identifies the semantic role:

```prisma
model procedure {
  parent    procedure?  @relation("ParentChild", fields: [parent_id], references: [id])
  children  procedure[] @relation("ParentChild")
  preceded_by  procedure[] @relation("BeforeAfter")
  followed_by  procedure[] @relation("BeforeAfter")
}
```

---

## 7. Polymorphic bridge models

Three reusable bridge models let multiple owner entities share the same child storage instead of each owner declaring its own per-type child model:

| Bridge | Children | Owners declare |
|---|---|---|
| `commentable` | `comment` | `commentable_id String @unique` |
| `approvable` | `approval_request` | `approvable_id String @unique` |
| `attachable` | `attachment` | `attachable_id String @unique` |

Owner-side pattern (one-to-one with the bridge, auto-created during owner upsert):

```prisma
model resource {
  // ...
  attachable_id String     @unique
  attachable    attachable @relation(fields: [attachable_id], references: [id])
}

model attachable {
  id          String       @id @default(cuid())
  attachments attachment[]
  resource    resource?
  product     product?
}
```

JSON-schema side (owner declares the FK with `one-to-one_bridge`):

```yaml
attachable_id:
  type: string
  pattern: "^c[a-z0-9]{24,}$"
  x-relationship:
    type: one-to-one_bridge
    target: attachable
    labelField: id
```

`attachment` distinguishes media types via an integer enum (`image=0`, `file=1`, `video=2`, `audio=3`) instead of separate per-type models. Type-specific metadata (image dimensions, video duration, etc.) is not stored today; add side-tables keyed by `attachment_id` if such metadata becomes necessary.

The attachment UI is rendered by the hand-written `components/_standard/AttachmentSection.tsx`, wired through `x-custom-component: { name: AttachmentSection, target: [view, edit] }` on the owner's detail entity.
