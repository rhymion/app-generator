---
name: json-schema-json-type-field-checklist
description: |
  When adding a new entity or field to `json_schema.yaml` whose underlying
  Prisma type is `Json` (a JSON blob column, e.g. a notification payload),
  `code_generator/schema_deriver.py`'s scalar-type derivation
  (`_SCALAR_JSON_TYPE`) only supports String/Boolean/Int/DateTime and raises
  `SchemaDivergenceError` (sometimes mis-typed "SchemaDeriverError" in
  discussion) for anything else, including `Json`. If the entity's
  `x-generate` block is entirely `false` (no list/view/new/edit/delete/api/test
  generated), the field does not need to be declared in `json_schema.yaml`'s
  `fields:` at all — add it to `prisma/schema.prisma` only, matching the
  existing precedent of `approvable.rejection_reason`. Trigger when designing
  a new entity/field backed by a Prisma `Json` column, when `generate-code` or
  `prisma migrate dev` fails with `SchemaDivergenceError` mentioning an
  unsupported Prisma scalar type, or when reviewing a design doc's YAML
  snippet that declares a Json-typed field under `fields:`.
  Do NOT use for: SchemaDivergenceError raised for reasons other than an
  unsupported Prisma scalar type (e.g. a field-level fact mismatch between
  json_schema.yaml and schema.prisma — see `build_user_schema.py`'s R5 check).
  Adding String/Boolean/Int/DateTime fields (already fully supported, no
  workaround needed).
---

# json-schema-json-type-field-checklist

## North Star

`code_generator/schema_deriver.py` derives a JSON-schema type for every Prisma
scalar field via a fixed lookup table:

```python
_SCALAR_JSON_TYPE = {
    "String": "string",
    "Boolean": "boolean",
    "Int": "integer",
    "DateTime": "string",
}
```

(`code_generator/schema_deriver.py:38`). Any Prisma field whose
`prisma_type` is not one of these four — most commonly `Json` — hits the
`raise SchemaDivergenceError(...)` branch in `_json_type_for()`
(`schema_deriver.py:244`). There is currently no derivation path for `Json`.

## The workaround

If the entity carrying the `Json` field has `x-generate` entirely `false`
(no `list`/`view`/`new`/`edit`/`delete`/`invalidate`/`api`/`test`), nothing in
the generator actually needs that field declared under `fields:` in
`json_schema.yaml` — the generator produces no code that reads it. In that
case:

1. Add the column to `prisma/schema.prisma` directly (e.g.
   `payload Json`), with a comment explaining why it's absent from
   `json_schema.yaml`.
2. Do **not** add it to `json_schema.yaml`'s `fields:` block.
3. Run `prisma migrate dev` to generate the migration — this does not go
   through `schema_deriver.py`, so it is unaffected by the missing
   derivation.
4. `generate-code` succeeds because the field is never declared, so
   `SchemaDivergenceError` is never triggered for it.

This exact pattern already exists in the schema: `approvable.rejection_reason`
is a real Prisma column absent from `json_schema.yaml`'s `fields:` for the
same reason. When declaring the workaround, reference this existing
precedent so future readers know it's an established pattern, not an
oversight.

## Example (notification.payload)

```yaml
notification:
  x-generate:
    list: false
    view: false
    new: false
    edit: false
    delete: false
    invalidate: false
    api: false
    test: false
  # `payload` is Prisma `Json` — the schema deriver only derives
  # String/Boolean/Int/DateTime scalars (schema_deriver.py _SCALAR_JSON_TYPE),
  # so it is intentionally omitted here, same as approvable.rejection_reason
  # is omitted above despite being a real Prisma column.
  fields:
    user_id:
      x-relationship: {}
```

```prisma
model notification {
  id         String   @id @default(cuid())
  user_id    String
  user       user     @relation("NotificationUser", fields: [user_id], references: [id], onDelete: Cascade)
  type       String
  payload    Json
  read       Boolean  @default(false)
  created_at DateTime @default(now()) @db.Timestamptz(0)
}
```

Golden diff confirmed zero impact on existing entities; `generate-code`
produced no code referencing `payload` (as expected, since `x-generate` is
all `false`).

## Do NOT

- Do not declare a `Json`-typed field under `json_schema.yaml`'s `fields:`
  expecting `schema_deriver.py` to handle it — it will raise
  `SchemaDivergenceError` for any entity where that field participates in
  derivation.
- Do not confuse this with a general `x-generate`-driven design decision —
  the omission is specifically a workaround for a scalar-type derivation gap,
  applicable only when the entity's generation is fully disabled.
- Do not add a general-purpose Json-type mapping to `_SCALAR_JSON_TYPE`
  yourself as an ad hoc fix inside an unrelated task — that is a generator
  change with broader implications and should be scoped as its own task if
  ever needed.
