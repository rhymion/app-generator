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
lot/product-mismatch guard (§4) silently never ran at all. `location_relation` (the Prisma
relation accessor for `locationField`, e.g. `location`) is *derived* by stripping the
conventional `_id` suffix, not separately declared — same convention `pool_fk_field`/
`bridge_fk_field` already use elsewhere in this file.

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

### 7.1 Location ledger-row label rendering (cmd_550)

The ledger row's `locationField` column (§7) is a denormalized snapshot — "what the location was
called at the time" — written when a reservation claims pool inventory. Before cmd_550, this
write hardcoded `_candidate.{location_relation}?.name ?? ''`: it assumed the location entity's
display field is always literally named `name`. Any consumer whose location entity displays a
different field (e.g. `label`, `code`) got no error — a TypeScript compile error (`.name` doesn't
exist on the Prisma type), the same silent-until-build-time failure mode as §7's four fields.

Fixed to read the pool entity's own `x-relationship.labelField` declared on `locationField` —
`resolve_ledger_domain()` now also returns `location_label_field` / `location_label_target`,
resolved from that same `x-relationship` block (no new schema key). The ledger row is rendered via
`build_label_expression()`, the identical helper `helper_context()`'s dependency/autocomplete label
rendering already uses elsewhere in this generator (§5) — so the ledger snapshot and what a user
sees in an autocomplete/list-view for the same relation always come from one source, not two that
can drift apart independently.

**Composite labelField** (generators.py's reserve-phase write only — see "Once-stub / split-route
templates" below for a narrower rule): if `locationField`'s `labelField` is a list (e.g.
`[building, shelf]`), the full composite string (e.g. `"Warehouse A Shelf 3"`) is written to the
ledger row, not truncated to a single segment. The ledger column is already a non-normalized text
snapshot, and using the exact same rendering the UI shows keeps the audit trail consistent with
what the user actually saw at claim time — a single-segment truncation would create a second,
divergent notion of "the" location label with no clear rule for which segment to keep.

**Two distinct failure/default behaviors** — read together, not as one blanket "fails closed"
claim (an earlier version of this note, and the CHANGELOG entry, conflated them; corrected as part
of the follow-up below after PR #269 review flagged the discrepancy):
- **Fails closed** (`ValueError`, no default) only if `locationField` has no `x-relationship.target`
  at all (e.g. a bare string column, not a relation) — see §10.1 for that shape, which this
  resolver does not yet support.
- **Defaults to `'name'`** — deliberately, not a bug — if `locationField` *is* declared as a
  relation but its `labelField` sub-key is absent (`location_rel.get('labelField', 'name')` in
  `resolve_ledger_domain()`, pinned by
  `test_location_label_field_defaults_to_name_when_undeclared`). Confirmed acceptable in PR #269
  review (2026-08-04, cmd_550 follow-up): most location-like entities do display a `name` field,
  and requiring every consumer to declare `labelField` explicitly even for the common case would
  be pure ceremony. The requirement is only that this default be *documented* precisely (this
  paragraph) rather than described as "no fallback to name" (which was true for the
  undeclared-relation case but false for this one).

### 7.2 Once-stub / split-route templates read the same declaration (cmd_550 follow-up)

§7.1 above only fixed `generators.py`'s reserve-phase ledger-row write. Four more files rendered
the same `_row.{location_relation}?.name ?? ''` hardcode directly in their Jinja2 source —
undetected by §7.1's own review because the affected-site count was undercounted twice in a row
(the once-stub templates were missed entirely on the first pass; a further *reverse*-lookup site
was found only on a second recount). All nine sites across four files (`ledger_adjust_stub.ts.jinja2`,
`ledger_move_stub.ts.jinja2` ×2, `ledger_write_stub.ts.jinja2` ×2 forward+reverse,
`split_action_route.ts.jinja2` ×3 — two forward, one reverse) now render through
`generate.py`'s `_ledger_stub_field_vars()`, which calls the same `build_label_expression()` §7.1
uses, exposed as a `pool_location_label_exprs` dict keyed by each site's row variable name
(`inventory`, `fromInventory`, `toInventory`, `_childInv`, `_cand`).

**Narrower support than §7.1's reserve-phase write**: these four templates also contain *reverse*
lookups (`tx.<location>.findFirst({ where: { <label field>: <denormalized string> } })`) that
recover a location row from the ledger's previously-written string — a shape §7.1's write-only
fix never had to handle. A reverse lookup cannot unambiguously invert a **composite** (multi-field)
label string back into per-field equality, so `_ledger_stub_field_vars()` fails closed
(generation-time `ValueError`, before any file is written) for the *whole domain* if the declared
`labelField` is composite, resolves through a relation beyond the location entity itself, or
resolves to a date/time field — even for the templates here that only ever do a forward write.
This is a stricter, template-specific rule layered on top of §7.1's domain-level resolution, not a
change to what `resolve_ledger_domain()` itself returns.

**Reverse-lookup uniqueness — known, pre-existing, explicitly out of this fix's scope**: even with
the field name corrected, `findFirst({ where: { <field>: <value> } })` has no uniqueness
guarantee — if two location rows share the same display value, one is picked silently and
arbitrarily. This is not a regression introduced by this fix (the pre-fix `where: { name: ... }`
had the exact same property whenever two locations shared a `name`); it is the same class of
ambiguity documented for autocomplete/list-view label resolution (cmd_547/548). Recorded here,
judged as a separate design question (does a reverse lookup need a stored FK instead of a
denormalized-string round-trip?) rather than folded into this naming-generalization fix, per the
PR #269 review request to record the fact and let scope be judged independently rather than
silently bundled in.

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

## 10. When a consumer's location/lot column doesn't fit the current shape (design notes, cmd_550)

§7.1's fix assumes `locationField` is always a many-to-one relation to a real location entity with
a `name`-or-declared `labelField`. This section works through what happens for the three shapes
that assumption doesn't cover, and whether/how a future consumer could be supported. **Design
notes only — none of this is implemented.** A consumer hitting one of these today gets
`resolve_ledger_domain`'s fail-closed `ValueError` (§7.1), not silent wrong behavior.

### 10.1 Location is a plain string, not a relation

If `locationField` (e.g. `location`) is declared as a bare `type: string` column with no
`x-relationship` at all — no location *entity* exists, just free text — then:

- **Does it work today?** No. `resolve_ledger_domain()` requires `x-relationship.target` on
  `locationField` (§7.1) and raises `ValueError` naming the field and the missing key.
- **What would be needed?** `resolve_ledger_domain` would need a declared flag (e.g. checking
  whether `locationField`'s schema property itself carries `x-relationship`, vs. not) to pick a
  different code path: instead of `build_label_expression('_candidate.{relation}', ...)`, the
  ledger row would read the pool entity's own scalar directly — `_candidate.{location_field}`
  (no relation hop, no `include` needed at all). This is a strict *simplification* of the current
  path, not a new mechanism — the two paths could share the same call site with a branch on
  whether `x-relationship` is present.
- **Stopgap today**: none needed *for existing consumers* — proj_c and proj_g's location columns
  are both real FK relations. A consumer that genuinely has no location entity can currently only
  be modeled by pointing `locationField` at some relation anyway (e.g. a trivial single-column
  lookup entity), which is a real workaround, not a clean fit — flagged here so a future consumer
  doesn't have to rediscover it.

### 10.2 Lot number is a table (FK), not a scalar

If `lotField` (e.g. `lot_number`) is itself a many-to-one relation to a `lot` entity (lot numbers
issued from a registry, carrying their own metadata) rather than a free-text/numeric scalar
column, then:

- **Does it work today?** No — cleanly, but not correctly for this shape. `lot_field` is read as
  `_candidate.{lot_field}` (§7, a direct scalar property access) and written to the ledger row's
  own scalar `lotField` column unchanged. If `lot_field` on the pool entity is actually a FK
  (`lot_id`), this reads the *foreign key id*, not a display value — the ledger row would silently
  store an opaque id string where §7.1's location fix stores a rendered label. No error, because a
  FK column and a scalar column are both just TypeScript `string`/`string | null` — nothing
  type-checks against "this must be a label, not an id."
- **What would be needed?** The same treatment §7.1 gave `locationField`: detect
  `x-relationship` on `lotField`, and if present, resolve `lot_label_field`/`lot_label_target` the
  identical way, rendering through `build_label_expression()` instead of a bare property read.
  This is a direct structural copy of §7.1's fix, not a new design.
- **Stopgap today**: a consumer with a lot-registry FK would need to keep a denormalized scalar
  lot-number column on the pool entity *in addition to* the FK relation (populated by whatever
  writes the FK), and point `lotField` at the scalar column — the ledger row then snapshots a
  human-readable value, at the cost of a second column the schema author must keep in sync.

### 10.3 The consumer doesn't track this dimension at all

If a consumer's pool entity has no location concept whatsoever (e.g. a single-warehouse consumer
with no location/shelf/bin distinction), then:

- **Does it work today?** No — `locationField` (like `itemField`/`lotField`/`expirationField`) is
  OD-1 required with no default (§7); a domain missing the key fails `resolve_ledger_domain` before
  any code generates.
- **What would be needed?** See §10.4 — an explicit "not tracked" declaration, not merely omitting
  the key.
- **Stopgap today**: none — every current consumer (proj_c, proj_g) tracks location, lot, and
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
resolve `location_relation`/`location_label_field`/`location_label_target` to `None`, and every
call site that currently assumes `location_relation` is always a real Prisma field (the `include`
clause, the ledger row's own key) would need an explicit `if location_relation:` branch that omits
that field/include entirely rather than resolving it to a broken empty string.

Why an explicit sentinel over an optional key: an optional key that silently defaults to "not
tracked" when absent reintroduces exactly the bug class §7/§7.1 fixed — a schema author who simply
forgets the key gets no error, just a domain that silently stops tracking location. Requiring the
key to be *present* with an explicit `null` forces the decision to be visible in the schema diff
and reviewable, the same way `x-self-only`'s `admin_bypass` shorthand deliberately never defaults
to the permissive direction (`docs/knowledge` cross-reference: see the self-only-entity design
note). No consumer needs this today, so it has not been built — recorded here so the next time
this question comes up, it doesn't need re-litigating from scratch.
