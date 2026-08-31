# `x-state-lockdown`: Declarative State-Transition Lockdown

## What it declares

An entity-level key naming a monitored enum field, the values at which it becomes
*terminal*, and a set of other fields that freeze once the monitored field reaches one of
those terminal values:

```yaml
shipment_line:
  x-state-lockdown:
    field: status
    terminal_values:
      - shipped
      - rejected
    locked_fields:
      - quantity_shipped
      - lot_number
      - serial_number
      - source_bin_id
      - inventory_id
```

Once `status` reaches `shipped` or `rejected`, a plain create/update can no longer (1) move
`status` to any other value, and (2) can no longer change `quantity_shipped`, `lot_number`,
`serial_number`, `source_bin_id`, or `inventory_id` from whatever value they held at the
moment `status` became terminal. Every other field on the row (e.g. a free-text note) stays
freely editable — this mechanism only freezes `field` itself and the explicitly named
`locked_fields`.

## Relationship to `x-write-locked-values`: a different axis, not an overlap

`x-write-locked-values` locks specific **values** — a field may never receive value V through
a plain write, regardless of the row's current state. `x-state-lockdown` locks **transitions**
— once a row's monitored field reaches a terminal value, it (and a set of *other* fields) may
no longer *change*, but the terminal value itself was reachable in the first place (unlike a
write-locked value, which is never directly settable by a plain write at all). The two keys
answer structurally different questions and are not interchangeable: `x-write-locked-values`
cannot express "this value is fine once, but nothing may change after that", and
`x-state-lockdown` cannot express "this specific value may never be written by a plain
create/update, ever."

`x-state-lockdown` is also `x-approval`-independent by design — it does not require, and does
not read, an `x-approval` block on the entity at all. This is the salient contrast with the
post-approval operation lockdown (see "Related, but distinct" below), which is entirely driven
by `x-approval`'s presence.

## Semantics

- **Field existence and enum membership are fail-closed** (see "`validate.py`'s fail-closed
  checks" below) — `field` must have a declared `enum`, and every `terminal_values` entry must
  be a member of it.
- **`locked_fields` must not include `field` itself** — the transition check (1) already
  covers `field`; listing it again in `locked_fields` would be redundant and is rejected at
  generation time rather than silently accepted.
- **No-op resubmission is allowed for both checks.** Resubmitting the row's current `field`
  value, or a `locked_fields` entry's current value, unchanged, is not a violation — only an
  actual attempted *change* is rejected. This matches `x-write-locked-values`'s own no-op
  handling and is necessary for the same reason: a form that resubmits the full record
  (locked fields included, unchanged) on every save must not be rejected outright.
- **CREATE never runs this check.** A newly created row has no prior state to compare
  against, and its initial value is normally non-terminal anyway — the check only applies to
  `validateOnUpdate` (and CSV import's UPDATE branch), never `validateOnAdd` (or CSV import's
  CREATE branch).

## Enforcement reaches every write path, not just the form

The same `state_lockdown` context (a `{field, terminal_values, locked_fields}` dict, or `None`
when the entity declares nothing) is threaded into two independent generated surfaces:

1. **Server Action and REST API** (one shared check) — `service_validation.ts.jinja2` declares
   a `STATE_LOCKDOWN` constant and checks it inside `validateSchemaRules()`, which both
   `validateOnAdd()` and `validateOnUpdate()` call (the check itself is a no-op on the
   `validateOnAdd()` path via the `currentId !== null` guard). Both the REST route
   (`PUT`/`POST`) and the Server Action's `upsert{Parent}` funnel through the same generated
   `lib/{entity}/service.ts` wrapper, so this one check covers both entry points.
2. **CSV import** — `api_import_route.ts.jinja2` writes via a direct transaction call and never
   goes through `service_validation.ts` at all, so it carries its own, deliberately duplicated
   `STATE_LOCKDOWN` constant and check inside the UPDATE branch only (CSV import's CREATE
   branch has no state-lockdown check, matching the "CREATE never runs this check" rule above).
   A violation is reported as a row-numbered `STATE_LOCKDOWN_VIOLATION` error rather than
   thrown as an `AppError`, matching the CSV-import error-collection convention.

Skipping either of these when reasoning about the mechanism's coverage is the most common way
to under-estimate what it actually blocks.

## The DB fetch: service.ts already has it, CSV import fetches its own

`service.ts.jinja2` fetches the pre-update row (`_prevRow`, all fields, no `select`) before
calling `validateOnUpdate()`, so the service-layer check normally reads the state directly off
`prevRow` with no extra query. The check only falls back to its own `findUnique` (scoped by
`state_lockdown_select`, a generated `{ field: true, locked_field_1: true, ... }` clause) for a
write path that bypasses the service layer and calls `validateOnUpdate` with `prevRow: null`
directly. CSV import has no equivalent pre-fetched row at all, so its check always performs its
own `findUnique` with the same `state_lockdown_select` clause.

If an entity declares both `x-write-locked-values` and `x-state-lockdown`, each mechanism
performs its own independent DB fetch when service.ts's `prevRow` isn't usable — a second
round-trip. Unifying the two into a single combined `select` is a worthwhile optimization for
an entity that declares both, but is left to whichever future change first needs it rather than
built speculatively here.

## `validate.py`'s fail-closed checks

`code_generator/validate.py` rejects a malformed `x-state-lockdown` declaration at generation
time rather than letting it silently produce dead or broken template code:

- `x-state-lockdown` itself must be a mapping with `field`, `terminal_values`, and
  `locked_fields` keys all present.
- `field` must be a string naming a property that exists in the entity, and that property must
  have a declared `enum`.
- `terminal_values` must be a non-empty list, and every entry must be a member of `field`'s
  enum.
- `locked_fields` must be a list of strings, each naming a property that exists in the entity.
- `field` must not appear in its own `locked_fields` list.

A typo'd field name, an out-of-range terminal value, or a self-referencing `locked_fields`
entry fails generation immediately, naming the offending entity and key.

## Related, but distinct: `x-write-locked-values` and the post-approval operation lockdown (§16.15)

`docs/knowledge/x-write-locked-values-field-lockdown.md` locks specific field *values*,
independent of the row's transition history. `docs/knowledge/appendix/approval-flow.md` §16.15
locks entire *operations* (edit/delete/invalidate) once an `x-approval`-driven `submit_on`
field reaches a terminal value — and, unlike `x-state-lockdown`, is entirely driven by the
presence of `x-approval`'s `has_approvable_bridge` gate. `x-state-lockdown` sits between the
two: like §16.15, it keys off a field reaching a terminal value; like `x-write-locked-values`,
it enforces at the individual-field level rather than locking the whole row, and it requires no
`x-approval` block at all.
