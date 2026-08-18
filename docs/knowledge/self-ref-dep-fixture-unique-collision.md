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
   creates a duplicate decoy with the identical key and crashes with P2002.
2. **The entity's own per-iteration record** in `populate{{pascal}}Data()` /
   `populate{{pascal}}FullData()` — the same class of gap, just on the entity's own composite/single
   `@unique` columns instead of a dependency's.

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

The entity's-own-record lookup (`record_lookup_where`) deliberately excludes `internal_fk_deps`
(bridge FKs like `approvable_id`) from lookup-key candidacy, even though they're in scope for
*rendering* the `create()` call. An internal bridge FK is always freshly created per iteration —
keying a `findFirst` on it would never find anything and would silently do nothing (worse than no
guard at all, since it looks like protection but isn't). Composite/single-unique candidacy is
checked only against `primary_fk_dep` (the var that varies per loop iteration) and other
dep-backed FKs in `required_fields_prisma` — columns the `create()` doesn't actually write (e.g.
nullable/DB-defaulted, hence absent from those two sources) fall through and the entity gets no
lookup at all, exactly like the pre-existing non-self-dep behavior when a constraint mentions an
unwritten column.

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

## `cy.contains()` anchoring only needed for one call shape

`cy.contains(deps.X.name)` (single string arg) resolves to the most specific matching DOM node —
wrapping it in an anchored regex (`exactRe()`) works directly. `cy.contains('.MuiDataGrid-row',
deps.X.name)` (selector + text) restricts candidates to elements matching the selector *and* whose
aggregated text (all descendant cells concatenated) matches — a DataGrid row has multiple cells, so
its full text is never equal to a single cell's value, and an anchored regex against that
never matches. The fix for that shape is `cy.contains(exactRe(...)).closest('.MuiDataGrid-row')`:
find the exact cell first, then walk up to the row.
