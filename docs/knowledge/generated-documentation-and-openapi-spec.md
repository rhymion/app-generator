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

### List query parameters, `readOnly`, bulk requestBody, 4xx, import/export

(#762) `GET /api/{parent}` declares `page`/`pageSize`/`sort`/`f.<field>`
query parameters (`_list_query_parameters()`), built from the exact same
sort/filter allow-list and per-column kind map `getters.ts.jinja2`'s
generated `SORTABLE_FIELDS`/`FILTERABLE_FIELDS`/`FIELD_KINDS` render from
(`ctx['sort_filter_fields']`/`ctx['sort_filter_field_kinds']`/
`ctx['sort_filter_relation_fields']`, `build_context.py`) — never a
second, independently-derived guess. Each `f.<field>` parameter's schema
reuses the field's own cleaned record-schema type, so it can't drift from
what the field actually is; its description states whether the match is
a case-insensitive substring (`string` kind) or an exact match (every
other kind) — `buildFilter`'s (`lib/_pagination.ts`) actual default-clause
behavior today. It deliberately does not describe per-kind operator
selection (`is`/`not`/`isAnyOf`/`after`/...) — that is app-generator#756's
DataGridClient-only Server Action path, which `parsePageOpts()` (the REST
query-string path these parameters document) never receives even once
#756 merges (`FilterMap`'s bare-scalar REST shape is unchanged by that
change).

A system/server-managed field (the baseline `id`/`created_at`/
`updated_at`/`creator_id` set, plus anything in `ctx['readonly_fields']` —
`x-readonly`/`x-readonly-fields`/`x-server-value`) is marked `readOnly:
true` on the full-record schema (`_record_properties()`), JSON Schema
2020-12's own standard keyword for "present on read, never sent on
write" — so a consumer reading only the record schema (not
cross-referencing the separate create-request schema) still gets the
signal. Never leaked into a query-parameter schema (`readOnly` is a
response-body concept; stripped there it would be meaningless).

Bulk `PUT`/`DELETE` at `/api/{parent}/bulk` now declare a `requestBody`:
`PUT`'s items are the create-request shape plus a required `id`
(`{Parent}BulkUpdateItem`, mirroring `api_bulk_route.ts.jinja2`'s
`{ id, ...create-fields }` destructure); `DELETE`'s items are bare `{id}`
objects. Every operation's non-2xx/non-207 responses (`_std_responses()`)
are traced to a real template line, not assumed from the status code's
generic meaning: `400`/`401`/`403`/`429` (list `GET`, the pageSize check
is unconditional); `401`/`403`/`409`/`422`/`429` always plus a
conditional `400` (create/update — `409`/`422` come from
`service.ts.jinja2`'s unconditional `P2002`/`VALIDATION` catch in both
`add{Parent}` and `update{Parent}`, the `400` only when this entity has a
plain-readonly field to reject); `401`/`403`/`404`/`429` plus a
conditional `409` for count-mode reservation entities (delete). A bulk
operation's own top-level surface is narrower than its singular
counterpart — every per-item outcome (not-found/access-denied/write
failure) is caught row-by-row and reported inside the `207` body's
`results[]`, never re-thrown as a top-level error — so bulk only ever
declares `401`/`403`/`429` beyond its `207`. A 403 response's description
names which permission operation is being checked (`read`/`create`/
`update`/`delete`/`import`) — plain text, not a vendor extension; the
DB-driven role/permission grant itself (which roles actually hold that
permission) is runtime state this static generator cannot read, and was
left undocumented rather than expressed via a new, unreviewed `x-*` key.

### Relation and child-list request fields (write semantics)

`{Parent}CreateRequest` (the `POST` and `PUT` body) and
`{Parent}BulkUpdateItem` declare every relation/child-list input the REST
routes read (`ctx['api_write_children']`, built from the same `write_ch`
list `all_body_fields_create` destructures from the body):

- a connect-style relation (many-to-many, optional-FK list) is a flat id
  list named `<child>_ids` — e.g. `role.users_ids`, `user.roles_ids`,
  `procedure.precededBy_ids` (the prefix is the child variable name, so a
  camelCase relation keeps its camelCase prefix);
- an owned child list (DataGrid lines) is an array of row objects under
  the relation's own property name (e.g. `purchase_order.lines`); a row
  that carries an existing `id` is updated in place, a row without one is
  created, and an existing row missing from the list is deleted.

A supplied list is the complete new state and replaces the current one
(`[]` clears it). An **omitted** field on update (`PUT /api/{parent}/{id}`,
bulk `PUT`) leaves the relation unchanged: the route fills it with the
row's current value (`_child_current_value_fallback()` in
`build_context.py` — current ids for a connect-style relation, current
rows JSON round-tripped for an owned child list) before calling
`update{Parent}`, which is the same input the UI edit form sends when a
relation is left untouched. On create, an omitted field means an empty
list. CSV import cannot express child rows at all, so its update path
always passes the row's current value (create passes `[]`).

Every `api: true` entity also declares `GET /api/{parent}/options`, the relation picker route
(`relation-picker-rest-route.md`): `q`, `ids`, `limit`, and (not on `organization`) `caller` and
`context` query parameters; it returns an array of the entity's record schema and declares `400`, `401`,
`403` and `429`.

CSV export/import get their own paths, mirroring `generate.py`'s own
gating exactly: `GET /api/{parent}/export` when `can_list and
can_export`, `POST /api/{parent}/import` when `import_eligible`. Neither
route calls `getRateLimiter()` (confirmed absent from
`api_export_route.ts.jinja2`/`api_import_route.ts.jinja2`, unlike every
other route), so neither declares `429`; both use `resolveActorId`'s
dual-auth (API key OR session), so their `401` text differs from the
API-key-only routes above. Import's shared `ImportResult` schema mirrors
`api_import_route.ts.jinja2`'s own `ImportResult` TS type exactly
(`summary`/`errors`/`confirmToken`/`skippedColumns`); a structural
failure (oversized file, too many rows, a missing key column, an
expired/invalid `confirmToken`) is `400` with the same `ImportResult`
body shape, while a per-row failure is `200` with `errors[]` populated —
HTTP status alone never tells a caller whether any row failed.

**External validator re-run** (same method as the prior investigation's
own run, done here for the larger entity/path coverage this change adds
— 35 paths vs. 23, 27 schemas vs. 18): Spectral (`spectral:oas`) reports
**0 errors, 132 warnings** (`oas3-api-servers`×1, `info-contact`×1,
`operation-description`×65, `operation-operationId`×65 — the two
operation-level counts grew from 53 to 65, exactly the +12 new operations
this change adds; no new warning *class* appeared). Redocly reports
**1 error** (`no-empty-servers`, pre-existing, unrelated — the same
missing top-level `servers` array Spectral flags as a warning) and
**74 warnings** (`info-license`×1, `operation-operationId`×65,
`tag-description`×8). Redocly's `operation-4xx-response` warning — 26
occurrences before this change — is now **zero**: every operation this
generator emits now declares at least one 4xx response.

**Not covered by either linter's default ruleset**, and unaffected by
this change: per-operation role/permission detail (gap 6 above) and the
`x-relationship(s)` `$ref`-modeling question remain open, tracked as a
follow-up rather than decided here.

### Serving the document: `GET /api/openapi.json`, and the `/swagger` UI

(Issue #769) The document above is served by a fixed, non-templated route,
`app/api/openapi.json/route.ts`, in every environment including
production — reading `docs/generated/openapi.json` at request time via
`lib/openapi/document.ts` (a runtime-built `fs.readFileSync` path, listed in
`next.config.ts`'s `outputFileTracingIncludes` so Vercel's build-time output
tracer ships it with the serverless function; the same treatment
`content/legal/*.md` already gets, for the same reason: a computed path
can't be traced statically). It is never rebuilt or copied a second time —
the route reads the exact file the generator writes. Authentication is
`requireDualAuth` (API key or session, `lib/api-auth.ts`) — no further
permission check, since the document only reveals the schema shape, never
row data. `info.description` states this plainly and points at both this
route and the row-level capabilities endpoint below, instead of the old
"not served" wording, which stopped being true once this route shipped.

(Issue #768) `GET /swagger` (`app/[locale]/swagger/`) is a separate,
development/staging-only page: an interactive `swagger-ui-dist` explorer
(chosen over `swagger-ui-react` for its React-version independence —
`swagger-ui-react` spent 2025-02 through 2026-07 chasing React 19 support,
`swagger-api/swagger-ui#10243`; and over `redoc`, whose open-source build
lacks a "Try it out"/Authorize feature at all, and `@scalar/api-reference-react`,
whose React wrapper pulls in a ~45MB Vue 3 runtime) that reads its spec
from the same `/api/openapi.json` route above — same-origin, so the
session cookie already on the page covers the spec fetch, and each
"Try it out" call the Authorize dialog's API key covers. Gated on
`SWAGGER_UI_ENABLED === 'true'` (never `NODE_ENV`, which `next build`
always bakes to `production` regardless of the real deployment target):
unset makes the page 404, the same fail-closed treatment
`app/api/test-utils/reset-caches` gives `TEST_RESET_TOKEN`. Login is
required via `proxy.ts` (the page is not in its `PUBLIC_PATHS`), and the
page is not under the public `app/[locale]/docs` path. **This flag must
never be injected into Vercel's Production environment** — every "Try it
out" call runs with the caller's own role permissions, with no additional
scope restriction, so enabling it against a production database lets
Swagger UI write or delete real data. `vercel-setup.sh`/`vercel-env.sh`
deliberately do not reference this variable at all; enabling it on a
Preview deployment for a specific need is a manual, one-off
`vercel env add SWAGGER_UI_ENABLED true preview` — not automated by any
script here, and not something CI or a deploy pipeline should do on its
own.

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
