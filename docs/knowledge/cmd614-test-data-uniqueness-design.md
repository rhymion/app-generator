# Test-data namespace collisions in generated Cypress helpers

## Note on this file

This design doc is referenced by CHANGELOG entries for cmd_618 (Phase 1,
merged in PR #312) and cmd_620 (Phase 2, this change), but was never actually
committed to the repository — the referencing entries pointed at a doc that
didn't exist on disk. This file reconstructs it from the cmd_618/cmd_620 task
reports and the shipped code, and folds in Phase 2. Sections §1-§3 describe
work already merged (Phase 1); §4 covers this change (Phase 2).

## §1. The problem

Generated Cypress test helpers (`cypress/support/{entity}/helper.ts`) create
two kinds of deterministic test rows for a given entity:

- **Shared, non-loop dep rows** — created once by `populate{{ pascal
  }}Dependencies()`, reused across the parent populator and every child
  populator that calls it in the same test. Values follow the pattern `Test
  {Title}` (base instance) / `Test {Title} 2` (a "second, distinct instance"
  variant, used when a test needs two different values for the same FK
  target — e.g. an edit test's "before" and "after"). Idempotent: keyed by a
  deterministic `findFirst({where: ...}) ?? create(...)`.
- **Loop rows** — created per-iteration inside `populate{{ pascal
  }}Data(n)`/`populate{{ pascal }}FullData(n)`'s `for (let i = 1; i <= n;
  i++)` loop. Values follow the pattern `Test {Title} ${i}`.

Both patterns produce the same literal string once a loop reaches `i=2`
(`Test {Title} 2` collides with `Test {Title} ${i}` at `i=2`), and the two
mechanisms can then resolve to the very same database row.

## §2. Two independent collision sites

Two structurally different places in `test_helper.ts.jinja2` can each
independently pick up an existing row instead of creating the fresh one a
test intended:

- **`primary_fk_dep`'s own per-iteration row** (guarded by
  `primary_fk_dep.lookup_where_unique`, generators_test.py's
  `prisma_val_unique`): when the entity's primary display field is itself an
  FK (`prim_is_fk`), each loop iteration creates (or, pre-Phase-2, found-or-
  created) that FK target's own row.
- **`record_lookup_where`**: when the entity's own `@@unique`/`@unique`
  constraint resolves entirely to values already available in the loop body
  (the primary FK dep's item, or another dep-backed FK), the entity's own
  per-iteration row was (pre-Phase-2) also found-or-created against that key
  (cmd_592's original rationale — e.g. `goods_receipt_line`'s
  `@@unique([goods_receipt_id, item_id])`).

## §3. Phase 1 (cmd_618, Option 甲改 "letter-indexed dep namespace", PR #312)

Fixes the **base/second vs. loop** collision (`Test {Title}`/`Test {Title}
2` vs. `Test {Title} ${i}`): `_get_dep_populate_fields()` /
`_get_dep_extra_required_fields()` in `code_generator/generators_test.py`
suffix the shared, non-loop dep values with a letter instead of a bare
string / digit — `Test {Title} A` (base) / `Test {Title} B` (second) — across
every value branch (the `name` field branch, the generic required-string
branch, and the `user`-target special case; all three needed the same
change, not just the `name` branch — the design's own `Test Sku` example
comes from the generic-string branch). `prisma_val_unique` (loop values,
`${i}`) is unchanged in Phase 1.

**Proof: D ∩ L = ∅.** Dep values (D) always end in a letter (`A`/`B`); loop
values (L) always end in a digit (`1`, `2`, `3`, ...). The two sets are
disjoint at the first differing character, for any loop length — this holds
regardless of call order (dep helper called before or after the data
populator).

Four locations elsewhere in `generators_test.py` independently *recompute*
the same expected label (for spec-generation assertions, not for the actual
`prisma.create()` call) and needed the matching letter-suffix update:
`_seed_relation_label_value()`/`_seed_path_part()`'s bare-fallback branches,
`gen_assert_commands()`'s `dep_title` fallback, `gen_child_datagrid_fk_fields()`'s
`label_code` fallback, and `spec_context()`'s user `dep_name`.

**Scope**: Phase 1 does not touch `primary_fk_dep`'s or `record_lookup_where`'s
find-or-create mechanics at all — it only changes which *string* the shared
dep helper produces, so the two mechanisms stop colliding *within a single
call*. It does not address either mechanism sharing a row *across* multiple
calls to the same populate function (§4).

## §4. Phase 2 (cmd_620, Option β "full isolation")

### §4.1 The gap Phase 1 left open

`primary_fk_dep`'s per-iteration find-or-create and `record_lookup_where`'s
find-or-create are both keyed *purely by loop index* (`${i}`), with no
reference to *which call* of `populate{{ pascal }}Data`/`FullData` produced
that iteration. Two calls to the same populate function within one test/DB
session (no `db:reset` in between — e.g. a hand-written spec building two
independent scenarios, or a composite helper calling the populate function
more than once) can therefore have their `i=k` iterations resolve to the
very same underlying row: call 1's `i=1` creates `Test X 1`; call 2's `i=1`
find-or-create looks up `Test X 1`, finds call 1's row, and reuses it. Two
logically independent test objects end up sharing one FK target — for an
entity whose primary display field is (almost) entirely FK, editing one
object's FK reference is then indistinguishable from editing the other's,
because both point at the same row to begin with.

### §4.2 Sufficiency analysis (which entities can actually hit this)

Verified against every `x-generate: test: true` entity in proj_b's and
proj_c's schemas by walking `test_helper.ts.jinja2`/`test_spec.cy.ts.jinja2`'s
actual call patterns:

- Every generated spec's own `it()` blocks call a given populate helper **at
  most once** (`beforeEach` runs `db:reset` before each `it()`); no
  generated helper (`populate*WithMentionUser`, `populate*WithApproval`,
  etc.) calls `populate*Data`/`FullData` more than once internally either.
  So the collision cannot occur from generated code alone, and callIndex is
  always `0` for a generated spec's own calls.
- Hand-written specs and composite generated helpers *can* legitimately
  call the same populate function more than once in one test (that is
  exactly the shape cmd_613's `approval_flow_same_entity_autocomplete_filter.cy.ts`
  and the scenario motivating this change both take) — this is the actual
  exposure.
- Applies to any entity with `primary_fk_dep` set and not `is_user_account`
  (the `is_user_account` branch was never affected — it always created a
  fresh `user` row per iteration, keyed by `Date.now()`, no find-or-create).
  In proj_c's schema this includes `inventory`, `room_reservation`,
  `receiving_receipt_line`, and `purchase_per_item` (all primary-is-FK,
  non-user).

### §4.3 The fix

`test_helper.ts.jinja2`: both find-or-creates removed — `primary_fk_dep`'s
per-iteration row and the entity's own `record_lookup_where`-guarded row are
now unconditional `create()`s in both `populate{{ pascal }}Data` and
`populate{{ pascal }}FullData`.

To keep the second unconditional `create()` from tripping `@unique` on the
primary FK dep's own required fields (the collision this whole mechanism
exists to prevent), a per-entity monotonic `callIndex` is spliced into the
loop value:

```
Test {Title} ${i}          -- before (Phase 1, unchanged from the original)
Test {Title} ${callIndex}_${i}   -- after (Phase 2)
```

`callIndex` is a module-scope counter (`let _{{ Pascal }}CallSeq = 0;`)
declared once in the generated helper file, incremented by both `populate{{
pascal }}Data` and `populate{{ pascal }}FullData` (they share one counter —
either function's call consumes the next index) at the top of each call. It
persists for the life of the Cypress plugin (Node) process, so every call
either function receives during a run gets a distinct index — including
repeat calls within the same test.

`record_lookup_where`'s own computation (`code_generator/generators_test.py`)
is removed entirely — it has no template consumer left. `lookup_where_unique`
(the find-or-create key `primary_fk_dep`'s old branch used) is removed too,
for the same reason.

The four Phase-1 "independently-recompute-the-label" locations were audited
again for Phase 2: only one of them (`_seed_relation_label_value`'s /
`_seed_path_part`'s `unique_index is not None` branches, used by exactly one
call site — a generated 3.1/3.3 edit test's `list_id_1`, always the *first*
and only call, i.e. `callIndex=0`) needed a matching update, hardcoded to a
`0_` prefix rather than threaded dynamically — generated specs never
exercise any other callIndex value. The other three locations concern the
Phase-1 letter axis only and are unaffected by Phase 2.

### §4.4 D ∩ L = ∅ still holds; L(call 0) ∩ L(call 1) = ∅ now also holds

Phase 1's proof is unaffected: `callIndex`-shifted loop values (`0_1`,
`1_1`, ...) still start with a digit, so they remain disjoint from the
letter-suffixed shared dep values (`A`/`B`) at the first differing
character, for any `callIndex`/`i` combination.

Additionally, two different calls' loop namespaces are now disjoint from
each other: `callIndex` differs between any two calls (monotonically
increasing, never reused within a process lifetime), so `Test X
{callIndex_1}_{i}` and `Test X {callIndex_2}_{i}` differ at the first
character after `Test X ` whenever `callIndex_1 != callIndex_2` — no two
calls can ever produce the same primary-FK-dep value, regardless of loop
length or call order.

### §4.5 Verification

- Full `code_generator` pytest suite: 1175 passed, 0 regressions (3
  assertions updated to match the new `${callIndex}_${i}` / `0_{unique_index}`
  literal values; two dead `lookup_where_unique` assertions removed).
- proj_c (`room_reservation`, a primary-is-FK, non-user entity): built a
  minimal reproduction script calling `populateRoomReservationData(1)` twice
  in the same DB session. Deviation-injection round-trip in an isolated
  worktree + dedicated docker-compose stack: reverted `generators_test.py`/
  `test_helper.ts.jinja2` to the pre-Phase-2 commit, regenerated, reran — both
  calls resolved `room_type_id` to the *same* row (reproducing the collapse
  exactly as predicted); restored the fix, regenerated, reran — the two
  calls produced independent `room_type` rows (`Test Room Type 0_1` /
  `Test Room Type 1_1`). Also exercised the edit scenario directly: updated
  the first record's `room_type_id` to the second record's value (A→B
  swap), confirmed the second record's own `room_type_id` was untouched by
  that edit (no cross-contamination between the two independently-created
  objects).
- proj_b mandatory gate (lint / pytest / vitest / mention-gate /
  `test:e2e:build` / `check:generated` / `test:e2e:cy:api` /
  `test:e2e:cy:ui` / `npm audit` / `pip-audit`) and proj_c's mandatory gate
  (`test:e2e:cy:api`) — see the cmd_620 task report for full results.
