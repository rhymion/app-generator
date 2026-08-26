# Handing the pre-edit row to `validateCustomRules()`

## Problem

A hand-written business rule in `lib/{entity}/service_validation_custom.ts`
(the write-once socket described in `same-entity-validation-socket.md`)
could only see `data`, the values being submitted by this write. That is
enough to reject a value that is wrong on its own terms ("X is not on the
claimed policy"), but not enough to reject a value based on what the field
held *before* this write — e.g. "status may not change once it reaches
`closed`", or "a description that has been set may not be cleared". Those
checks need the row as it stood immediately before the write, not just what
is being written now.

The chosen fix hands the pre-edit row to `validateCustomRules()` as a new
argument, using the existing custom-validation socket rather than a new
schema-declared mechanism. A schema-level "lock this field once status is
X" declaration was considered and explicitly declined for now — the
condition/field combinations that would need locking aren't known yet, and
building generic machinery for an unknown shape produces dead code. That
stays undecided pending a real recurring pattern across more than one
entity.

## The mechanism

### One fetch, not two

`update{Parent}()` (`service.ts.jinja2`) already read the row a second time
in one case: an entity with an `x-approval` edge trigger (`submit_on`
declared) needs the row's value *before* the write to detect the pending→
submitted transition. That fetch used to run *after* `validateOnUpdate()`,
selecting only the two columns the trigger needed:

```ts
// before
await validateOnUpdate(tx, id, { ...data });
// ... later ...
const _prevForTrigger = await tx.{{ model }}.findUnique({
  where: { id },
  select: { {{ submit_on_field }}: true, {{ approvable_fk }}: true },
});
```

Every other entity had no pre-edit fetch at all. Since the row is needed
for validation on *every* `can_update` entity now, not just approvable
ones, the fetch moved earlier and lost its narrow `select` (a hand-written
rule cannot know in advance which columns it needs):

```ts
// after
const _prevRow = (await tx.{{ model }}.findUnique({ where: { id } })) as Record<string, unknown> | null;
await validateOnUpdate(tx, id, { ...data }, _prevRow);
// ... later, only on entities with an x-approval edge trigger ...
if (_prevRow && _prevRow.{{ submit_on_field }} !== ...) { ... }
```

One `findUnique` by primary key, reused by both consumers. Moving it ahead
of `validateOnUpdate()` (and, on entities that have one, of the
`assertNotStale()` optimistic-lock check) does not change observable
behavior: `assertNotStale` and `_prevRow` are independent reads against the
same transaction snapshot, `fk_preservation_update_code` and
`reservation_mutation_guard_update` mutate `data`/throw before either read
runs (unchanged), and `_prevAssigneeId`'s own narrower `findUnique` (a
different concern — captured for a post-commit notification, not
validation) is untouched. See
`code_generator/tests/test_approval_edge_trigger.py`'s
`TestUpdateTimeTrigger` for the regression coverage proving the trigger
condition still reads correctly off the wider, earlier fetch, and
`test/flows/pre_edit_row_custom_validation.test.ts` for a real-DB proof
that the general (non-approval) path works end to end.

On `add{Parent}()` (create), there is no previous row — `prevRow` is always
`null` there.

### Backward compatibility: a widened function type, not a version branch

`service_validation_custom.ts` is GENERATED-ONCE (skip-if-exists) — an
already-generated entity's hand-written file is never rewritten in place.
Every entity generated before this change has a
`validateCustomRules(tx, data, currentId)` — three parameters, no more.
Calling it with a 4th argument would be a TypeScript compile error
("Expected 3 arguments, but got 4") if called at its own declared type.

The fix is not a runtime branch or a schema flag — it is a type-level cast
at the one call site (`service_validation.ts.jinja2`, which is fully
regenerated on every run, unlike the stub):

```ts
type CustomRulesFn = (
  tx: TransactionClient,
  data: Record<string, unknown>,
  currentId: string | null,
  prevRow: Record<string, unknown> | null,
) => Promise<void>;

await (validateCustomRules as CustomRulesFn)(tx, data, currentId, prevRow);
```

A function type with *fewer* parameters is always structurally assignable
to one with *more* — the same rule that lets `(x) => x` satisfy an
`Array.prototype.map` callback typed to take `(item, index, array)`. So
this cast typechecks against both an old 3-parameter implementation and a
new 4-parameter one. At runtime, JavaScript silently discards a call's
trailing arguments a function doesn't declare — an old stub simply never
binds `prevRow`; a new one receives it. No back-compat branch, no version
flag: the callee's own signature is what decides whether `prevRow` gets
used, exactly the same "generator provides a socket, hand-written code
decides" split as the rest of this mechanism.

Verified empirically, not just by construction: this repo's own two
tracked write-once stubs predating this change
(`lib/approval_flow/service_validation_custom.ts`,
`lib/dashboard/service_validation_custom.ts`) both still declare the old
3-parameter signature and were **not** touched by it (GENERATED-ONCE
honored it) — `npm run test:e2e:build`'s `next build` compiles this repo
cleanly against both of them unmodified.

### Impact on existing consumers (measured, not guessed)

A naive argument-count bump would break any existing hand-written
`service_validation_custom.ts` across every consumer app, so the actual
count of those files was measured rather than assumed away. Measured
against each consumer's tracked `prj/lib/` (the source of truth for
hand-written files that survive regeneration — see
`generated-output-vs-template-sot-drift` skill; this repo's own
`lib/*/service_validation_custom.ts` is ephemeral/gitignored per entity
except for the two files above, so `prj/lib/` is the only place a
consumer's *real*, persistent custom rules live) on 2026-08-26:

| Consumer | repo | `prj/lib/**/service_validation_custom.ts` count |
|---|---|---|
| app-template | rhymion/app-template | 0 as measured on 2026-08-26; see "Where the regression fixture actually lives" below for the follow-up that adds one there |
| inventory-app | rhymion/inventory-app | 0 |
| insurance-app | rhymion/insurance-app | 11 (`claim`, `claim_line`, `policy_coverage`, `policy_party`, `policy_status_history`, `bank_account`, `billing_account`, `commission_entry`, `endorsement`, `payout`, `premium_rate`) |

insurance-app's 11 files (read-only access) all declare the pre-change
3-parameter signature (spot-checked `claim`'s), confirming the widening
cast is not just theoretically compatible but is protecting real,
in-production hand-written rules — this is exactly the insurance-domain
"value IS present but rejected by a business rule" pattern that originally
motivated this whole feature.

### The socket does not implement UI-side locking

A save-time rejection here is a server-side backstop only — the UI still
lets the user edit the field and only fails on save (the same shape of gap
raised about FK filters elsewhere: "it lets you pick it, but then it won't
save"). This change deliberately does **not** build a generated bridge from
a hand-written predicate to the UI — that stays declined pending a real
recurring pattern across at least two or three entities. The new stub
template (`service_validation_custom_stub.ts.jinja2`) leaves a comment
describing the shape a future bridge could take (a plain, synchronous
`forbiddenFieldsFor(prevRow)` export a client form could also import) so a
hand-written rule that needs one isn't inventing the shape from scratch —
nothing is generated from it yet.

## Files touched

- `code_generator/templates/service.ts.jinja2` — the `_prevRow` fetch
  (moved/merged/widened), `_prevForTrigger` renamed to `_prevRow`
  throughout.
- `code_generator/templates/service_validation.ts.jinja2` — `CustomRulesFn`
  cast, `validateSchemaRules`/`validateOnAdd`/`validateOnUpdate` all take
  `prevRow`.
- `code_generator/templates/service_validation_custom_stub.ts.jinja2` — new
  stub's `validateCustomRules` signature gains `prevRow` (4th parameter),
  plus the future-UI-bridge comment above.
- `code_generator/generators.py` — the approval edge-trigger's update-time
  code reads `_prevRow` instead of building its own narrower select-scoped
  fetch (removed; no longer needed, the shared fetch already selects the
  full row).
- A real, minimal regression fixture proving the mechanism end to end
  against a live Postgres test DB: an organization's `description`, if it
  carries a `PRE_EDIT_ROW_FIXTURE_LOCKED` marker, may not be cleared. See
  "Where the regression fixture actually lives" below — it does **not**
  live in this repo.

## Where the regression fixture actually lives

The fixture above (and the flow test that exercises it) was initially
added directly to this repo's own dogfood app —
`lib/organization/service_validation_custom.ts` plus
`test/flows/pre_edit_row_custom_validation.test.ts` — then relocated to
app-template (a real consumer, not this generator's own self-generated
copy) once review flagged that a purely test-only fixture with no product
meaning had no business living in the generator's own history. Purely
test-only, hand-written scaffolding belongs in a consumer testbed, not in
the generator repo whose own generated output and generated tests it can
collide with — which it did, twice, precisely because it lived here (see
the two impacts noted below).

The rule and the flow test now live under app-template's `prj/`
(`prj/lib/organization/service_validation_custom.ts`,
`prj/test/flows/pre_edit_row_custom_validation.test.ts`) — `prj/` is
app-template's own source of truth for hand-written files that survive
regeneration, synced into the generator checkout by `prj:sync` on every
`generate-code`. This repo's own `.gitignore` no longer force-tracks
`lib/organization/service_validation_custom.ts` — with the fixture gone,
GENERATED-ONCE regenerates the plain no-op stub for `organization`, same
as every other entity that has no hand-written rule.

**Coverage note**: this generator's own CI no longer proves the mechanism
end to end (its self-generated `organization` entity has no custom rule
to exercise) — `code_generator/tests/test_approval_edge_trigger.py`'s
`TestUpdateTimeTrigger` and
`code_generator/tests/test_validation_message_reason_and_context_filter.py`
still prove the generator emits the `_prevRow` fetch and the call-site
cast correctly (neither depends on a generated artifact), but proving a
real save is actually rejected using `prevRow` now depends on
app-template's own gate, not this repo's. That is an intentional, accepted
trade — the alternative was reintroducing the exact scaffolding problem
this move fixes.

The two things that broke while the fixture lived here, both because a
hand-written scaffold sat inside the generator's own generated output:

1. The first version of the rule keyed on "any non-empty description"
   rather than a marker, and broke this generated entity's own standard
   Cypress CRUD spec (`cypress/e2e/organization.cy.ts`'s "3.2 removes
   optional data and child items"), which always fills every optional
   field (via `db:populateOrganizationFull`) and then clears it as routine
   coverage that optional fields really are optional — a UI e2e job caught
   this on CI (`E2E Tests`, PR #431's first run), not the local API-only
   gate. Any fixture hung on a real, generated, exercised entity needs to
   check it isn't colliding with that entity's own generated test suite; a
   marker value no generated fixture ever produces sidesteps the problem
   while still genuinely exercising `prevRow`.
2. `npm run test:e2e:cy:api`/`:cy:ui` run against `next start` (a prebuilt
   server bundle), and the very first local verification pass ran them
   against a build taken *before* the fixture file was hand-edited —
   `next start` silently keeps serving the old bundle rather than
   erroring, so the run looked green while actually never exercising the
   new rule at all. A rebuild (`next build`) is required after any edit to
   a write-once stub, in any consumer, before trusting a subsequent `next
   start`-based e2e run's result.

## Tests

- `code_generator/tests/test_approval_edge_trigger.py` —
  `TestUpdateTimeTrigger` (renders confirm `_prevRow` is fetched
  unconditionally on every `can_update` entity, and that the approval
  trigger's condition reads off it correctly by name). Stays in this repo
  — it does not depend on a generated artifact.
- `code_generator/tests/test_validation_message_reason_and_context_filter.py`
  — the `validateCustomRules` call-site text assertion, updated for the new
  cast + `prevRow` argument. Stays in this repo for the same reason.
- The real-DB flow test proving a save is actually rejected using
  `prevRow` now lives in app-template
  (`prj/test/flows/pre_edit_row_custom_validation.test.ts`) — see "Where
  the regression fixture actually lives" above. Before the move, running
  it in this repo proved: clearing a marker-locked `description` is
  rejected (both via `''` and via `null`), changing it to another
  marker-carrying value succeeds, clearing an *ordinary* (unmarked)
  description succeeds (proves the rule doesn't fire on plain data), and
  clearing a description that was never set at all (no prior value to
  protect) succeeds.
- The historical results below were measured while the fixture still
  lived in this repo, before the move — kept as a record of what was
  verified at the time; this repo's own suites no longer exercise the
  fixture. The full UI e2e suite (`npm run test:e2e:cy:ui`) was run, after
  a clean rebuild reflecting the marker-scoped fixture, before shipping
  this change: 190/190 specs passing, 0 skipped, across
  `approval_flow_desktop_crud.cy.ts`,
  `approval_flow_same_entity_autocomplete_filter.cy.ts`,
  `approval_flow_self_referential_children.cy.ts`, `audit_log.cy.ts`,
  `auth.cy.ts`, `auth_redirect.cy.ts`, `dashboard.cy.ts`,
  `error_message_delivery.cy.ts`,
  `fk_read_permission_graceful_degradation.cy.ts`, `import_modal.cy.ts`,
  `legal_pages.cy.ts`, `organization.cy.ts`, `permission.cy.ts`,
  `role.cy.ts`, `search_page.cy.ts`, `user.cy.ts`, and every
  `mobile/*.cy.ts` counterpart, including "3.2 removes optional data and
  child items" — the exact spec the broader (pre-fix) fixture broke.
- The mandatory gate (`npm run test:e2e:cy:api`) is unchanged — 239/239
  passing, 0 skipped.
- Confirmed on GitHub Actions, not only locally: PR #431's `E2E Tests` job
  failed on the first CI run specifically on "3.2 removes optional data and
  child items" (`organization.cy.ts`) with the broader fixture; after the
  marker-scoping fix, a fresh CI run passed clean.
