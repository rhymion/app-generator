# nativeEnum member naming convention

## Rule

Every Prisma `enum` block (`nativeEnum` fields -- `type: string` with a
`_prisma_native_enum_type` marker derived from a Prisma `enum ... {}` column
type) must use **lowercase snake_case** member names: `pending`,
`terminal_rejected`, `partially_received` -- never `Pending`,
`TerminalRejected`, or `terminalRejected`.

Enforced by `code_generator/validate.py` (section 9, "nativeEnum member
naming convention"). A `json_schema.yaml` enum list containing a member
that doesn't match `^[a-z][a-z0-9_]*$` fails generation with a schema
validation error naming the entity, property, enum type, and offending
value.

This does **not** apply to int-enum fields (`type: integer` + `enum:` --
label lists for a Prisma `Int` column). Those enum values are
human-readable UI label text, not Prisma type-system identifiers, and are
out of scope for this rule.

## Why

An inventory across app-generator's default schema and the full
app-template consumer schema (cmd_493, 2026-07-30) found lowercase
snake_case is already the overwhelming established convention: **16 of 20
nativeEnum types (61 of 80 members, 80%)** were already lowercase before
this rule existed, plus every `x-approval.set_fields` reference-side
literal. PascalCase (`ApprovalRequestStatus`, `ReactionType`, and -- in
app-template specifically -- `ShiftStatus`, `DayOfWeek`) was the minority
outlier, not the norm.

The Lord's ruling (cmd_493): normalize to the dominant convention and
enforce it going forward with validation, rather than papering over
inconsistency in the display layer. Humanizing case at the UI layer
(`_humanize_enum_value()`) hides schema-level drift instead of preventing
it -- a raw literal that quietly gets capitalized for display is a case
mismatch waiting to break something that reads the raw value directly
(e.g. a generated Cypress spec asserting against `res.body.status`).

## Consumer impact

This rule is enforced by `validate.py` at **generation time** for every
consumer project, not just app-generator's own defaults. Any existing
consumer schema with a PascalCase (or otherwise non-conforming) nativeEnum
member will fail its next `generate-code` run until migrated.

As of the cmd_493 inventory, this affects app-template
(`rhymion/app-template`, `prj/code_generator/json_schema.yaml`) directly:

- `ShiftStatus` (`shift.status`: `Scheduled`/`Approved`/`Cancelled`)
- `DayOfWeek` (`shift_template.day_of_week`: `Sunday`..`Saturday`)

Both are consumer-authored (not shipped by app-generator) and are **not**
migrated by this change -- app-generator's SoT does not own app-template's
schema. A follow-up task in app-template must normalize these two enums
(rename Prisma enum members to lowercase snake_case + write a data-rewrite
migration, the same pattern used here for `ApprovalRequestStatus` /
`ReactionType`) before app-template can regenerate cleanly once this
app-generator version is picked up.

## Renaming an existing nativeEnum member

Renaming a Prisma enum member requires a migration that rewrites existing
column data -- a plain member rename is not additive. See the
`ApprovalRequestStatus`/`ReactionType` migration produced by cmd_493 as a
worked example of the SQL pattern (create new enum type, `ALTER COLUMN
... TYPE ... USING (CASE ... END)` to remap old values to new, rename
types, then drop the old type). `docs/knowledge/migration-guide.md` covers
why app-generator itself does not track `prisma/migrations/` and how
consumers apply migrations.
