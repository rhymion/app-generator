# Generated documentation, the OpenAPI build artifact, and the row-level
# capabilities endpoint

## What this is

Every `generate-code` run writes, per entity, a human-readable doc page
(`docs/generated/{parent}.md`, mirrored to `app/[locale]/docs/{parent}/page.mdx`
via `generators_doc.py`'s `build_doc_entity_context()` +
`doc_entity.md.jinja2`), plus one combined machine-readable spec
(`docs/generated/openapi.json`, via `generators_openapi.py`). Both are pure
build artifacts, produced from the same underlying `build_context()` data —
neither is served by a deployed app by default. A third piece, generated per
entity rather than as a single build artifact, is a real runtime endpoint —
`GET /api/{entity}/[id]/capabilities` — that answers the row-level question
the other two deliberately leave out (see "The row-level capabilities
endpoint" below).

## The Constraints section (human docs)

`doc_entity.md.jinja2`'s `## Constraints` section (present only when the
entity declares `x-approval` and/or a write-locked field) documents two
entity-level, static facts — true for every row of the entity regardless of
its current data:

- **Approval Flow**: when the entity declares `x-approval`, a table of each
  stage (Submit/Approve/Reject/Withdraw) and which field(s)/value(s) it
  writes, plus whether a rejection is terminal (no resubmission path back to
  the submit state).
- **Write-Locked Fields**: which (field, value) pairs only the system may
  write, sourced from `write_locked_values` (the same union
  `derive_write_locked_values_for_view()` already computes for the
  generated form/service-layer lockdown — approval-decision values and/or
  an explicit `x-write-locked-values` declaration).

Row-level truth — is *this specific* row submittable/locked/transitionable
right now — is deliberately never documented here; that depends on the
row's own current data and belongs behind a runtime endpoint, not a static
doc that describes every row of an entity identically.

When an `x-state-machines`-governed field is ALSO the field `x-approval`'s
own `submit_on` governs, the existing `## State Machine` section's per-field
block additionally lists the AND-composition edge set
(`state_machine_approval_edges`) — the diagram's edges alone are not
sufficient; a transition must also be legal under the approval flow to
actually be permitted right now.

This repo's own `json_schema.yaml` declares no `x-approval`/
`x-write-locked-values` entity, so the Constraints section never renders in
this repo's own generated output — exercised instead by
`test:approval-lockdown-gate`'s fixture (`code_generator/tests/fixtures/
approval_lockdown_gate/json_schema.yaml`).

## The OpenAPI 3.1 build artifact

`docs/generated/openapi.json` is a single OpenAPI 3.1 document covering
every `api: true` entity's REST + bulk surface (list/create at `/api/
{parent}`, get/update/delete at `/api/{parent}/{id}`, bulk variants at
`/api/{parent}/bulk`). It is generated as a plain Python dict
(`generators_openapi.py`'s `build_entity_openapi()` per entity,
`assemble_openapi_document()` to merge) and written via `json.dump` — no
new templating dialect, since OpenAPI 3.1's schema object already IS JSON
Schema 2020-12 and `json_schema.yaml`'s own field definitions are already
JSON-Schema-draft-07-shaped.

Scope, matching what is schema-level (true for every row) vs. row-level
(depends on a specific row's current data):

- **In scope** (schema-level): field type/required/enum (from the
  compiled entity's own `properties`, with generator-only `x-*` keys
  stripped — `_clean_field_schema()`'s allowlist), relationship shape (FK
  target + cardinality, as a vendor extension `x-relationships` rather than
  a dereferenced `$ref` graph), approval flow shape (`x-approval` vendor
  extension, the same data the human doc's Approval Flow table renders
  from), and write-lock capability (`x-write-locked-values` vendor
  extension, the same `write_locked_values` the human doc's Write-Locked
  Fields table renders from).
- **Out of scope** (row-level, needs the record's current data): whether a
  specific row is currently submittable/locked/on a live transition edge,
  and org-scoped visibility. These are a runtime capabilities endpoint's
  job, not a static spec's.
- **Not decided in this pass**: the RFC 9457 error-shape migration (every
  route still returns `{"error": "<message>"}`, unchanged).

**Never served by a deployed app by default** — a customer wanting to
expose it wires up their own route; this generator does not add one, and
no new schema key controls this (matching the same treatment
`app/[locale]/docs` already gets — not every deployment wants its full
schema disclosed).

## The row-level capabilities endpoint

`GET /api/{entity}/[id]/capabilities` (name is provisional per the design
doc; kept as-is here -- no better alternative surfaced, and it matches
the existing `[id]/approve`, `[id]/reject`, `[id]/withdraw` sub-resource
convention on `approval_request`) answers, for one specific row, exactly
the row-level half the OpenAPI spec and human docs above deliberately
leave out: which operations/writes/transitions are legal right now,
given this row's own current data and this caller's own permissions.
Written by `generate.py` alongside `api_detail_route.ts.jinja2` (gated on
`can_view` alone -- it answers a read-time question, reusing
`get{Parent}Detail`, the same org-scoped/self-only-scoped getter the GET
detail route itself calls), from `api_capabilities_route.ts.jinja2`.

Every judgment in the response reuses an already-generated function --
never a second, divergent derivation (the design doc's anti-pattern
against a parallel agent API recreating a second, divergent code path):

- `operations.update`/`operations.delete` -- `canAccess()`
  (`lib/authz.ts`), the same non-throwing permission check every read
  path already uses; an `x-self-only` entity checks
  `creator_id === actorId` instead, matching the write path's own "no
  admin bypass on write" rule exactly (the same ownership check
  `api_detail_route.ts.jinja2`'s PUT/DELETE handlers use).
- `write_locks.edit_locked`/`write_locks.delete_locked` --
  `assertEditAllowed()`/`assertDeleteAllowed()`
  (`lib/{entity}/edit_guard.ts`/`delete_guard.ts`, the post-approval
  lockdown mechanism), wrapped in try/catch rather than a
  boolean-returning sibling function. `null` (not `false`) when the
  entity has no such guard at all -- the approvable-bridge relationship
  discussed below is what wires these in.
- `transitions.{field}` -- `assertTransitionAllowed()`
  (`lib/state_transitions.ts`), called once per candidate state drawn
  from that field's own diagram state list
  (`state_machine_diagrams[field].states`, already resolved by
  `build_context()`) rather than re-deriving the edge set.
- `approval` -- only non-null when the entity declares the "approvable"
  one-to-one bridge relationship (`x-relationship: {type:
  one-to-one_bridge, target: approvable}`) -- see `capabilities_context()`
  in `generators.py` for why plain `x-approval` alone (no bridge) is
  insufficient: without the bridge, `generate.py` never wires a submit/
  approve/reject/withdraw action for the entity at all (its on_approved/
  on_rejected values are simply unreachable via the ordinary write path),
  so there is no live round machinery to report on. When present,
  `can_submit`/`can_withdraw` reuse `canSubmitForApproval()`/
  `canWithdrawApproval()` (`lib/approval_request/submit_predicate.ts`),
  `can_approve`/`can_reject` reuse the same `assertApprovalOrder()` plus
  approver-role check every real approve/reject route already performs,
  and `can_withdraw` is further gated on `hasOnWithdrawn()`
  (`lib/approval_request/on_withdrawn_dispatch.ts`) plus the same
  requestor-only (`approvable.creator_id === actorId`) check the real
  withdraw route enforces -- all reused, none re-implemented.

Known coverage gap, disclosed rather than papered over: this repo's own
`json_schema.yaml` declares no entity with the approvable bridge
relationship at all, and no fixture gate (`test:approval-lockdown-gate`
included) exercises one either -- the entire approvable-bridge machinery
this endpoint's `approval` section depends on (`edit_guard.ts`/
`delete_guard.ts`/`submit_predicate.ts`/`order-check.ts`/
`on_withdrawn_dispatch.ts`) has never been compiled through the real
`generate.py` -> `tsc` pipeline by any of the 20 completion-gate steps,
before or after this change. `code_generator/tests/
test_capabilities_endpoint.py` covers this branch at the Python
context-computation and template-rendering level (a real render against
a synthetic approvable-bridge schema, asserting the expected imports and
calls appear), but that proves the generated source has the right shape,
not that it type-checks. The non-bridge branch (operations, write_locks,
transitions, `approval: null`) is genuinely `tsc`-compiled today, both
via `test:approval-lockdown-gate`'s existing entities (plain
`x-approval`, no bridge) and via `test:e2e:build`'s real dogfood build
(every `can_view`+`api: true` dogfood entity, none of which have the
bridge either). Building a dedicated fixture for the bridge branch (new
fixture models plus shims for the three approval_request-side modules
above) is its own undertaking, out of this change's scope -- worth a
dedicated follow-up.

See `app-generator-project-docs/planning/ai-agent-integration-design.md`
for the full design rationale (why a static/runtime split, why OpenAPI 3.1
specifically, anti-patterns considered).
