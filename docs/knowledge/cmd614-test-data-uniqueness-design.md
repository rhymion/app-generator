# Test-data namespace collisions in generated Cypress helpers

## Note on this file

This design doc is referenced by CHANGELOG entries for Phase 1
(merged in PR #312) and Phase 2 (this change), but was never actually
committed to the repository — the referencing entries pointed at a doc that
didn't exist on disk. This file reconstructs it from the Phase 1/Phase 2 task
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
  (an earlier fix's original rationale — e.g. `goods_receipt_line`'s
  `@@unique([goods_receipt_id, item_id])`).

## §3. Phase 1 (Option 甲改 "letter-indexed dep namespace", PR #312)

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

## §4. Phase 2 (Option β "full isolation")

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
  exactly the shape an earlier fix's `approval_flow_same_entity_autocomplete_filter.cy.ts`
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
  (`test:e2e:cy:api`) — see the Phase 2 task report for full results.

## §5. Phase 3 ("per-test-case callIndex reset")

### §5.1 The gap Phase 2 left open

Phase 2 introduced `_{{ pascal }}CallSeq` as a **monotonically increasing,
process-lifetime** counter. This was the correct design for its stated goal —
distinguishing multiple calls to the same populate function *within one test*.
However, the process-lifetime property violates a deeper invariant:

> "callIndex must reset for each test case. The database resets between test
> cases; the counter must too. Running only one test case within a spec must
> produce identical results to running the full spec — output must be
> independent."

Two failure modes follow directly from the process-lifetime counter:

**Mode 1 — Cross-`it()` counter leak.** When two `it()` blocks in the same
spec both call `populate{{ pascal }}Data`, the second `it()` receives
`callIndex=1`. Generated spec assertions are hardcoded to the `0_` prefix
(§4.3), so the second `it()` fails. Observed in proj_g: `asn_line.cy.ts`
calls `populateAsnLineData` from both it()-1.2 and it()-1.3; 32 tests across
11 specs failed (CI run 31287736706).

**Mode 2 — Isolation failure.** Running only it()-1.3 in isolation yields
`callIndex=0` (test passes); running the same spec from the top gives
`callIndex=1` for it()-1.3 (test fails). The same test case produces
different results depending on which other tests preceded it — independence
is broken.

### §5.2 Wrong assumption in §4.2, corrected

§4.2 stated: "Every generated spec's own `it()` blocks call a given populate
helper *at most once*." This is false for proj_g, which contains entities
(`asn_line`, `inventory`, and others) where the generated spec has multiple
`it()` blocks that each call the same populate function. The assumption was
drawn from proj_b and proj_c schemas only; proj_g was not in scope for that
analysis (§4.2's own caveat).

The §4.3 conclusion is **unaffected**: assertions remain hardcoded to the
`0_` prefix. The fix is purely runtime.

### §5.3 Option comparison

| | Option A (recommended): `beforeEach` reset task | Option B: explicit seed parameter |
|---|---|---|
| **Mechanism** | Add `_reset{{ pascal }}CallSeq()` to helper; expose as `db:reset{{ pascal }}CallSeq` Cypress task; call in `beforeEach` | Pass `callIndexSeed` arg to `populate*Data(n, seed=0)`; generated specs always pass 0 |
| **API change** | None to populate functions | Breaking: all callers (specs, composite helpers) must pass seed |
| **generators_test.py** | 0 changes | Requires updating `gen_populate_call()` and assertion generation |
| **Shared mutable state** | Eliminated per-`it()` | Eliminated entirely |
| **Hand-written spec compat** | Transparent — reset happens automatically | Requires manual seed bookkeeping per call site |
| **Verdict** | Minimal change; purely runtime; consistent with existing `db:reset` semantics | Larger blast radius; breaking caller API |

**Recommendation: Option A.**

The key insight is that `beforeEach` already resets the database; resetting
the callIndex counter at the same time restores the symmetric invariant: both
DB state and call-sequence counter are fresh at the start of every test case.

### §5.4 The fix (Option A)

Four template files are touched; `generators_test.py` requires **zero**
changes.

#### Change 1 — `test_helper.ts.jinja2`

Inside the existing `{% if primary_fk_dep and not primary_fk_dep.is_user_account and primary_fk_dep.extra_required_fields %}` block, immediately after `let _{{ pascal }}CallSeq = 0;`, add:

```typescript
export function _reset{{ pascal }}CallSeq(): void {
  _{{ pascal }}CallSeq = 0;
}
```

The same condition guard ensures the function is generated only when the
counter exists. The `export` keyword is required so the task registry can
destructure it via `require()`.

#### Change 2 — `test_tasks_registry.ts.jinja2`

Inside `{% for entity in entities %}`, after the existing per-entity task
block, add a conditional reset task:

```typescript
{% if entity.primary_fk_dep and not entity.primary_fk_dep.is_user_account and entity.primary_fk_dep.extra_required_fields %}
    'db:reset{{ entity.pascal }}CallSeq'() {
      const { _reset{{ entity.pascal }}CallSeq } = require('{{ entity.helper_path }}');
      _reset{{ entity.pascal }}CallSeq();
      return null;
    },
{% endif %}
```

The `require()` hits the Node.js module cache — it re-uses the already-loaded
helper module (the same instance whose `_{{ pascal }}CallSeq` counter
`populate*Data` mutates), so the reset is guaranteed to affect the live
counter, not a stale copy.

#### Change 3 — `test_spec.cy.ts.jinja2`

In `beforeEach`, before `cy.task('db:reset')`, add:

```typescript
{% if primary_fk_dep and not primary_fk_dep.is_user_account and primary_fk_dep.extra_required_fields %}
    cy.task('db:reset{{ pascal }}CallSeq');
{% endif %}
```

Placing it first groups both resets at the top of `beforeEach`, making the
semantic pairing explicit: DB state and call-sequence counter are both zeroed
before each test case.

#### Change 4 — `test_spec_mobile.cy.ts.jinja2`

Identical insertion as Change 3, applied to the mobile spec template's
`beforeEach` block.

### §5.5 Invariant maintenance proofs

**D ∩ L = ∅ (Phase 1 property, unchanged).**
Dep values end in a letter (`A`/`B`). After the reset, loop values produced
by any `it()` are `0_1`, `0_2`, ... — still starting with a digit. The two
sets remain disjoint at the first differing character. ✓

**L(call 0) ∩ L(call 1) = ∅ within one `it()` (Phase 2 property, unchanged).**
If a single `it()` block calls `populate*Data` twice (hand-written scenario),
the first call still gets `callIndex=0` and the second gets `callIndex=1`
(the counter increments within the test, exactly as Phase 2 intended). Values
`0_k` and `1_k` are distinct. ✓

**NEW — Independence across `it()` blocks.**
Every `it()` block runs `beforeEach`, which calls
`cy.task('db:reset{{ pascal }}CallSeq')` → `_{{ pascal }}CallSeq = 0`. The
first populate call in any `it()` therefore always receives `callIndex=0`,
regardless of how many prior `it()` blocks ran and incremented the counter.
Generated spec assertions hardcoded to the `0_` prefix always match. ✓

**NEW — Isolated-run equivalence.**
Running only it()-1.3 in a spec: `beforeEach` runs once, resets counter to
0, first populate call gets `callIndex=0`. Running the full spec to it()-1.3:
`beforeEach` has run for it()-1.1 and it()-1.2, resetting to 0 each time;
when it()-1.3 runs, `beforeEach` resets to 0 again. Same `callIndex=0` in
both cases. ✓

### §5.6 Verification procedure

To be executed by the implementing agent after code generation, in the proj_g
worktree (easiest to demonstrate — confirmed 6 entities with callSeq, 11
specs previously failing).

**Prerequisites.** Working test environment: `docker compose up -d --wait`,
`npm run db:push`, `npm run db:generate`, `npm run db:seed-tenant`.

**Case A — Full spec run (regression baseline)**

`asn_line` is the canonical demonstration entity: its generated spec's
it()-1.2 and it()-1.3 both call `populateAsnLineData`.

```bash
# With the fix applied:
npx cypress run --spec cypress/e2e/asn_line.cy.ts
# Expected: all tests PASS
```

**Case B — Isolated single-`it()` run (independence check)**

1. Record the data patterns created when running the full spec (Case A) —
   specifically the `0_1`, `0_2` suffixes in it()-1.3's rows.
2. Reset the DB (`npm run db:push` or equivalent), then run only it()-1.3 by
   marking it as `.only` or via `--env grep`.
3. Verify the value patterns from step 2 match step 1's it()-1.3 execution —
   same `Test ... 0_1` / `Test ... 0_2` patterns appear in both runs.

**Pre-fix regression demonstration (optional).**
Revert the four template changes, regenerate, run the full spec: it()-1.3
will produce `1_`-prefixed values and fail assertions expecting `0_`. Run
only it()-1.3 in isolation — it passes (callIndex=0). This demonstrates the
independence violation the fix addresses.

### §5.7 Scale

| Measure | Count | Notes |
|---------|-------|-------|
| Template files changed | 4 | `test_helper.ts.jinja2`, `test_tasks_registry.ts.jinja2`, `test_spec.cy.ts.jinja2`, `test_spec_mobile.cy.ts.jinja2` |
| `generators_test.py` functions changed | 0 | Assertions already hardcoded to `callIndex=0`; no Python changes required |
| proj_b helper files with callSeq | 1 | `approval_flow` — corrected post-implementation (this design estimate predated generate-code verification against proj_b's real schema; see the Phase 3 fix's commit message and §6 below) |
| proj_c helper files with callSeq | 4 | `inventory`, `room_reservation`, `receiving_receipt_line`, `purchase_per_item` (from §4.2) |
| proj_g helper files with callSeq | 6 | From CI failure analysis; 11 specs confirmed failing pre-fix |
| proj_c spec files affected (desktop + mobile) | up to 8 | 4 entities × up to 2 spec types |
| proj_g spec files affected (desktop + mobile) | up to 12 | 6 entities × up to 2 spec types |

## §6. Phase 3 follow-up: API spec coverage + hand-written spec rule

PR #319's diff was reviewed before merging, raising two questions: whether
`test_api_spec.cy.ts.jinja2`'s omission from the four-template diff was
intentional, and whether hand-written specs needed anything. Both are
answered here.

### §6.1 test_api_spec.cy.ts.jinja2 had the same missing-threading defect

`api_spec_context()` — like `spec_context()` and `tasks_registry_context()`
before the Phase 3 fix — never computed `primary_fk_dep`. Unlike those two,
it was never touched by the original four-template diff at all, so its
`beforeEach` had no reset call and no guard to add one.

This was safe **by accident, not by design**: a grep of
`test_api_spec.cy.ts.jinja2` for `check_field`, `list_id`, and `'Test `
literals returned zero hits — the API spec never asserts against the exact
counter-suffixed value, so a stale (non-reset) counter couldn't yet break
anything. But `test_api_spec.cy.ts.jinja2` *does* call
`db:populate{{ pascal }}`/`{{ pascal }}Dependencies` (confirmed by grep —
every `it()` block populates its own data), so it does advance the shared
counter same as the desktop/mobile specs. Relying on "nobody currently
asserts the literal" as the safety argument is fragile: the day someone
adds a `check_field`/`list_id` assertion to this template without knowing
the counter isn't reset here, it silently inherits the cross-`it()` leak
Phase 3 was built to fix.

Fixed with the same pattern as the other three templates: `generate.py`
injects `helper_ctx['primary_fk_dep']` into `api_ctx` right after building
it (mirroring the `spec_ctx['primary_fk_dep'] = ...` line already used for
the desktop/mobile specs), and `test_api_spec.cy.ts.jinja2`'s `beforeEach`
gained the same guarded `cy.task('db:reset{{ pascal }}CallSeq')` call
before `db:reset`. `code_generator/tests/test_callindex_per_testcase_reset.py`
gained matching coverage (`test_api_spec_context_needs_primary_fk_dep_injected_by_generate_py`,
`test_api_spec_calls_reset_task_in_before_each`, and an extra assertion in
`test_entity_without_extra_required_fk_gets_no_reset_plumbing`) — the same
three-shape lock-in already used for the desktop/mobile spec templates.

### §6.2 Rule: hand-written specs calling `db:populate<Entity>[Full]`

A hand-written (non-generated) spec that calls
`cy.task('db:populate<Entity>')` or `db:populate<Entity>Full` for an entity
meeting the reset-guard condition (`primary_fk_dep` set, not a user-account
FK, with `extra_required_fields`) advances that entity's shared,
process-lifetime `_<Entity>CallSeq` counter exactly like a generated spec
does. It is **not** automatically covered by the generated specs'
`beforeEach` reset, because it's a separate `describe` block with its own
`beforeEach`.

Two independently-sufficient ways to stay safe, pick whichever fits the
test's own intent better:

- **(a) Never hardcode the counter-derived literal.** The
  `` `Test {title} ${callIndex}_${i}` `` form (§4.3) is only a problem for
  assertions that hardcode it. Round-trip the actual seeded value instead —
  capture it from the populate task's return value or read it back from the
  UI/API response, then assert against that captured value. This is
  strictly safer than a reset, because it stays correct even if the spec
  later gets called from a context where the counter *isn't* zero (a second
  `it()` in the same spec, a future composite helper, etc.) — see
  `fk_read_permission_graceful_degradation.cy.ts`'s Phase 2① fix, which is
  the reference example: it replaced a hardcoded `'Test Approver Role 1'`
  assertion with `cy.getFieldValue('Approver Role').then((label) => ...)`.
- **(b) Add the same reset call the generated specs use.** If the spec
  genuinely needs a hardcoded literal (e.g. it's asserting a value it seeds
  itself and controls entirely), add
  `cy.task('db:reset{{ pascal }}CallSeq')` to the spec's own `beforeEach`,
  before `db:reset` — identical to the line `test_spec.cy.ts.jinja2` /
  `test_api_spec.cy.ts.jinja2` emit. This only works if the entity actually
  has the reset task registered (check `cypress/support/generated-tasks.ts`
  for `db:reset<Entity>CallSeq` first).

**Verified (this follow-up) against proj_b's only current callSeq entity,
`approval_flow`.** Every hand-written spec calling `db:populate` for any
entity was enumerated (`grep -rl 'db:populate' cypress/e2e --include='*.cy.ts'`,
excluding files starting with the `AUTO-GENERATED` marker) and checked:

- `approval_flow_same_entity_autocomplete_filter.cy.ts` calls only
  `db:populateApprovalFlowDependencies`, which never touches
  `_ApprovalFlowCallSeq` (only `populateApprovalFlowData`/`FullData` do) —
  structurally unaffected, no change needed.
- `fk_read_permission_graceful_degradation.cy.ts` calls
  `db:populateApprovalFlow`/`db:populateApprovalFlowFull` (both advance the
  counter) but already follows mitigation (a) end-to-end — no change needed.
- No other hand-written spec calls `db:populate` for an entity that has the
  callSeq mechanism at all (confirmed by cross-checking
  `cypress/support/generated-tasks.ts` for `CallSeq` — only `approval_flow`
  has it in proj_b's current default schema).

If a future schema change gives a second proj_b entity the reset-guard
condition, re-run this same enumeration against that entity's populate
calls — do not assume "no hardcoded literal problems today" generalizes
without re-checking.
