# Generated documentation and the OpenAPI build artifact

## What this is

Every `generate-code` run writes, per entity, a human-readable doc page
(`docs/generated/{parent}.md`, mirrored to `app/[locale]/docs/{parent}/page.mdx`
via `generators_doc.py`'s `build_doc_entity_context()` +
`doc_entity.md.jinja2`), plus one combined machine-readable spec
(`docs/generated/openapi.json`, via `generators_openapi.py`). Both are pure
build artifacts, produced from the same underlying `build_context()` data —
neither is served by a deployed app by default.

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

See `app-generator-project-docs/planning/ai-agent-integration-design.md`
for the full design rationale (why a static/runtime split, why OpenAPI 3.1
specifically, anti-patterns considered).
