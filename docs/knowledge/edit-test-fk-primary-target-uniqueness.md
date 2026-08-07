# Edit-test FK-primary target must not collide with a populate-loop sibling (cmd_594)

## The rule

For any entity whose primary display field is an FK, the generated "3.3 edits with mixed changes"
e2e test must switch that field to a value that is guaranteed distinct — on every column of every
composite `@@unique` the field participates in — from every other row the test's own fixtures
create. This is now a structural property of `code_generator/generators_test.py`, not a per-entity
patch.

## The bug this closes

`self-ref-dep-fixture-unique-collision.md` (cmd_592) predicted this exact failure and left it
unfixed as out of scope: `populate{{pascal}}Data(2)`'s loop creates two rows sharing every
composite-unique column except the primary FK (e.g. `asn_line`'s `asn_id` is constant across both
loop iterations; only `item_id` varies). The generated 3.3 test then edited row 1 to the primary
FK's "second instance" (`deps.item2`, label `'Test Sku 2'`) — but that is the *exact same row* the
loop's own second iteration already attached via find-or-create (cmd_592), because both are keyed
off the identical deterministic name. The edit's `update()` therefore collided with `@@unique` and
threw `P2002` (real failures reproduced pre-fix: `asn_line.cy.ts` 3.3 and `purchase_order_line.cy.ts`
3.3, both `[asn_id/purchase_order_id, item_id]`).

cmd_592's doc speculated the real fix would need "a third distinct instance." It doesn't — see
below.

## The fix

`spec_context()`'s `prim_is_fk` branch (`code_generator/generators_test.py`, `list_id_updated`)
now targets the dependency helper's **base (un-suffixed) instance** — e.g. `deps.item`, label
`'Test Sku'` — instead of the second instance. The base instance:

- is *always* created by `populate{{pascal}}Dependencies()` whenever the primary field is FK
  (it's the primary's own required dependency, not an extra row added for this purpose), so no new
  fixture creation was needed;
- is *never* produced by `populate{{pascal}}Data()`'s loop, which only ever emits suffixed names
  (`'Test X {i}'`, i ≥ 1) — confirmed structurally: `_seed_relation_label_value(unique_index=N)`
  always appends a numeral when `unique_index` is not `None`, and the base instance is computed
  with no `unique_index` at all.

Because the base instance is provably free of every loop-created row's key by construction, this
is safe **unconditionally** — not just for entities with a composite-unique collision risk. The
fix therefore applies to every `prim_is_fk` entity uniformly (verified: proj_c's `inventory`,
`leave_request`, `room_reservation`, `shift`, `shift_template` also changed target string as an
expected side effect, with zero behavior change since none of them had a live collision).

## Split carve-out (not yet needed)

`x-splittable` parent/child rows are *intentionally* allowed to share the same composite-unique
tuple (cmd_596 finding: goods_receipt_line's split parent/child share `(goods_receipt_id,
item_id)` by design). If a future split-action e2e fixture reuses this 3.3 edit-test machinery
against a split parent/child pair, it will need an explicit carve-out from this rule. Not
implemented here — split e2e tests are 0 across both proj_g and proj_c as of this writing, so
there is nothing to carve out yet; flagging the sharp edge for whoever adds the first one.

## What this doesn't fix

`approval_flow`'s `precededBy`/`followedBy` both displaying as `'setting'` (cmd_593 finding) is a
**different** failure class — the primary field there is a plain string (`entity_name`), not an
FK, so `spec_context`'s `prim_is_fk` branch never runs for it. That needs a labelField design
change, out of this fix's scope.
