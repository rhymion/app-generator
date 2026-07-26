---
name: prisma-native-enum-schema-deriver-threading
description: |
  When converting a Prisma `String` field to a Prisma `nativeEnum`
  (PostgreSQL ENUM type), `code_generator/schema_deriver.py` has no built-in
  support and raises `SchemaDivergenceError` because the enum's Prisma type
  name isn't in `_SCALAR_JSON_TYPE`. The standard fix threads a new
  `prisma_enums: dict | None = None` parameter (parsed from schema.prisma's
  `enum` blocks via a new `parse_prisma_enums()` function) through the full
  call chain — `_json_type_for()` → `derive_property()` →
  `derive_raw_entity()` → `_build_raw_and_view()` /
  `_build_standalone_raw()` → `build_intermediate_schema()` → `main()` in
  `build_user_schema.py` — mapping any Prisma type found in `prisma_enums` to
  JSON schema type `"string"`. All new parameters default to `None`, so
  existing callers and projects without nativeEnum fields are unaffected.
  Trigger when adding a new Prisma `nativeEnum`, when `schema_deriver.py`
  raises `SchemaDivergenceError` for an enum's Prisma type name during
  `generate-code`, or when reviewing a design doc that proposes nativeEnum
  support in the schema deriver.
  Do NOT use for: `Json`-type field additions (a different unsupported-scalar
  case — see `json-schema-json-type-field-checklist`). JSON-schema-level
  `enum:` declarations that stay backed by a plain Prisma `String` column (no
  schema_deriver change needed at all).
---

# prisma-native-enum-schema-deriver-threading

## North Star

`code_generator/schema_deriver.py`'s `_json_type_for()` maps a Prisma scalar
type to a JSON schema type via a fixed table (`_SCALAR_JSON_TYPE`:
String/Boolean/Int/DateTime only). A Prisma `nativeEnum` field's
`prisma_type` is the enum's own name (e.g. `InventoryMovementStatus`), which
is never in that table, so converting a `String` column to a `nativeEnum`
column trips `SchemaDivergenceError` at generate-code time even when the
JSON-schema-level `enum:` values themselves are unchanged (a non-breaking,
"Class B" migration).

The fix is to make the schema deriver enum-aware: parse the enum names out of
`schema.prisma` directly, and thread that lookup dict through every function
in the call chain that ultimately decides a field's JSON type.

## The threading chain

1. **`parse_prisma_enums(path: Path) -> dict`** (new function, placed right
   after `parse_prisma_schema()` in `schema_deriver.py`) — scans
   `schema.prisma` for `enum Name { ... }` blocks and returns
   `{EnumName: ['member1', 'member2', ...]}`. Returns `{}` when the file has
   no enum blocks.

2. **`_json_type_for(prisma_field, prisma_enums: dict | None = None)`** — add
   the parameter; before the existing `_SCALAR_JSON_TYPE` lookup/error, check
   `if prisma_enums and prisma_field.prisma_type in prisma_enums: return
   "string"`.

3. **`derive_property(model, field_name, user_field_overrides,
   prisma_enums: dict | None = None)`** — add the parameter, pass it through
   to its `_json_type_for(pf, prisma_enums)` call.

4. **`derive_raw_entity(model, fields_spec, prisma_enums: dict | None =
   None)`** — add the parameter, pass it through to `derive_property(...,
   prisma_enums)`.

5. In **`build_user_schema.py`**: add the parameter to
   `_build_raw_and_view()` and `_build_standalone_raw()` (both call
   `derive_raw_entity`), thread it further up through
   `build_intermediate_schema(user_schema, prisma_models, prisma_enums:
   dict | None = None)`, and in `main()`:
   ```python
   prisma_models = parse_prisma_schema(prisma_schema_path)
   prisma_enums = parse_prisma_enums(prisma_schema_path)
   intermediate = build_intermediate_schema(user_schema, prisma_models, prisma_enums)
   ```
   Update the import line to pull in `parse_prisma_enums` alongside
   `SchemaDivergenceError`, `derive_raw_entity`, `parse_prisma_schema`.

6. Add a unit test verifying `parse_prisma_enums()` against a schema.prisma
   fixture with and without an enum block, and that `derive_raw_entity()`
   resolves a nativeEnum field to JSON type `"string"`.

Total footprint: ~29 lines in `schema_deriver.py`, ~15 lines in
`build_user_schema.py`.

## Why this is safe (backward compatibility)

Every new parameter is `prisma_enums: dict | None = None`. Existing callers
(`convert_to_user_schema.py`, existing tests, any project without a
nativeEnum field) pass nothing and get the exact prior behavior —
`SchemaDivergenceError` still raises for genuinely unsupported types, and
projects with no enums are unaffected.

## Example (inventory_movement.status: String → nativeEnum)

A `Class B` migration (JSON-schema-visible `enum:` values unchanged, no API
break) converting `inventory_movement.status` from Prisma `String` to a new
`InventoryMovementStatus` nativeEnum required exactly this threading before
`generate-code` could complete without `SchemaDivergenceError`. Verified via
pilot: `generate-code` golden diff limited to the one entity, `tsc --noEmit`
0 errors, mandatory API e2e gate fully passing (zero skips), and `psql`
confirming the DB column's type is `InventoryMovementStatus`.

## Do NOT

- Do not hardcode a specific enum name inside `_json_type_for()` — always
  check membership in the parsed `prisma_enums` dict so any future
  nativeEnum is handled without further schema_deriver changes.
- Do not skip threading the parameter through every function in the chain —
  a partial thread (e.g. `derive_property` updated but
  `_build_raw_and_view` not) silently drops `prisma_enums` back to `None`
  partway through and `SchemaDivergenceError` resurfaces.
- Do not give the new parameters a non-`None` default — that would change
  behavior for existing callers that don't pass it.
