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

## 7. Not yet implemented — do not treat as current behavior

**x-reservation key reduction (item2) is unapproved and unimplemented.** The `x-reservation`
key structure documented in §1 above (`pool`/`request`/`policy`/`result`, three current uses:
`purchase_order`, `supply_request`, `room_reservation`) is the *current* schema shape. A design
to classify each key as generator-read vs. dead and remove/replace unused keys (especially in
`count` mode) is pending review and approval (dashboard action item) as of this writing — it has not
been designed into code. Do not assume any `x-reservation` key documented here has been removed
or replaced until that design lands and a follow-up doc update reflects the actual diff.
