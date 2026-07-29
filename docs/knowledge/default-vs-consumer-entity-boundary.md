# Default vs. Consumer-Specific Entity Boundary

## The judgment axis: shipped artifact, not test-vs-non-test

When auditing whether a reference to a non-default entity name (e.g. `purchase_order`,
`leave_request`, `location`) is acceptable inside this repo, the correct question is **not**
"is this in a test file?" — it is **"does this reach a path that ships to every consumer?"**

- Python unit tests (`code_generator/tests/*.py`, `generators_test.py`) build their own schema
  fixtures in-process. Using `purchase_order` as a sample domain there is fine — nothing about
  it is baked into the generator's shipped output.
- A **shipped generator artifact** — `code_generator/helpers/*.py` runtime logic (not
  docstrings), `code_generator/templates/*.jinja2` (rendered into every consumer's generated
  code), `cypress.config.ts` (the base template's shared Cypress config), `.claude/commands/*.md`
  and `.codex/prompts/*.md` (shipped agent command definitions) — must not hardcode a
  consumer-specific entity name into a code path that actually executes or renders for anyone
  who doesn't have that entity in their own schema.

A docstring/comment that uses a real domain name as an illustrative example (e.g. "e.g.
`purchase_order.items -> purchase_per_item`" explaining a fully schema-config-driven mechanism)
is acceptable — the underlying code takes no dependency on the literal string. It only becomes a
violation once the literal entity name appears in code/template output that actually runs,
or once a shipped doc asserts it as a "current fact" about the base template's own schema.

## The default entity set

The generator's own baseline schema (`code_generator/json_schema.yaml` +
`code_generator/json_schema_internal.yaml`) defines exactly 15 entities: `approvable`,
`approval_flow`, `approval_request`, `attachable`, `attachment`, `comment`, `commentable`,
`dashboard`, `dashboard_widget`, `notification`, `organization`, `permission`, `reaction`,
`role`, `setting`, `user`.

A few additional models are shipped and legitimate even though they aren't `json_schema.yaml`
`definitions` entries — they are fixed, domain-agnostic system tables built the same way for
every consumer, not one consumer's business domain: `audit_log`, `mfa_recovery_code`, NextAuth's
`account`/`session`. Referencing these by literal name in shipped code is not a violation.

Anything else (`purchase_order`, `receiving_receipt`, `leave_request`, `inventory`, `location`,
etc.) is a consumer's own domain entity, defined in that consumer's `prj/code_generator/
json_schema.yaml`. See also [[authorization-default-deny]] `## Adding Tests for a New Entity` for
the `scripts/seed-tenant.ts` instance of this same rule.

## Established extension point for consumer-specific test infrastructure

`cypress.config.ts` already has the correct mechanism: it dynamic-`require`s
`./cypress/support/project-tasks.ts` in a `try/catch` (absent in the base template, present after
`prj:sync` copies it in) and spreads the result (`...projectTasks`) into `on('task', {...})`.
Consumer-specific Cypress task registrations belong in the consuming project's own
`prj/cypress/support/project-tasks.ts` (that file's own header comment says as much), never
hardcoded into the shared `cypress.config.ts`.

## cmd_488 findings (2026-07-29)

- `code_generator/helpers/schema_helpers.py` (`get_approval_lines_props`,
  `get_splittable_bridge_field`): `purchase_order`/`receiving_receipt` appear only in docstring
  examples explaining fully schema-config-driven logic (`x-approval-lines`, `x-reservation`,
  `x-splittable`). No violation — left as-is.
- `code_generator/templates/test_reservation_spec.cy.ts.jinja2`: a comment referenced
  `purchase_order_move_reservation.cy.ts` by name — a hand-written spec that lives only in one
  consumer's `prj/` tree, not in app-generator. Fixed: comment now points only at the generator's
  own `code_generator/tests/test_reservation.py::TestO4QuantityInvariantArithmetic`.
- `.claude/commands/review-tenancy.md` / `.codex/prompts/review-tenancy.md`: the "Current
  implementation" section enumerated a literal, unrelated entity list ("bug, character, checkup,
  clinic, creator, dashboard, epic, feature, funding, leave_request, etc.") that does not match
  this repo's own `lib/` contents (the base template only ever has the 15 default entities) —
  stale, inaccurate, and consumer-domain-leaking. Fixed: generalized to a schema-driven
  description with no enumerated entity names.
- `cypress.config.ts`: 9 hardcoded task registrations (`db:seedReservationInventory` etc.)
  imported `./cypress/support/purchase_order/reservation_helper` unconditionally — same class of
  violation as the `scripts/seed-tenant.ts` `leave_request` block removed in cmd_478, and already
  flagged on the dashboard as a follow-up from that cmd. Consolidated into this cmd (see report)
  and removed from `cypress.config.ts`. **Companion action required** in `app-template`
  (out of scope here — this repo's `app-template` scan was read-only): add the 9 equivalent
  task registrations to `prj/cypress/support/project-tasks.ts` before app-template's
  `app-generator` submodule pointer is bumped to include this commit, or the
  `purchase_order`-domain reservation e2e specs will break at that point (decoupled by the
  submodule pin, not immediately). See the report for the exact registrations to add.
- **Known gap, not fixed here (needs generator design work, filed as follow-up)**:
  `code_generator/templates/ledger_write_stub.ts.jinja2` and `split_action_route.ts.jinja2` both
  contain a literal `tx.location.findFirst(...)` Prisma call in their `afterReject`/split-reject
  paths. `location` is not part of the `x-ledger-entities` domain config (`pool`/`ledger`/
  `transactionable` only) — it is hardcoded, not schema-driven, contradicting
  `docs/knowledge/appendix/inventory-domain-generalization-design.md`'s own stated design intent
  ("target: whatever the customer names their location entity"). Any consumer generating this
  stub for an `x-ledger-source` entity with `reject_event_type` set, without a literal `location`
  Prisma model, would get a template that fails to type-check. Proper fix requires adding a
  `location`-equivalent key to the `x-ledger-entities` domain resolution
  (`schema_helpers.py::resolve_ledger_domain`) and threading it through `generate.py`/
  `build_context.py` into both templates — schema-config design work beyond this triage cmd's
  scope, recommended as a dedicated follow-up cmd.
