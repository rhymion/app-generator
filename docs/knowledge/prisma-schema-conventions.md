# Prisma Schema Conventions

This document describes the conventions that **must** be followed when authoring `prisma/schema.prisma` for a my-next application. The code generator reads both the JSON schema and the Prisma schema; any inconsistency between them causes TypeScript build failures.

---

## 1. Model naming

### 1a. Standard case (single-file entity format — current)

Entities are declared in the **single-file entity format** (see `docs/knowledge/schema-yaml-configuration.md` §2 for the full authoring guide): `x-generate` and all other generation metadata sit directly on one top-level definition — there is no separate detail/view definition to write. For any entity that also has its own Prisma model, the Prisma model name is exactly the entity's own key:

| JSON schema entity | Prisma model |
|---|---|
| `ai_agent` | `model ai_agent` |
| `job_output` | `model job_output` |

Do not rename, alias, or abbreviate the Prisma model name relative to the entity key.

Internally, `code_generator/build_user_schema.py` still splits each such entity into a machine-derived **raw** definition (stored under a reserved `__`-prefixed key, e.g. `__ai_agent`) and a **view** definition (the plain key, carrying `x-generate` plus the hand-authored embed shape) before handing the result to `generate.py` — `_build_raw_and_view` (`code_generator/build_user_schema.py:228-256`) constructs the view's `allOf` pointer to `#/definitions/__{entity_key}` at line 246, and `_RESERVED_RAW_PREFIX = "__"` is defined at line 86 (line numbers re-checked 2026-09-12; shifted from an earlier revision of this note). This raw/view split is an implementation detail of the build pipeline, not something you author yourself: you never write a `__`-prefixed key in `json_schema.yaml` (`_validate_entity_names` rejects any user-chosen entity name starting with `__`, `code_generator/build_user_schema.py:172-199`), and the split has no effect on the Prisma model name, which always matches the plain entity key you wrote.

#### Legacy format (superseded)

Before the single-file format, an entity's generation config lived on a separate `<entity>_detail` definition, and the Prisma model name matched the **base** (non-`_detail`) entity name:

| JSON schema entity | Prisma model |
|---|---|
| `ai_agent` / `ai_agent_detail` | `model ai_agent` |
| `job_output` / `job_output_detail` | `model job_output` |

The generator core still parses this shape as a fallback for schemas that haven't been converted to the single-file format, but `build_user_schema.py` and its automated converter `convert_to_user_schema.py` never produce `_detail`-suffixed output, and the live default `code_generator/json_schema.yaml` has zero `_detail`-suffixed entities. Treat this table as historical/compatibility context only — do not use the `_detail` split for new entities.

### 1b. Re-use of an existing model (pass-through entity / multiple interfaces)

An entity with `x-generate` does **not** need to have its own Prisma model when its `allOf.$ref` points to an existing entity that already has a model. The generated code uses the model of the referenced entity. This only works when the pass-through entity's own key does **not** match any Prisma model name: `_validate_entity_names` (`code_generator/build_user_schema.py:172-199`) rejects an `allOf`-wrapper entity whose key collides with a real Prisma model name, since that name is reserved for that model's own single-file definition (the collision would otherwise silently discard the `allOf` and misinterpret the entity as that model's own raw/view pair).

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
order_buyer:
  x-generate: { ... }
  allOf:
    - $ref: "#/definitions/order"

order_admin:
  x-generate: { ... }
  allOf:
    - $ref: "#/definitions/order"
```

**Rule:** determine the Prisma model by walking `allOf.$ref` to the referenced entity. Only that referenced entity needs a Prisma model.

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

A `name` column is **not** required. When a model has none, the generated
Cypress populate helpers key their find-or-create on its `@unique` /
`@@unique` columns instead (e.g. `purchase_order.po_number`) — as long as
those columns are non-nullable and carry no `@default(...)`, so that the
generated `create()` actually writes them. See
`docs/knowledge/testing-cypress.md` §"Dep records are find-or-create, not
create".

---

## 5. Required indexes

Every model that has any of the following columns **must** declare a matching `@@index([col])` (or a composite index whose **leftmost** column is that column):

| Column | Why |
|---|---|
| `creator_id` | Filters on this column scope rows for users with Creator-only permissions; without an index, every list query falls back to a full table scan as the dataset grows. |
| `assignee_id` | Same reasoning, for the Assignee role. |
| `organization_id` | Filters on this column scope rows to organizations the user belongs to. |
| every FK column (auto-detected from `@relation(..., fields: [col], ...)`) | Every foreign key is essentially always a join/filter target — bridge/relation columns are covered automatically, not just the three hardcoded hot columns above. |
| every column exposed for filtering/sorting in generated UI (`x-display.table`, or `x-filter-values`) | Issue #726: a `WHERE`/`ORDER BY` on a column shown in a generated list view, or referenced by an `x-filter-values` row restriction, has the same full-table-scan risk as an unindexed FK. See below. |

Postgres does not auto-index foreign-key columns, and it never auto-indexes a plain scalar/enum column regardless of how the application queries it. The code generator runs `validate_prisma_indexes()` before generation and will refuse to proceed if any required index is missing — this fails fast rather than silently shipping a slow query.

To add the indexes idempotently:

```bash
python3 scripts/add_required_indexes.py
```

The script emits `@@index([col])` for every hot/FK/UI-exposed column every model needs, and exits cleanly when nothing is missing.

A composite index counts only when the required column is its first entry. `@@index([creator_id, name])` satisfies the rule for `creator_id`; `@@index([name, creator_id])` does not.

### UI-exposed indexing (Issue #726)

A column gets an automatic `@@index` when it is exposed for filtering or sorting in generated UI — concretely: any column that appears in an entity's `x-display.table` (the generated list page's columns), or that is referenced by a view's `x-filter-values`. This is derived mechanically from the schema by `derive_ui_exposed_index_columns()` (`code_generator/validate.py`) — there is no hand-maintained column-name list to keep in sync, the way `_REQUIRED_INDEX_COLUMNS` works for the three hardcoded hot columns.

Two exclusions, both automatic:

- **Relationship display columns.** An `x-display.table` entry naming a relation (e.g. `resource`, rendered as `resource.name`) is not itself a column — its real FK column (`resource_id`) is already covered by the FK auto-detection above, so it is skipped here rather than double-indexed under the wrong name.
- **Virtual columns.** An `x-display.table` entry backed by neither a scalar property nor a `{name}_id` relation (a computed/resolver-backed display column, see `docs/knowledge/virtual-resolver-guide.md`) has no underlying DB column at all — there is nothing to index.

`derive_ui_exposed_index_columns()` (and, by extension, `validate_prisma_indexes()`'s UI-derived half and `add_required_indexes.py`'s UI-derived additions) requires the **expanded intermediate schema** (`code_generator/.generated/json_schema.yaml`, the same input `generate.py` itself consumes), not the hand-authored `code_generator/json_schema.yaml` source directly. The hand-authored form declares a many-to-one relationship as a bare property (e.g. `role: {$ref: '#/definitions/role'}`); `build_user_schema.py` expands that into the real FK scalar column (`role_id`) the relation-exclusion logic above depends on. Feeding the hand-authored form in would misidentify a relation-display column as a plain scalar column and try to index a Prisma relation *field* — not a valid index.

### Relationship to Issue #742 (composite indexes)

Issue #742 considered ad hoc **composite** indexes for specific filtered/sorted business query shapes (e.g. "my organization's policies, sorted by expiry date"), based on `pg_stat_statements` evidence from load testing. It is a distinct root cause and fix shape from #726: #742 is deferred — no missing composite index has been confirmed by load-test data yet, and any future fix is a hand-designed composite index for a specific query shape, not something a general schema-driven rule could safely infer (which column pairs belong together, and in which order, is a query-shape question, not a "does this column appear in a generated view" question). The two issues do not fold into one design: #726's single-column, schema-derived rule implemented here does not generalize to #742's multi-column, evidence-driven ad hoc indexes, and #742 remains open as follow-up work pending a stress-test round that actually exercises those query shapes.

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
