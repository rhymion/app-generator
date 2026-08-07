# Inventory Reservation, Split, and Receiving — Current Behavior

> **Source**: Extracted from `docs/knowledge/schema-yaml-configuration.md` Appendix.
> This page summarizes the **generator mechanism as it currently behaves**. For the design
> rationale and decision history behind these mechanisms, see the `planning/` design docs in the
> separate `rhymion/app-generator-project-docs` repository (not part of this repo — these design
> docs were never tracked here): `planning/reservation-receiving-redesign.md`,
> `planning/split-generalization-design.md`, `planning/generic-primitives-redesign.md`,
> `planning/reservation-split-approval-reject-design.md`.

The reservation/split/receiving system is a set of **generic primitives** — `x-reservation`,
`x-splittable`, `x-ledger-source` — that any entity can opt into. They are not inventory-specific:
this schema currently uses them for three unrelated demo domains (purchase order line items
against a warehouse `inventory` pool, generic named-quantity `supply_request`/`supply_pool`, and
`room_reservation` against a `room` pool). The inventory/purchase-order domain is the most
fully-featured instance and is what this page mostly documents, since that is where
split + receiving + approval all interact.

## 1. `x-reservation` — entity-level reservation config

Declared on the entity that *requests* a reservation (e.g. `purchase_order`, `supply_request`,
`room_reservation`). Two modes:

| `mode` | Meaning | `transaction.strategy` seen in this schema |
|---|---|---|
| `count` | Reserve a quantity out of a numeric pool (`pool.quantityField` / `reservedField`) | `ledger_transaction` (purchase_order → inventory), `conditional_update` (supply_request → supply_pool) |
| `item` | Allocate a specific pool row to the requester (`result.allocatedField`) | `row_lock` (room_reservation → room) |

Key blocks: `pool` (target entity + quantity/reserved field names, or just `entity` for item
mode), `request` (`quantityField`, optional `criteria` mapping requester fields to pool fields —
e.g. `product_id: product_id`), `policy` (`orderBy` for candidate selection; `availabilitySource:
overlap` for date-range item mode), `result` (where the reservation outcome is written back).

### 1.1 Role boundary and `actions` deprecation (2026-07-30 ruling)

`x-reservation`'s role is scoped to exactly two things: **(1) inventory allocation** (`count`
mode — reserving a quantity out of a numeric pool) and **(2) specific-resource reservation**
(`item` mode — e.g. reserving a hotel `room`). Approval/rejection of the request that owns the
reservation goes through the generic [Approval Flow System](approval-flow.md)'s
`approve` / (terminal) `reject` lifecycle — declared via `x-approval` on the requesting or line
entity — not through a bespoke lifecycle on `x-reservation` itself.

An earlier `x-reservation.actions` sub-feature (declarative `ship` / `release` / `cancel`
lifecycle actions, generating `reservation_actions.ts`, per-action
`app/api/{parent}/[id]/actions/{ship,release,cancel}/route.ts` handlers, and a
`ReservationActionButtons` UI component) was removed 2026-07-30. No entity in the default
schema or in any known consumer schema ever declared an `actions` block — the mechanism was
declarative but dormant, and was superseded internally by the `ledger_transaction` strategy
(§ above) before it was ever exercised in a generated app. `code_generator/validate.py` now
hard-rejects any schema that still declares `x-reservation.actions`, with an error message
pointing at `approval_flow`'s approve/reject instead. Do not re-add an `actions` key to
`x-reservation` — express lifecycle transitions through `x-approval` on the owning entity.

**`criteria`-driven auto-allocate is already product/type-safe by construction.** The generated
`reserve{Parent}()` service function (`templates/service.ts.jinja2`) builds its Prisma
`findMany` candidate query as `{ ...criteria }`, so for `purchase_order` (`request.criteria:
{product_id: product_id}`) candidates are always pre-filtered to the same product. This path
never needed the item3 guard below — the gap was in the *explicit*, user-picked inventory paths
described in §3.

### 1.2 `excludeId` must be threaded through on create, not just update (cmd_603)

`assertNoDuplicateReservation()` (`service_validation.ts.jinja2`) accepts an `excludeId` argument
so a reservation can be checked for overlap against every *other* row without also matching
itself. `reserve{Parent}Core` already receives `requestId` — the id of the row it just created —
as an argument, but until cmd_603 neither of its two call sites (the item-pool candidate-loop
branch, used when `availabilitySource: overlap`; and the single-candidate status branch) passed
`requestId` through as `excludeId`. The just-created row then satisfied its own overlap check,
which (depending on branch and candidate count) either rejected a non-conflicting reservation
outright or silently reassigned the requester to a different candidate than the one they picked.
`update{Parent}`'s own call site was unaffected — it was already passing the row's own `id` as
`excludeId` — so this was a create-path-only gap. The lesson generalizes: any new call site added
to `reserve{Parent}Core` (or an analogous "create + immediately overlap-check the row you just
created" flow) must pass its own `requestId`/row id as `excludeId`; the parameter existing on the
function signature is not enough by itself.

## 2. `x-splittable` — dividing a line item

Declared on a child line entity (`purchase_per_item`, `receiving_receipt_line`). Config:
`quantityField`, `parentField` (self-referential FK for split lineage), `perPartRequired` (fields
each split part must supply — both current uses require `inventory_id`, i.e. the operator must
pick which inventory lot each split part draws from).

`templates/split_action_route.ts.jinja2` generates `POST .../actions/split/route.ts`, shared by
every `x-splittable` entity. For an entity that also reserves inventory
(`has_inventory_bridge and split_reserves_inventory`, true for `purchase_per_item`), splitting:

1. Releases the parent's reserved quantity (reads its `inventory_transaction` rows with
   `event_type: 'reserve'`, decrements `inventory.reserved_quantity` per row, writes a
   `release` transaction).
2. For each split part, creates a fresh `inventory_transactionable` bridge (children never
   inherit the parent's bridge/`inventory_id`).
3. Resolves inventory for the part in one of two ways:
   - **Explicit** — `part.inventory_id` supplied → single `inventory.findUnique` +
     `updateMany` claim against that exact row.
   - **Auto-allocate** — no `inventory_id` on the part → `findMany` candidates filtered by
     `product_id: parent.product_id` (uses the parent's own product, not `criteria` from
     `x-reservation`) and consumed in `policy.orderBy` order across multiple lots if needed.

`receiving_receipt_line` is `x-splittable` but not `has_inventory_bridge`/reservation-driven —
its split only divides `receipt_quantity` across parts; the ledger write (§3) happens once per
line via `x-ledger-source`, not per split part.

## 3. `x-ledger-source` — receiving writes

Declared on `receiving_receipt_line`: `{event_type: receive, quantity_delta_field:
receipt_quantity, inventory_id_field: inventory_id}`. Generates the receive-side
`inventory_transaction` write (`templates/ledger_write_stub.ts.jinja2`) driven directly by the
line's own `inventory_id` field — the operator picks the destination inventory lot explicitly
(via Autocomplete on `receiving_receipt_line.inventory_id`), there is no candidate/criteria
filtering here at all.

## 4. Cross-product guard (item3, 2026-07-12 ruling)

**Ruling**: cross-product reservation/receiving is rejected as a **server-side hard error** on
every path that resolves an inventory row from a user-supplied `inventory_id` — split's explicit
branch (§2), the receiving ledger write (§3), and any future explicit-inventory path. The check is
`inventory.product_id !== entity.product_id` (or the relevant parent's product for split parts) →
throw. This closes a real bug (found during a 2026-07-12 read-only code review): the split explicit-
inventory branch and the receive ledger write previously did a plain `findUnique`/direct write
with no product-match check, so an operator could reserve or receive against a lot belonging to a
different product. The `criteria`-driven auto-allocate path in §1 was already safe by
construction and needed no change — ruling_A frames this as "closing the gap in the existing
product_id-driven reserve path", not a new inventory-specific mechanism.

Coverage: reservation (`purchase_per_item`) and receiving (`receiving_receipt_line`) approve/
reject × split (with/without) × inventory specified/unspecified (single-lot and multi-lot
auto-allocate) × error cases (insufficient stock, cross-product, split quantity mismatch,
mid-approval failure) — asserted against a real DB (SKIP=FAIL).

### 4.1 UI Autocomplete still offers cross-product inventory (current limitation, not yet fixed)

**As of this writing, the inventory-picker Autocomplete (split part `inventory_id`, receiving
line `inventory_id`) does not filter its options by product** — it lists all inventory rows
regardless of product. The user experience is therefore: *the UI lets you pick a lot for the
wrong product, and the hard error above only surfaces at submit time.* This is a deliberate,
recorded deferral, not an oversight left undocumented:

- **Why deferred**: a proper fix requires contextual filtering of Autocomplete options (i.e. the
  options query needs to know the current form's `product_id` and constrain the target entity
  query by it). No generic mechanism for this exists yet in the generator — building one
  bespoke for inventory search was rejected in favor of waiting for the general capability.
- **Follow-up (tracked, not yet scheduled)**: once the generator gains a generic "Autocomplete
  option list scoped to another field's current value" capability, apply it to `inventory_id`
  fields on `purchase_per_item`/`receiving_receipt_line` so cross-product lots are excluded from
  the picker itself, not just rejected on submit. See dashboard 🚨 for tracking.

## 5. Inventory relation display (item1, 2026-07-12)

Two display-only fixes applied to how the `inventory_id` relation and its bridge are rendered,
using generic mechanisms that already existed for other relations:

- **Composite label on list columns**: `inventory_id`'s `x-relationship.labelField` is a
  multi-path array (product name + location + lot number) so list columns (e.g.
  `purchase_per_item`, `receiving_receipt_line`) render a human-readable composite label instead
  of the raw `cuid`, via the generic `build_label_expression` mechanism
  (`helpers/label_field.py`) already used elsewhere (e.g. the split dialog, since cmd_304 FIX-4).
  This is a schema-config change (labelField value), not a new generator capability.
- **Internal bridge FK hidden from detail views too**: `inventory_transactionable_id` (the
  internal one-to-one bridge FK created automatically by the generator, analogous to
  `approvable_id`) is excluded from `FormView.tsx` in addition to `column_def.tsx`. Previously
  the internal-bridge-FK auto-exclusion (cmd_304 FIX-3) only applied to list columns; the same
  exclusion now applies to the `form_view` template so detail pages don't leak the bridge id
  either. The field remains present in the Prisma model and writable by the service layer — only
  UI surfacing changed. See `schema-yaml-configuration.md` §4.5 for the general `x-internal`
  field-classification mechanism this builds on.

## 6. Approval integration

`purchase_per_item` and `receiving_receipt_line` are both `x-approval` entities
(`on_approved.emit_hook`, `on_rejected.terminal: true`). See
[Approval Flow System](approval-flow.md) for the generic approval mechanism. Rejection for both
is **always terminal** — there is no "temporary rejection / resubmit" path for reservation or
receiving entities (that pattern exists only for `leave_request`); re-assigning quantity to a
different lot goes through split instead.

## 7. `x-ledger-entities` domain config — item/location/lot/expiration field names (cmd_545/546)

`x-ledger-entities.<domain_key>` aggregates the three entities a ledger domain touches — `pool`
(e.g. `inventory`), `ledger` (e.g. `inventory_transaction`), `transactionable` (the per-event
bridge, e.g. `inventory_transactionable`) — resolved via `resolve_ledger_domain()`
(`helpers/schema_helpers.py`) and referenced by `x-splittable.ledgerDomain` / `x-ledger-source
.ledgerDomain` / `x-reservation.transaction.ledgerDomain`.

As of cmd_545/546, the domain also **requires** four more keys naming the pool entity's own
columns — no defaults, matching OD-1 (§ cmd_310's "declare, don't infer" precedent):

- `itemField` — the pool entity's FK column to the item-master entity (e.g. `product_id`).
- `locationField` — the pool entity's FK column to the location entity (e.g. `location_id`).
- `lotField` — the pool entity's lot-number scalar column (e.g. `lot_number`).
- `expirationField` — the pool entity's expiration-date scalar column (e.g. `expiration_date`).

```yaml
x-ledger-entities:
  inventory_domain:
    pool: inventory
    ledger: inventory_transaction
    transactionable: inventory_transactionable
    itemField: product_id
    locationField: location_id
    lotField: lot_number
    expirationField: expiration_date
```

**Why this exists**: every one of `generators.py`'s ledger-transaction reservation code,
`split_action_route.ts.jinja2`'s auto-allocate/lot-mismatch logic, and the three
`ledger_*_stub.ts.jinja2` once-stub templates used to hardcode these four column names as the
literal strings `product_id`/`location`/`location_id`/`lot_number`/`expiration_date`. Any
consumer naming the item-master entity or these columns differently (e.g. `item`/`item_id`) got
**no error** — the split auto-allocate WHERE clause silently rendered a permanently-undefined
`.None` property access (Prisma treats it as "no filter", not a type error), and the
lot/product-mismatch guard (§4) silently never ran at all.

The item-master entity a split entity's own FK must target (used by the split-route
lot/product-mismatch check, §4) is likewise resolved from `itemField`'s `x-relationship.target`
on the pool entity, not from a literal `target == 'product'` comparison — so it works regardless
of what the item-master entity, or the split entity's own FK to it, happen to be named.

**Migration note for an existing consumer already using `x-ledger-entities`**: this is a breaking
schema-config change — `generate-code` fails immediately (naming the domain and the missing key)
until all four keys are added. Adding them with values matching the consumer's *current* column
names changes no generated output (verified: the once-stub templates render byte-identical to
the current on-disk file when the four keys match existing names) — the only immediately visible
effect is that the previously-dead lot/product-mismatch guard and `primary: true` support (below)
switch on wherever a name mismatch had been silently suppressing them.

### 7.1 Location is an id-FK on the ledger entity too (cmd_562 — supersedes cmd_550/PR #269)

**This section describes the current design.** `locationField` (§7) is now an id-FK column on
*both* the pool entity and the ledger entity (the same shape `itemField` already had on both
sides) — every ledger row write is a plain id copy (`ledger.location_id = pool.location_id`), not
a denormalized display-string snapshot.

cmd_550/PR #269 (described in prior revisions of this doc, now removed) took a different approach:
it kept the ledger's `locationField` column a denormalized display string and taught the write to
render it through the pool entity's declared `x-relationship.labelField` instead of hardcoding
`.name`, plus a *reverse* `findFirst({ where: { <labelField>: <string> } })` lookup wherever the
ledger's own string needed to be turned back into a location row (afterReject re-identification,
split's parent-reserved-row release). Decision (2026-08-04, cmd_558 to cmd_562): don't keep
patching the string-snapshot design — hold location by id, exactly like item already is. This
makes the entire labelField-rendering/reverse-lookup mechanism moot: there's no display string to
render at write time and no string to invert back to a row at read time, since the row already
carries the id directly.

`resolve_ledger_domain()` reflects this — it no longer returns `location_relation`,
`location_label_field`, or `location_label_target`, and no longer inspects the pool entity's
`x-relationship` declaration on `locationField` at all (that declaration still exists on the pool
entity for the *generic* schema-driven UI label system — autocomplete, list views, CSV export —
entirely independent of this ledger-domain resolver). `generate.py`'s `_ledger_stub_field_vars()`
now returns only `pool_location_field`, the same shape as `pool_item_field`/`pool_lot_field`/
`pool_expiration_field`.

**Migration note for an existing consumer still on the string-column design** (as of cmd_562):
this is a schema + data migration, not just a config change — see
`docs/knowledge/appendix/cmd562-location-id-fk-consumer-migration.md` for the concrete Prisma
migration, backfill classification query, and json_schema.yaml diff. Unlike §7's four-key
addition (config-only, no generated-output change when values match existing names), this one
does change generated output: every `ledger_*_stub.ts.jinja2` / `split_action_route.ts.jinja2` call
site and `generators.py`'s reserve-phase write switch from string-snapshot to id-copy, and the
Prisma schema itself gains a real FK relation + `onDelete: Restrict` constraint on the ledger's
location column where none existed before.

### 7.2 onDelete: Restrict and rename auditing (cmd_562)

Two related decisions from the same cmd_562 ruling:

- **A referenced location cannot be deleted.** The new `inventory_transaction.location_id` FK is
  declared `onDelete: Restrict` (matching the existing `product_id`/`item_id` FK on the same
  entity — both are identity dimensions of the append-only ledger row; letting either disappear
  out from under a historical transaction row would corrupt the ledger's meaning). This is a
  Postgres-level constraint, verified by attempting to delete a referenced vs. unreferenced
  location row against a real database (not inferred from the schema declaration alone) — see the
  migration doc referenced above for the reproduction.
- **A location rename leaves a record.** Renaming a location entity is permitted (unlike delete,
  which Restrict blocks outright) on the condition that a record of who renamed it and when
  survives. This does **not** require new generator work: `x-audit: true` (an existing,
  entity-agnostic flag — see `build_context.py`'s `is_audited`, proven generic by
  `test_audit_logging.py`) already wraps every `update{Entity}`/`delete{Entity}` call in
  `recordAuditEvent()`, writing an `audit_log` row with the actor, the target table/id, and a
  timestamp. Declaring `x-audit: true` on the `location` entity is sufficient — a schema-only
  change (the migration doc adds it for any consumer still on the pre-cmd_562 design). It records
  that a rename happened, by
  whom, and when; it does not (yet) capture the old/new name values or offer a per-entity history
  UI — both explicitly deferred to future work.

## 8. Reference-name vs. entity-name mismatch and `primary: true` (cmd_545)

`helper_context()`'s dependency resolution distinguishes a **reference name** (the property name
minus `_id`, e.g. `product`, also the `x-display.table` key when that FK is the primary display
column) from the **entity name** it targets (e.g. `item`) — these coincide for most schemas
(`product` entity referenced as `product`) but are independent by design (`x-relationTarget`
lets a relation's Prisma name diverge from its property name; nothing requires the entity name to
match either). Before cmd_545, the `needs_second` check comparing these two used the wrong
axis entirely (entity name vs. reference name, snake_case vs. camelCase) and so only worked by
coincidence for single-word, self-matching names — any entity whose primary FK's reference name
differed from its target entity name, or was multi-word, silently lost `primary: true` support
(the generated create/update test assertions fall back to a plain `id`-based check instead of the
richer name-based one). Fixed to compare on a single, consistent axis (`var_name`, camelCase,
resolved through the same reference-name-stem logic already used for multi-FK-to-the-same-target
disambiguation elsewhere in this file).

## 9. Not yet implemented — do not treat as current behavior

**x-reservation key reduction (item2) is unapproved and unimplemented.** The `x-reservation`
key structure documented in §1 above (`pool`/`request`/`policy`/`result`, three current uses:
`purchase_order`, `supply_request`, `room_reservation`) is the *current* schema shape. A design
to classify each key as generator-read vs. dead and remove/replace unused keys (especially in
`count` mode) is pending review and approval (dashboard action item) as of this writing — it has not
been designed into code. Do not assume any `x-reservation` key documented here has been removed
or replaced until that design lands and a follow-up doc update reflects the actual diff.

## 10. When a consumer's location/lot column doesn't fit the current shape (design notes, cmd_550/562)

This section works through what happens for shapes `locationField`/`lotField` might take beyond
the current consumers' shape, and whether/how a future consumer could be
supported. **Design notes only for §10.2-10.4 — none of that is implemented.** §10.1 was resolved
by cmd_562.

### 10.1 Location is a plain string, not a relation (resolved by cmd_562)

If `locationField` (e.g. `location`) is declared as a bare `type: string` column with no
`x-relationship` at all — no location *entity* exists, just free text:

- **Does it work today? Yes**, as of cmd_562. §7.1's id-copy design doesn't inspect
  `x-relationship` on `locationField` at all — it only ever reads
  `pool_row.{location_field}`/writes `ledger_row.{location_field}` as a plain property copy,
  regardless of whether that property happens to be a FK or a bare scalar. This was a side effect
  of cmd_562's simplification, not a dedicated fix for this shape — recorded here because it
  changes this section's older "no" answer (from the cmd_550-era label-rendering design, which did
  require `x-relationship.target`).
- **What changed**: `resolve_ledger_domain()` no longer looks up the pool entity's properties or
  its `x-relationship` block at all (§7.1) — it purely passes through the four declared field
  names. There is no relation-vs-scalar branch left to need, because there is no relation-aware
  code path left at all.

### 10.2 Lot number is a table (FK), not a scalar

If `lotField` (e.g. `lot_number`) is itself a many-to-one relation to a `lot` entity (lot numbers
issued from a registry, carrying their own metadata) rather than a free-text/numeric scalar
column, then:

- **Does it work today?** Yes, in the same sense §10.1 now does — `lot_field` is read as
  `_candidate.{lot_field}` (§7, a direct scalar property copy) and written to the ledger row's own
  `lotField` column unchanged, whether that value is a FK id or a free-text lot number. Unlike
  §10.1's old (cmd_550-era) shape, there was never a label-rendering branch for `lotField` to begin
  with — this row has always been a plain copy, so there's nothing left to resolve here beyond
  noting the symmetry with location post-cmd_562.
- **Stopgap for a lot-registry FK wanting a human-readable ledger snapshot**: since the copy is
  now always an id-or-whatever-the-column-is (matching item/location's post-cmd_562 shape), a
  consumer wanting a *display* value in the ledger row rather than an opaque id would need a
  separate denormalized scalar column on the pool entity (populated by whatever writes the FK),
  with `lotField` pointed at that scalar column instead of the FK. This is unchanged from before
  cmd_562 — it was never in scope for either fix.

### 10.3 The consumer doesn't track this dimension at all

If a consumer's pool entity has no location concept whatsoever (e.g. a single-warehouse consumer
with no location/shelf/bin distinction), then:

- **Does it work today?** No — `locationField` (like `itemField`/`lotField`/`expirationField`) is
  OD-1 required with no default (§7); a domain missing the key fails `resolve_ledger_domain` before
  any code generates.
- **What would be needed?** See §10.4 — an explicit "not tracked" declaration, not merely omitting
  the key.
- **Stopgap today**: none — every current consumer tracks location, lot, and
  expiration. A consumer that doesn't would need §10.4 designed and implemented first; there is no
  workaround available today that doesn't require adding an unused placeholder column.

### 10.4 Representing "not tracked" under OD-1

OD-1 (§7, "declare, don't infer") means every one of `itemField`/`locationField`/`lotField`/
`expirationField` is currently **required** — omitting one is indistinguishable from forgetting to
add it; the domain simply fails to resolve. That's the right default for the common case (every
current consumer tracks all four), but it gives §10.3's consumer no way to say "I have decided not
to track this dimension" versus "I haven't finished configuring this domain yet."

**Recommended direction (not implemented)**: keep every key required, but accept an explicit
sentinel value meaning "intentionally not tracked" — e.g. `locationField: null` (a JSON Schema/YAML
null, not simply absent) — rather than making the key optional. `resolve_ledger_domain` would then
resolve `location_field` to `None`, and every call site that currently assumes `location_field` is
always a real column (the ledger row's own write key, post-cmd_562) would need an explicit
`if location_field:` branch that omits that field entirely rather than writing a broken `None`
key.

Why an explicit sentinel over an optional key: an optional key that silently defaults to "not
tracked" when absent reintroduces exactly the bug class §7/§7.1 fixed — a schema author who simply
forgets the key gets no error, just a domain that silently stops tracking location. Requiring the
key to be *present* with an explicit `null` forces the decision to be visible in the schema diff
and reviewable, the same way `x-self-only`'s `admin_bypass` shorthand deliberately never defaults
to the permissive direction (`docs/knowledge` cross-reference: see the self-only-entity design
note). No consumer needs this today, so it has not been built — recorded here so the next time
this question comes up, it doesn't need re-litigating from scratch.
