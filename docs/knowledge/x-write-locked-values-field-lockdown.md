# `x-write-locked-values`: Declarative Field-Value Lockdown

## What it declares

An entity-level key, `{field_name: [value, ...]}`, naming specific enum values a field may
only ever receive through the system — never through a plain user-facing create/update:

```yaml
# code_generator/tests/fixtures/approval_lockdown_gate/json_schema.yaml
write_lockdown_gate_item:
  x-write-locked-values:
    status:
      - in_underwriting
      - issued
  fields:
    name: {}
    status:
      enum:
        - draft
        - submitted
        - in_underwriting
        - issued
      default: draft
```

Here a user can freely create a row as `draft` or move it to `submitted`, but nothing that
goes through a plain create/update can set `status` to `in_underwriting` or `issued` — those
two values are reachable only by whatever back-office process the schema author wires up to
write them directly (see "The one legitimate way to write a locked value" below). Locking is
**field-and-value-scoped, not field-wide**: only the two named values are blocked, so an
ordinary create can still set `status: draft`, and the same value could be freely writable on
a different entity's own field.

This fixture entity (`write_lockdown_gate_item`) declares no `x-approval` block at all — proof
that `x-write-locked-values` is a complete, standalone mechanism, not an `x-approval` add-on.

## Relationship to `x-approval`: a union, not a replacement

`derive_write_locked_values()` (`code_generator/helpers/schema_helpers.py`) computes the full
locked set for an entity as the **union** of two independent sources:

1. `x-approval.on_approved`/`on_rejected`'s `set_fields` values (pre-existing behavior — the
   values an approval/rejection transition writes are automatically locked against direct
   writes).
2. `x-write-locked-values`'s own declarations (the mechanism this doc covers).

Either source alone is sufficient to lock a value; declaring both on the same field name locks
the combined set. A pre-existing `x-approval` entity's locked-value set is completely unchanged
by the existence of this key — the union with an absent `x-write-locked-values` is exactly the
old `x-approval`-only set. **`x-approval` is not a precondition for this mechanism** — an entity
with no `x-approval` block whatsoever can declare `x-write-locked-values` and get full
enforcement on its own.

The function's old name, `derive_approval_locked_values`, survives as a one-line backward-compat
alias for any code that still imports it under the pre-`x-write-locked-values` name.

## Enforcement reaches every write path, not just the form

The same derived `{field: [locked values]}` map is threaded into four independent generated
surfaces. A schema author who only checks the screen will miss the other three:

1. **The screen** — a locked value's `<AppFieldSelect>` option is rendered with
   `disabled: true` instead of being removed (`code_generator/generators.py`, the enum-int and
   enum-string field-rendering loops). The value stays **visible but unselectable** — it is not
   hidden. A user can see what the field's terminal value looks like; they just can't pick it.
2. **Server Action and REST API** (one shared check) — `service_validation.ts.jinja2` generates
   a `WRITE_LOCKED_FIELDS` table and checks it inside `validateSchemaRules()`, which both
   `validateOnAdd()` and `validateOnUpdate()` call. Both the REST route (`PUT`/`POST`) and the
   Server Action's `upsert{Parent}` funnel through the same generated `lib/{entity}/service.ts`
   wrapper, so this one check covers both entry points — the same "insert once at the confluence
   point" shape used by the post-approval operation lockdown (see "Related, but distinct"
   below).
3. **CSV import** — `api_import_route.ts.jinja2` writes via a direct transaction call and never
   goes through `service_validation.ts` at all, so it carries its own, deliberately duplicated
   `WRITE_LOCKED_FIELDS`/`findLockedViolation()` copy. Both the create branch (any locked value
   is unconditionally rejected — a new row has no persisted value to fall back to) and the
   update branch (locked value allowed only as a same-value resubmission, see below) enforce it.
4. **Generated tests** — `cypress_edit_value()` (`code_generator/generators_test.py`) excludes
   every locked value when it picks a value to drive a generated "edit this field" Cypress step.
   Without this exclusion a generated spec would try to fabricate a state (e.g. jumping straight
   to `issued` via a plain edit) that the real application can never produce through the UI.

Skipping any one of these four when reasoning about the mechanism's coverage is the most common
way to under-estimate what it actually blocks — or, when adding a *new* write path to the
generator, to accidentally leave it unguarded.

## No-op resubmission is not a violation

A row already holding a locked value is allowed to resubmit that same value — this is not a
lockdown violation, because the value was already written by whatever prior operation put it
there. Both the service-layer check and the CSV import update path re-fetch the row's current
value (via a targeted `select` built from `write_locked_values_select`) and compare it against
the submitted one before rejecting:

```typescript
// lib/{{ model }}/service_validation.ts — inside validateSchemaRules()
for (const field of WRITE_LOCKED_FIELDS) {
  if (!(field.key in data)) continue;
  const submitted = data[field.key];
  if (!field.values.includes(submitted)) continue;
  if (currentId !== null) {
    // ... fetch currentRow ...
    // No-op resubmission of the value the row already holds is not a
    // lockdown violation -- it was already written by a prior operation.
    if (currentRow && currentRow[field.key] === submitted) continue;
  }
  throw new AppError('VALIDATION', /* ... */);
}
```

This matters because a naive implementation of "reject any write of a locked value" would also
break every *other* field's edit on an already-locked row: a form that re-submits the full
record (locked field included, unchanged) on every save would otherwise be rejected outright,
making the row's other fields effectively uneditable too.

## The one legitimate way to write a locked value

The generated checks above only sit on the user-facing write paths — a plain create/update
(screen, Server Action, REST API) and CSV import. They do **not** intercept a direct Prisma
transaction call. That is intentional and is the only legitimate way to actually set a locked
value: whatever system process owns the transition writes it via `tx.<model>.update(...)`
(or `prisma.<model>.update(...)`), bypassing the generated `service.ts` wrapper — and therefore
`validateOnAdd`/`validateOnUpdate` — entirely. The generator's own `x-approval` dispatch handler
does exactly this for its own locked values:

```typescript
// lib/approval/on_approved_dispatch.ts — AUTO-GENERATED
// Standard field update (auto-generated from x-approval.on_approved.set_fields)
await tx.{{ entity.snake_name }}.update({
  where: { id: entity.id },
  data: { status: 'active' },
});
```

An entity that declares `x-write-locked-values` with no `x-approval` at all has no generated
dispatcher of this shape — the schema author is expected to write their own hand-written
service (a background job, a webhook handler, an internal admin action) that performs the same
kind of direct `tx.<model>.update(...)` call outside `service.ts`'s `create{Parent}`/
`update{Parent}`. Without this doc, that direct-transaction escape hatch reads as unreachable —
"a value nothing can ever write" — when it is in fact the mechanism's intended, and only, path
to setting the value at all.

## Read paths are untouched

This mechanism only ever guards writes. List filtering, sorting, and display of a locked value
are completely unaffected — a row sitting at a locked value is exactly as visible, filterable,
and sortable as any other row. There is no read-side allowlist or restriction here at all.

## `validate.py`'s fail-closed checks

`code_generator/validate.py` rejects a malformed `x-write-locked-values` declaration at
generation time rather than letting it silently produce dead or broken template code:

- The field named must actually exist in the entity's `properties`.
- Its value must be a list.
- The field itself must have a declared `enum` — `x-write-locked-values` only supports enum
  fields.
- Every declared value must be a real member of that field's enum (case-insensitive label match
  for the legacy int-enum label form, exact match otherwise).

A typo'd field name or an out-of-range value fails generation immediately, naming the offending
entity and key, instead of quietly producing a locked-value branch that can never actually
trigger (because the value it names can never legally reach the field in the first place).

## Related, but distinct: the post-approval operation lockdown (§16.15)

`docs/knowledge/appendix/approval-flow.md` §16.15 documents a different mechanism that is easy
to confuse with this one: it locks **entire operations** (edit/delete/invalidate) on a row once
its `submit_on` field reaches a terminal value, regardless of which field or value a caller is
trying to write. `x-write-locked-values` instead locks **specific field values**, independently
of whether the row as a whole is otherwise editable — a row can be fully editable and still have
one field's terminal values locked, or vice versa. The two mechanisms can apply to the same
entity at once but answer different questions: "can this row be edited/deleted/invalidated at
all right now?" (§16.15) versus "can this specific value be written to this specific field?"
(this doc).
