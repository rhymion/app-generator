# Self-Ref Dependency Fixtures Need Find-or-Create Too

## The observation this confirms

`code_generator/generators_test.py` already had a well-established find-or-create pattern for
non-self dependency records: `_dep_lookup_columns()` picks a deterministic key (`name`, a
field-level `@unique` column, or a `@@unique` group whose columns the record's `create()` actually
writes), and `test_helper.ts.jinja2` renders `findFirst({where}) ?? create(...)` for every dep that
has one. This makes calling a populate helper more than once in the same spec — routine, since
every `it()` block typically calls it — idempotent instead of re-creating rows and tripping
`@unique`/`@@unique` constraints.

Two places didn't have this guard, and both do an unconditional `create()`:

1. **Self-referential dependency records** (`populate{{pascal}}Dependencies()`'s
   `self_ref_deps` loop) — e.g. `goods_receipt_line`'s `parent_goods_receipt_line_id` split-lineage
   decoy. Once the entity itself gains a composite `@@unique` (e.g.
   `@@unique([goods_receipt_id, item_id])`), a second call to the populate helper in the same spec
   creates a duplicate decoy with the identical key and crashes with P2002. **This fix is still in
   place today** (`test_helper.ts.jinja2`'s self-ref loop still renders `findFirst`/create-if-absent).
2. **The entity's own per-iteration record** in `populate{{pascal}}Data()` /
   `populate{{pascal}}FullData()` — the same class of gap, just on the entity's own composite/single
   `@unique` columns instead of a dependency's. **This part of the fix was later reverted** — see
   "Superseded: the entity's-own-record fix was replaced, not kept" below.

## Why the fix isn't a copy-paste of the existing pattern

The existing `lookup_where` is rendered with `fk_prefix=''` because non-self deps are built inside
`_create{{pascal}}BaseDeps()`, where sibling deps are local `const`s (e.g. `location.id`). Self-ref
deps render *outside* that function, in `populate{{pascal}}Dependencies()` itself, where the same
FK vars are only reachable via `baseDeps.<var>.id`. Reusing the empty-prefix `lookup_where` as-is
would emit references to undefined local variables. The self-ref lookup is recomputed with
`fk_prefix='baseDeps.'`, and — critically — *after* the existing item→item2-style fk-rename pass
(the mechanism an earlier fix, commit `6908ff49`, added to keep a self-ref decoy off the same instance as the
primary-display FK), not before: that rename mutates the same `fk_deps` dict entries the lookup
reads, so computing the lookup earlier would bake in a stale, pre-rename variable name.

*(Historical: the entity's-own-record lookup, `record_lookup_where`, originally deliberately
excluded `internal_fk_deps` (bridge FKs like `approvable_id`) from lookup-key candidacy the same
way — see "Superseded" section below for why this whole mechanism no longer exists.)*

## Superseded: the entity's-own-record fix was replaced, not kept

**`record_lookup_where` no longer exists anywhere in the codebase** (confirmed by grep across
`code_generator/`, 2026-09-12). It was entirely removed by a later commit, `46c94cf8`
("full isolation of primary-FK-dep namespace (Option β Phase2)", 2026-08-08) — after this doc was
written. That commit's own message explains why: instead of using find-or-create to make the
entity's own per-iteration record idempotent across repeated calls to the same populate helper, it
made **every** per-iteration create fully unconditional again (both the entity's own record and
`primary_fk_dep`'s own row — `lookup_where_unique`, a second, related lookup this doc didn't
originally describe, was removed at the same time), and instead prevents the underlying collision
with a per-entity monotonic `callIndex` (a module-scope counter in the generated helper, shared
between `populate{{pascal}}Data`/`FullData`) spliced into `primary_fk_dep`'s loop-indexed value:
`` `Test X ${i}` `` becomes `` `Test X ${callIndex}_${i}` ``. `callIndex` is always `0` for a
generated spec's own calls (each `it()` calls a given populate helper at most once), so this is
invisible in generated fixtures beyond the literal string — it only matters for hand-written specs
or composite helpers that call the same populate function more than once in one test/DB session,
which now get disjoint rows per call instead of find-or-create collapsing them onto the same row.
`test_helper.ts.jinja2`'s current per-iteration record create is a plain, unconditional
`prisma.<model>.create(...)` — confirmed no `findFirst` guard around it.

The self-referential-dependency fix (item 1 above) was **not** affected by this later change and
remains in place — this revert was scoped to the entity's-own-record lookup (item 2) only.

## A fixed decoy can still collide with a differently-named test scenario

Fixing the *decoy's own* idempotency doesn't eliminate every composite-unique collision — it just
changes which collisions remain. `goods_receipt_line`'s self-ref decoy (after that fix) is routed
onto the "second" item instance (`item2`, `"Test Sku 2"`) to avoid label collision with the record
under test. Independently, the generic `populate{{pascal}}Data(2)` loop names its second iteration
`"Test Item 2"` / `"Test Sku 2"` — the exact same item. An edit test that intentionally switches a
record's FK to "instance 2" (a common test idiom, also seen in `asn_line`'s 3.3) then targets a
`(goods_receipt_id, item_id)` pair the decoy already occupies, and the edit/update itself now
violates the constraint — no longer a P2002 crash during setup, but a silent update failure (500,
or a UI edit that never navigates away from the edit page). This is not a new bug introduced by
find-or-create; it's the same underlying "composite `@@unique` + `instance 2` naming convention"
class already identified and deliberately left unfixed for `asn_line` 3.3 (see that earlier
report) — this confirmed it now also affects `goods_receipt_line` 3.3 and the analogous API PUT
tests (4.1, 9.1, 9.2), and left them unfixed for the same reason: a real fix needs a third distinct
instance (or some other disambiguation), which is more than "the narrow overlap" this cmd's scope
covers.

## `cy.contains()` anchoring — superseded by a cell-scoped fix

**The specific fix described below (bare `cy.contains(exactRe(...))` +
`.closest('.MuiDataGrid-row')`) no longer exists in the generator templates — it was itself found
buggy and replaced.** Kept here for the reasoning trail; see the current state at the end.

`cy.contains(deps.X.name)` (single string arg) resolves to the most specific matching DOM node —
wrapping it in an anchored regex (`exactRe()`) works directly, *except* when the page also contains
an unrelated exact match elsewhere (see below). `cy.contains('.MuiDataGrid-row', deps.X.name)`
(selector + text) restricts candidates to elements matching the selector *and* whose aggregated
text (all descendant cells concatenated) matches — a DataGrid row has multiple cells, so its full
text is never equal to a single cell's value, and an anchored regex against that never matches.
The fix applied at the time (`cy.contains(exactRe(...)).closest('.MuiDataGrid-row')`: find the
exact cell first, then walk up to the row) was itself superseded by a later fix
(`code_generator/templates/test_spec.cy.ts.jinja2`) after real-schema verification (an entity
whose dependency's display name coincided with the logged-in test user's own name, e.g. a `user`
FK seeded as "Test User" matching the header nav's own "Test User" badge) surfaced two successive
bugs in it: (1) the bare, page-wide `cy.contains(exactRe(...))` preferred the header's own
tight text-node match over the DataGrid cell, so `.closest('.MuiDataGrid-row')` failed outright and
a bare `.click()` navigated to the user's own `/setting/view/<id>` instead of the intended row; (2)
a first attempted fix, scoping to `cy.contains('.MuiDataGrid-row', exactRe(...))`, broke almost
everything else for the reason already given above (a row's concatenated multi-cell text never
equals a single anchored value). **The fix that actually landed and remains current** scopes every
`exactRe` call site to the individual cell instead of the row: `cy.contains('.MuiDataGrid-cell',
exactRe(...))`, with `.find('a').first().click()` directly on the matched cell (no `.closest()`
needed — the cell is the link's direct parent). Verified via DOM inspection that each MUI DataGrid
cell (`data-field="..."`) holds only its own field's text, so an anchored match against one cell
excludes the header while still hitting the intended field.
