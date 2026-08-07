# x-reservation pool entity's non-criteria required FKs

## The problem it solves

`x-reservation` (mode: `count`) declares a pool entity and a single criteria field used to look up
available stock (e.g. `purchase_order`'s pool is `inventory`, criteria `product_id`). Every
generated-test code path that seeds the pool entity resolved **only** that criteria FK. If the pool
entity carries any OTHER required FK (e.g. `inventory.location_id`, added alongside `product_id`),
the generated `prisma.<pool>.create()` call omitted it and threw a
`PrismaClientValidationError: Argument <field> is missing` at seed time.

This silently broke three separate, independently-hand-rolled code paths:

1. `_reservation_base()` (`generators_test.py`) → `test_reservation_helper.ts.jinja2`'s
   `seedReservationXxxMulti/Insufficient/Criteria/OrderBy()` helpers, used by
   `*_reservation_gen.cy.ts` specs.
2. `helper_context()`'s `reservation_lines_pool_seed` block → `test_helper.ts.jinja2`'s
   `populate{{Pascal}}Dependencies()` pool-seed snippet (mode: count **with** `lines`) — this is the
   one that actually caused the reported failures: `cypress/support/purchase_order/helper.ts`'s
   `prisma.inventory.create()` (inside `populatePurchaseOrderDependencies()`, **not**
   `reservation_gen_helper.ts`), driving 20/27 failures in the consuming app's `purchase_order.cy.ts`
   plus 1 in `purchase_order_reservation_gen.cy.ts` — 21 total.
3. `helper_context()`'s `reservation_nolines_pool_seed` block (mode: count **without** `lines`, e.g.
   `supply_request` → `supply_pool`) — same shape, dormant today only because no live pool entity in
   this branch happens to have an extra required FK.

**Do not fix only one of these three.** They are textually separate jinja2/Python code paths with no
shared call graph — fixing `_reservation_base()` alone left the `purchase_order.cy.ts` failure count
completely unchanged, confirmed by an isolated before/after Cypress run. `resolve_dependencies()`
already handles transitive FK deps elsewhere in this file, so it's tempting to assume a broken helper
just isn't calling it — but that has to be checked against **each** of the three builders separately;
grepping for "the bug" once and declaring victory misses the other two.

## The fix

All three now call a common Python-level helper, `_resolve_pool_extra_deps(pool_entity, schema,
enriched_deps, exclude_field)` (`generators_test.py`, defined just above `helper_context()`), which:

1. Calls `resolve_dependencies(pool_entity, schema)` — the same transitive-FK-walk used elsewhere in
   this file (e.g. `helper_context()`'s own datagrid-child-FK resolution) — to get the pool entity's
   full transitive dependency list.
2. Calls `get_entity_fk_deps(pool_entity, schema, ...)` to get the pool entity's own direct FK props,
   filters out `exclude_field` (the criteria field, already handled by the caller; `None` for the
   nolines branch, where there is no criteria field at all — every required FK is "extra").
3. For each remaining FK: if its target already has a resolved dep var **elsewhere in the same
   generated function** (e.g. `purchase_per_item.inventory_id`'s datagrid-child autocomplete FK
   already pulled `location` into scope for `populatePurchaseOrderDependencies()`), reuse that var —
   don't create a duplicate row. Otherwise emit a dedicated fresh create (transitive-safe, since
   `resolve_dependencies()` already recurses).

`_reservation_base()` uses the same three primitives (`resolve_dependencies`/`get_entity_fk_deps`/
`_get_dep_extra_required_fields`) directly rather than through the shared helper, since its output
shape (module-level `createTestPoolXxx()` functions in a standalone template) differs from
`helper_context()`'s inline-within-a-function shape; both converge on the same underlying resolution
logic.

### A latent, still-dormant adjacent bug

While tracing this, `test_helper.ts.jinja2`'s `populate{{Pascal}}Dependencies()` was found to return
`{}` unconditionally whenever `deps` and `reservation_nolines_pool_seed` were both empty/falsy,
without checking `reservation_lines_pool_seed` — silently dropping the pool seed entirely for a
hypothetical entity with `x-reservation.lines` set but no other required top-level FK. Not triggered
by any live consumer today (`purchase_order` has `customer` in `deps`), fixed alongside since it's
the same block being edited.

## Verification

- 15 new injected-fixture tests (render the actual jinja2 template, assert the generated TypeScript
  sets the column, not just that the context dict looks right):
  `code_generator/tests/test_reservation_helper_pool_extra_fk.py` (9, path 1) and
  `code_generator/tests/test_helper_pool_extra_fk.py` (6, paths 2 and 3 — lines and nolines
  branches). Each file includes a byte-identical-when-unaffected regression guard.
- Full `code_generator` pytest suite: 1127 passed, 0 regressions.
- Live isolated-worktree verification against a real consumer app with `purchase_order`/`inventory`:
  before the fix, `purchase_order.cy.ts` + `purchase_order_reservation_gen.cy.ts` = 20 + 1 = 21
  failures (exact match to the field report). After: 28/28 passing. Full API Cypress suite (57
  specs): before/after spec-level comparison confirms zero new failures anywhere else.
- A second consumer app with no `x-reservation` entities declared at all was confirmed unaffected by
  walking its schema with the fixed generator's own `reservation_helper_context()` — mechanical
  confirmation, not a grep guess. N/A for this bug class; nothing to regenerate or compare there.

## Axis sweep

Mechanically walked every entity across both live consumer schemas with `x-reservation` present,
using the fixed generator's own context builders (not manual schema reading) as the source of truth
for "does this pool entity have an extra required FK":

| entity | mode | lines | pool entity | extra required FK beyond criteria | affected |
|---|---|---|---|---|---|
| `purchase_order` | count | `items` | `inventory` | `location` | yes (the reported bug) |
| `supply_request` | count | *(none)* | `supply_pool` | *(none — no required FK on pool)* | no |
| `room_reservation` | item | — | `room` | N/A (mode: item, different code path entirely, not touched by this fix) | out of scope |

Only one pool entity across the schemas that declare `x-reservation` at all has this shape today
(`inventory`), and it's exactly the one the bug report named — the "broaden to every entity" sweep
confirms the fix's scope is complete for the current schemas, not merely that the one reported case
works.
