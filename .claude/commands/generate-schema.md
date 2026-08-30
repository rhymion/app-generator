---
description: Generate or update a Prisma schema and JSON schema — build gate + e2e API gate + eslint.
argument-hint: <model or schema change description>
---

This is a **generate-schema** task. Read CLAUDE.md before starting.

## Key rules (read first)

- The resulting schema does not have to match any ER diagram or
  external design document verbatim. Shaping the schema around
  what the generator actually supports (relationship types,
  `x-*` extension keys, generated code paths) is a legitimate
  design choice, not a deviation that needs excusing.
- Before treating a generator limitation as a reason to reshape
  the schema, check whether an existing `x-*` key (see
  `docs/knowledge/schema-yaml-configuration.md`) already covers
  the case. Built-in keys are the default, proactive choice even
  when the task description doesn't name them — this applies
  with extra force in fast-track mode, where no confirmation
  step catches a missed key.

Traps that actually cost time in a real fast-track run (measured from
a full ER-diagram-only session, not guessed):

- FK to an embedded entity (one with `x-generate` disabled) breaks the
  build if required — promote the target to a standalone entity first.
- Reset the test DB (`docker compose down -v` before the next
  `test:e2e:build`) after every schema change — a stale DB produces
  confusing, unrelated-looking failures.
- Run long commands (`test:e2e:build` etc.) in the background with a
  wait-loop — foreground execution hits typical CLI time limits.

Minimum docs to read before starting:
- `docs/knowledge/prisma-schema-conventions.md`
- `docs/knowledge/schema-yaml-configuration.md`
- `docs/knowledge/code-generation-custom-extensions.md`
- `docs/knowledge/troubleshooting.md`

Task: $ARGUMENTS

## Task-specific rules

- Create Prisma schema first, then create JSON schema.
- If the user requests a model similar to a built-in model (comment, attachment, etc.),
  first confirm whether the built-in model can be used instead.

## Examples of `x-*` key usage (from proj_c)

Short, annotated excerpts from a real 51-entity consumer schema
(`app-template`), not full copies. Use these as a shape to imitate,
not a schema to paste in.

Hide an internal/bridge entity from the generated UI and API entirely:

```yaml
approvable:
  x-generate:
    list: false
    view: false
    new: false
    edit: false
    delete: false
    invalidate: false
    api: false
    test: false
```
<!-- why: this entity exists only to be referenced by other entities'
     approval wiring — it has no screens or CRUD of its own. -->

Resolve an FK autocomplete/column label from a related field (or a
composite of fields) instead of the target's raw id:

```yaml
fields:
  approval_flow_id:
    x-relationship:
      labelField: [entity_name, approver_role.name]
```
<!-- why: a bare id is meaningless to a user; labelField lets the
     dropdown/column show a human-readable, possibly composite name. -->

Mark which field(s) uniquely identify a row for CSV import matching:

```yaml
role:
  x-import-key: [name]
```
<!-- why: without x-import-key an entity is export-only — import is
     blocked (see the key's own description block for the phase split). -->

Lock system-managed fields so generated forms can't edit them:

```yaml
inventory:
  x-readonly-fields:
    - quantity
    - reserved_quantity
```
<!-- why: these fields are maintained by transaction/reservation logic,
     not by direct user edits — the form should show, not accept, them. -->

Or lock a single field directly on the property, without an entity-level list:

```yaml
inventory:
  fields:
    reserved_quantity:
      x-readonly: true
```
<!-- why: same rendering effect as x-readonly-fields for one field, but
     scoped differently — see "x-readonly vs x-readonly-fields" below for
     which to reach for. -->

### `x-readonly` vs `x-readonly-fields`: which one to use

Both make a field non-editable in the generated form (shown, not accepted,
on edit). They differ in **scope**, not effect:

| | `x-readonly` | `x-readonly-fields` |
|---|---|---|
| Where declared | on the property itself, under `fields:` | entity-level list, alongside `x-generate` |
| Scope | the Prisma model — every view built on it | the one view entity it's declared on |
| Use when | the field must never be editable through *any* view of this model (e.g. a computed/system column) | only *this* view should lock the field down; other views of the same model may still let it be edited |

Properties (`fields:`/`required:`) always live on the model, not the view
— that's why `x-readonly` is inherently model-wide: there's no separate
per-view copy of the property to attach it to differently. `x-readonly-fields`
is the opposite: it's entity-level metadata, and it stays on whichever view
entity declares it. A proxy/secondary view of a model (e.g. a settings page
that is really just another view of `user`) can declare `x-readonly-fields`
without affecting the model's other views — declaring the same field name
with `x-readonly` instead would lock it down everywhere. See
`docs/knowledge/readonly-field-form-rendering.md` for the implementation
detail (`build_context.py` reads `x-readonly-fields` from the view entity's
own definition, not the shared raw entity).

Restrict a view to only the rows matching a fixed set of field values:

```yaml
active_setting:
  allOf: [{ $ref: '#/definitions/setting' }]
  x-generate: { ... }
  x-filter-values:
    status: [active, pending]
    is_archived: [false]
```
<!-- why: shows only rows where status is one of [active, pending] AND
     is_archived is false — a proxy view that should only ever handle a
     subset of the underlying model's rows (e.g. an "active orders" view of
     a shared `order` model). -->

### `x-filter-values`: view-scoped row restriction

Map of `field: [allowed values, ...]`. Multiple fields combine with **AND**;
multiple values for one field combine with **IN**. There is no NOT/OR form
— add one only once a real use case needs it, not speculatively.

Like `x-readonly-fields`, this is entity-level metadata that stays on the
view entity that declares it — it never leaks onto other views sharing the
same underlying model.

Enforcement is server-side and unconditional, covering both read and write:

- **Read** — list, detail GET, export, FK autocomplete/sort-filter, and
  cross-entity full-text search all exclude rows outside the filter. A
  filtered-out row's detail GET returns 404, exactly as if it didn't exist.
- **Write** — PUT/DELETE (single-item REST, bulk REST, and the Server
  Action delete path) also 404 for a row already outside the filtered view,
  the same fail-closed behavior `x-self-only` uses. The check is judged
  against the row's state **before** the write (the pre-image): a PUT that
  legitimately moves a row from inside the filter to outside it (e.g.
  `status: pending -> approved` on a view filtered to `status: [pending]`)
  still succeeds — only a row that is *already* outside the filter is
  rejected. See `docs/knowledge/filter-values-row-scope.md` for the
  implementation detail and the full list of enforcement points.

No permission setting (`general`/`Creator`/`Assignee` roles, org isolation)
can widen past `x-filter-values` — it composes with every other row-scope
condition via AND, never OR, the same guarantee `x-self-only` gives.

## Common rules

1. `npm run lint` must pass.
2. If a gate step fails: investigate root cause → fix → re-run until it passes.
3. Always maintain compatibility between Prisma schema and JSON schema.
4. Follow model and field naming conventions (e.g., no models ending with `_detail`).
   See `docs/knowledge/prisma-schema-conventions.md`.
5. Follow the docs (`docs/knowledge/` is the source of truth).
6. If you discover a new rule or useful skill, update the rule/skill documentation.
7. Read the docs before acting: at minimum CLAUDE.md, and relevant `docs/knowledge/` files.

## Completion gate

Run in this order:

1. `npm run lint`            — **must run before any of the generate-code steps below** (see note)
2. `npm run test:pytest`      — Python unit tests for code generator
3. `npm run test:vitest`     — vitest unit/component tests
4. `npm run test:e2e:build`  — docker:up:test + generate-code + db:push + db:generate + db:seed-baseline + build
5. `npm run check:generated` — generated code matches templates/schema
6. `npm run test:e2e:cy:api` — API Cypress specs only
7. `npm audit --omit=dev --audit-level=high`

**Step 1 (`npm run lint`) must run on a checkout where `generate-code` has
not yet run** — that is what CI's `Lint` job actually checks (`npm ci && npm
run lint`, no `generate-code` step, see `.github/workflows/ci.yml`). On a
worktree where `generate-code` already ran in an earlier session, run `npm
run cleanup` immediately before this step to remove the generated output
first (do **not** use `git clean` — forbidden by CLAUDE.md D004). Linting
after generate-code checks a much larger, differently-calibrated file set
than CI ever sees and has caused false gate failures unrelated to the
current change — see cmd_600 /
`docs/knowledge/lint-gate-must-match-ci-precondition.md`.

Steps 2 and 3 run unconditionally, with no "unchanged" exemption: CI's
`unit-tests` and `pytest` jobs run on every push/PR to `main`/`master` with
no path filter, so a local gate that conditionally skips either can go green
while CI goes red on the same commit (see
`docs/knowledge/gate-exemption-must-be-machine-checkable.md` — cmd_498).

## Debug priority

| Failure | Investigate in this order |
|---------|--------------------------|
| Code generation fails | 1. schema (check undocumented implicit rules) → 2. generator bug |
| Build fails | 1. config → 2. schema → 3. code bug (both VCS-managed and generated) |
| Test fails | 1. generated test code bug |
| Other test fails | 1. generation logic missing a case → 2. product code bug |

> **Note**: When running typecheck (`npx tsc --noEmit`) in isolation, prefix
> with `npm run generate-code` first. See `AGENTS.md §Generated-code
> prerequisites for gates` for the full rule. `npm run lint` is the
> exception — never prefix it with `generate-code` (see Completion gate
> step 1 above).
