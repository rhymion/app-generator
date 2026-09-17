# Prisma `Decimal` field support

## What this is

The generator supports a Prisma `Decimal` column (`@db.Decimal(p, s)`), mapped to JSON schema
type `"string"` — never `"number"` — the same deliberate choice `Decimal`-in-`schema-yaml-
configuration.md`'s type-mapping table documents for the reason: a JS-float mapping risks silent
rounding error (`0.1 + 0.2`-style) on every read/write/CSV round-trip. Before this feature
existed, declaring a `Decimal` column at all made `schema_deriver.py` raise a
`SchemaDivergenceError` — there was no supported path.

Introducing the type touches schema derivation, form/CSV validation, and the numeric-styled form
input (`inputMode="decimal"`, never the `number`-typed `NumberField`) — see
`docs/knowledge/schema-yaml-configuration.md`'s Prisma type-alignment table for the field-level
mapping and `x-decimal-scale`/`x-decimal-precision` keys. This repo's own schema has no Decimal
field, so a dedicated `test:decimal-gate` fixture exists purely to compile the branches this
repo's own `generate-code` never otherwise exercises.

## Known-fixed defects since introduction

- **`lib/_decimal.ts` pulled the Node.js Prisma client into every client-side bundle**,
  surfacing as `TurbopackInternalError` on any consumer schema with a Decimal field. See
  `docs/knowledge/decimal-client-server-boundary-gate-limitation.md` for the full root-cause and
  fix (the Prisma-free formatter is now split into its own module).
- **Read-only Decimal display rendered `Decimal.toString()` verbatim instead of the field's
  declared scale** — a value stored with more precision than `x-decimal-scale` declares (or a
  trailing-zero-free Prisma string) showed the raw stored digits instead of the scale-formatted
  value a form/list column shows elsewhere. Now goes through the same scale-aware formatter used
  everywhere else a Decimal value is displayed.
- **An optional one-to-one selector FK whose target has a Decimal column returned zero
  autocomplete candidates as soon as the user typed anything** — the selector's "available
  options" search serialized the target's Decimal column incorrectly, so every candidate failed
  server-side (de)serialization and was silently dropped from the result set rather than erroring
  loudly. Fixed alongside the same-shaped `TS2322` build-time bug documented in
  `.claude/commands/update-generator.md`'s Completion gate step 7 (`test:oto-decimal-gate`).
- **Generated-test Decimal values were a fixed literal that overflowed narrow
  `@db.Decimal(p, s)` columns** — a schema declaring a small scale/precision could receive a
  generated test value with more digits than the column allows, failing at the database layer
  during test setup rather than exercising the intended scenario. Test values are now derived
  from the column's own `x-decimal-scale`/`x-decimal-precision`, including the all-fractional edge
  case.
