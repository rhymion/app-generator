---
description: Update the Python code generator or templates — pytest + full build + e2e API gate + eslint.
argument-hint: <generator change description>
---

This is an **update-generator** task. Read CLAUDE.md before starting.

Minimum docs to read before starting:
- `docs/knowledge/prisma-schema-conventions.md`
- `docs/knowledge/schema-yaml-configuration.md`
- `docs/knowledge/code-generation-custom-extensions.md`
- `docs/knowledge/testing-cypress.md`
- `docs/knowledge/troubleshooting.md`

Task: $ARGUMENTS

## Common rules

1. `npm run lint` must pass.
2. If a gate step fails: investigate root cause → fix → re-run until it passes.
3. Always maintain compatibility between Prisma schema and JSON schema.
4. Follow model and field naming conventions.
   See `docs/knowledge/prisma-schema-conventions.md`.
5. Follow the docs (`docs/knowledge/` is the source of truth).
6. If you discover a new rule or useful skill, update the rule/skill documentation.
7. Read the docs before acting: at minimum CLAUDE.md, and relevant `docs/knowledge/` files.

## Completion gate

Run in this order:

1. `npm run lint`             — **must run before any of the generate-code steps below** (see note)
2. `npm run test:pytest`       — Python unit tests for code generator
3. `npm run test:vitest`      — vitest unit/component tests
4. `npm run test:mention-gate` — fixture-schema generate-code → tsc check (see below)
5. `npm run test:decimal-gate` — fixture-schema generate-code → tsc check (see below)
6. `npm run test:oto-mandatory-gate` — required one-to-one selector fixture generate-code → tsc check (see below)
7. `npm run test:oto-decimal-gate` — one-to-one selector target with a Decimal column fixture generate-code → tsc check (see below)
8. `npm run test:chart-decimal-gate` — x-display.chart with a required Decimal column fixture generate-code → tsc check (see below)
9. `npm run test:chart-scalar-gate` — x-display.chart with a required plain Int column and two required non-start/end DateTime columns (`format: date-time` and `format: date`) fixture generate-code → tsc check (see below)
10. `npm run test:approval-lockdown-gate` — x-approval value-lockdown fixture generate-code → tsc check (see below)
11. `npm run test:payment-gate` — x-payment fixture generate-code → tsc check (see below)
12. `npm run test:e2e:build`   — docker:up:test + generate-code + db:push + db:generate + db:seed-baseline + build
13. `npm run check:generated`  — generated code matches templates/schema
14. `npm run test:e2e:cy:api`  — API Cypress specs only
15. `npm run test:e2e:cy:ui`   — non-API Cypress specs (desktop + mobile)
16. `npm audit --omit=dev --audit-level=high`
17. `pip-audit -r requirements.txt`

**Step 1 (`npm run lint`) must run on a checkout where `generate-code` has
not yet run** — that is what CI's `Lint` job actually checks (`npm ci && npm
run lint`, no `generate-code` step, see `.github/workflows/ci.yml`). On a
fresh worktree this is naturally true if lint runs first. On a worktree
where `generate-code` already ran in an earlier session, run `npm run
cleanup` immediately before this step to remove the generated output first
(do **not** use `git clean` — forbidden by CLAUDE.md D004).

Running lint *after* generate-code silently lints ~700 additional generated
files (Cypress specs, helpers, etc.) that CI's Lint job never sees, and
against a totally different (much larger) warning count than the
`--max-warnings 20` ceiling was calibrated against — this is not a
theoretical risk: it is exactly what happened in cmd_554 (2026-08-04), whose
gate run reported "15 warnings ≤ N=20, PASS" while `develop`'s actual
post-generate-code warning count was already 93 at that same commit
(verified independently, 2026-08-07, cmd_600) — the "15" cmd_554 measured is
byte-for-byte the pre-generate-code count (7 `no-unused-expressions` + 5
`no-img-element` + 3 `no-unused-vars`), not the post-generate-code state
their own build step had just produced. There was never a 15→93
*regression* between commits — the ratchet was calibrated against the wrong
axis from the day it was introduced, and every subsequent local gate run
that lints post-generate-code inevitably reports a "regression" against a
number CI can never reproduce. Running lint first (matching CI's exact
condition) makes local and CI agree on the same count by construction; see
`docs/knowledge/lint-gate-must-match-ci-precondition.md`.

Steps 2, 3, 4, 5, 6, 7, 8, 9, 10, and 11 run unconditionally, with no "unchanged" exemption: CI's
`unit-tests` (`npm run test:vitest`), `pytest` (Python Generator Tests),
`mention-gate-fixture`, `decimal-gate-fixture`, `oto-mandatory-gate-fixture`,
`oto-decimal-gate-fixture`, `chart-decimal-gate-fixture`,
`chart-scalar-gate-fixture`, `approval-lockdown-gate-fixture`, and
`payment-gate-fixture`
jobs run on every push/PR to `main`/`master` with no path filter, so a local
gate that conditionally skips any of them can go green while CI goes red on
the same commit. This exact gap caused PR #218's Unit Tests job to fail after
cmd_493 (see `docs/knowledge/gate-exemption-must-be-machine-checkable.md` —
cmd_498, the third recurrence of "gate ≠ CI").

**Step 4 (`test:mention-gate`, cmd_535)**: runs a small, standalone fixture
entity (commentable + comment + `x-mention: true`) through the real
`build_user_schema.py` → `generate.py` → `tsc --noEmit` pipeline and
type-checks just the two generated files that carry the
`named_constants and has_commentable` branch — the branch cmd_532 found
broken (`c.creator_id` read off a comment type that only ever declares
`c.creator?.id`), and that this repo's own `test:e2e:build` (step 12) can
never catch because no entity in this repo's own `json_schema.yaml` wires a
`commentable` relation. ~4s. See `docs/knowledge/mention-system.md`
"cmd_532: creator include fix and gate-blind-spot confirmation" and
"Fixture gate: how to grow it" for what this covers, what it deliberately
does not (only this one branch — this repo's templates have on the order of
700 `{% if %}` branches total, most still uncovered by any fixture), and how
to extend it to a new dark branch.

**Step 5 (`test:decimal-gate`, cmd_705)**: same shape as step 4, for a
different dark branch — a fixture entity with a required and a nullable
`Decimal` column (each with an explicit `@db.Decimal(p, s)` scale),
type-checking `getters.ts` (the `.toString()` serialization a Decimal
column needs to cross the Server-to-Client Component boundary without
throwing), `FormUpsert.tsx` (the `AppFieldText`-based decimal input
rendering), `form_validation.ts`/`service_validation.ts` (the
`DECIMAL_FIELDS` numeric-format check), and the CSV import route (the
`'decimal'` `ts_type` coercion). This repo's own `json_schema.yaml` has zero
Decimal-typed fields, so none of these branches are ever compiled by step 12
otherwise. ~6s. See `scripts/check_decimal_gate_fixture.sh`.

**Step 6 (`test:oto-mandatory-gate`, cmd_704 [2-a])**: runs a
third, unrelated small fixture entity pair (`oto_gate_target`, a
`type: one-to-one` selector target with its own list/view/new/edit pages,
and `oto_gate_item`, whose FK to it is REQUIRED — non-nullable) through the
same `build_user_schema.py` → `generate.py` → `tsc --noEmit` pipeline and
type-checks the generated `page_new.tsx` + `getters.ts` — the branch cmd_704
found broken (`build_context.py`'s `required_relation_fields` rebuilt a
single `initial{Target}s` name in `page_new.tsx.jinja2` for both
`parent_rels_raw` and `selector_oto_rels` entries, but the latter actually
destructures as `initialAvailable{Target}s`), and that this repo's own
`test:e2e:build` (step 12) can never catch because no entity in this repo's
own `json_schema.yaml` — nor any currently known consumer schema — has a
required one-to-one selector FK. ~5s. A separate fixture from
`test:mention-gate` rather than an extension of it: unrelated branch, kept
legible per fixture. See
`code_generator/tests/fixtures/oto_mandatory/json_schema.yaml`'s header for
the extend-vs-new-fixture rationale and
`scripts/check_oto_mandatory_gate_fixture.sh` for the check itself.

**Step 7 (`test:oto-decimal-gate`, cmd_754[2])**: runs a fourth, unrelated
small fixture entity pair (`oto_decimal_gate_target`, a one-to-one selector
target carrying a Decimal column, and `oto_decimal_gate_item`, whose FK to
it is a nullable `type: one-to-one` selector) through the same
`build_user_schema.py` → `generate.py` → `tsc --noEmit` pipeline and
type-checks the generated `page_new.tsx` + `page_edit.tsx` + `getters.ts`
— the branch cmd_754 found broken:
`getAvailable{Target}sFor{Parent}` (getters.ts.jinja2), the one-to-one
selector's "available options" getter, returned the target's raw Prisma
rows unconditionally, unlike `search{Parent}Options`
(`decimal_display_columns` `.toString()` override) and
`relationship_mapping` (`deepStringifyDecimals` wrap for an embedded
relation) — neither of which this getter is. A Decimal column on the
selector's target hit `TS2322` at the `page_new.tsx`/`page_edit.tsx` call
site, where the raw rows are handed straight to a Client Component prop
typed against the generated (Decimal-as-string) interface. Distinct from
step 6 (`test:oto-mandatory-gate`, the required-selector init-var naming
branch — unrelated) and step 5 (`test:decimal-gate`, an entity's own
columns / an *embedded* relation's Decimal columns — not the OTO
selector's separate `getAvailable...` getter). This repo's own
`json_schema.yaml` has no one-to-one selector FK at all, so none of this is
ever compiled by step 12 otherwise. ~7s. See
`code_generator/tests/fixtures/oto_decimal_gate/json_schema.yaml`'s header
for the new-fixture-vs-extend rationale and
`scripts/check_oto_decimal_gate_fixture.sh` for the check itself.

**Step 8 (`test:chart-decimal-gate`, cmd_755[1])**: runs a fifth, unrelated
small fixture entity pair (`chart_decimal_gate_row`, the chart's `row_by`
target, and `chart_decimal_gate_item`, which declares `x-display.chart`
and carries a REQUIRED Decimal column) through the same
`build_user_schema.py` → `generate.py` → `tsc --noEmit` pipeline and
type-checks the generated `chart-getters.ts` + `chart/page.tsx` — the
branch cmd_755 found broken: `get{Parent}sForChart`
(chart_getters.ts.jinja2), generated only when `x-display.chart` is
declared, assigned a required Decimal column straight off the raw Prisma
row (`{{ field }}: item.{{ field }},`) into a field the generated
`{Parent}ForChart` interface types as `string` (`chart_context()` in
`generators.py` resolves a Decimal column's JSON-schema type as `string`
per cmd_705's `_prisma_decimal_type` marker, but the raw row value is a
`Prisma.Decimal` instance) — a `TS2322` at build time. Distinct from step 5
(`test:decimal-gate`, an entity's own columns via `getters.ts`'s
`decimal_display_columns` — not this chart-specific getter) and step 7
(`test:oto-decimal-gate`, a one-to-one selector's separate
`getAvailable...` getter — unrelated code path). This repo's own
`json_schema.yaml` has no entity combining `x-display.chart` with a
required Decimal column, so none of this is ever compiled by step 12
otherwise. ~5s. See
`code_generator/tests/fixtures/chart_decimal_gate/json_schema.yaml`'s
header for the new-fixture-vs-extend rationale and
`scripts/check_chart_decimal_gate_fixture.sh` for the check itself.

**Step 9 (`test:chart-scalar-gate`)**: runs a sixth, unrelated small
fixture entity pair (`chart_scalar_gate_row`, the chart's `row_by` target,
and `chart_scalar_gate_item`, which declares `x-display.chart` and carries
a REQUIRED plain Int column, two REQUIRED DateTime columns other than
`start_time`/`end_time` (one `format: date-time`, one `format: date`), and
a REQUIRED Boolean column) through the same `build_user_schema.py` →
`generate.py` → `tsc --noEmit` pipeline, type-checks the generated
`chart-getters.ts` + `chart/page.tsx`, and greps the generated interface to
prove the excluded columns are actually absent (a green `tsc` run alone
does not prove a column was dropped from the projection). Covers two
branches `chart_context()` (`generators.py`) has gotten wrong across two
rounds: a required plain Int/Float column was dropped from the chart
projection entirely (no interface field, no tooltip candidate, no
documented reason — an asymmetry with a required string column, which was
projected; fixed first), and a required DateTime column was assigned
straight off the raw Prisma row into a field the generated
`{Parent}ForChart` interface types as `string` — the same "raw Prisma
value into a field typed `string`" `TS2322` class step 8 fixed for
Decimal, just for a different type (fixed second, and that fix itself only
checked `format == 'date-time'`, so a required `format: date` column fell
through to the plain-string branch and kept the exact same bug — the
`format: date` column in this fixture exists specifically to close that
gap). Every DateTime column, whatever its format, is now excluded from the
chart projection entirely (client-side formatting is needed for correct
local-time display, out of the generator's scope here; start_field/
end_field already carry the chart's time information). The fixture's
required Boolean column also proves that type is deliberately excluded
from the projection (no interface field), not a silent drop. Distinct from
step 8 (`test:chart-decimal-gate`, the chart's required-Decimal-column
branch — unrelated code path, and not extended by this fixture to keep
this fixture's build/type-check independent of that one's own scope and
history). This repo's own `json_schema.yaml` has no entity combining
`x-display.chart` with a required Int/Float or extra required DateTime
column, so none of this is ever compiled by step 12 otherwise. ~5s. See
`code_generator/tests/fixtures/chart_scalar_gate/json_schema.yaml`'s
header for the new-fixture-vs-extend rationale and
`scripts/check_chart_scalar_gate_fixture.sh` for the check itself.

**Step 10 (`test:approval-lockdown-gate`, cmd_732)**: a seventh, unrelated
small fixture entity (`approval_lockdown_gate_item`, a nativeEnum `status`
field with `x-approval.on_approved`/`on_rejected.set_fields` declared on
it) run through the same `build_user_schema.py` → `generate.py` → `tsc
--noEmit` pipeline and type-checks `FormUpsert.tsx` (the disabled-but-
present option rendering for a value only the approval/rejection workflow
may write), `service_validation.ts` (the `APPROVAL_LOCKED_FIELDS`
create/update check shared by the REST API route and the Server Action
write path), and the CSV import route (`api_import_route.ts.jinja2`'s
duplicate of the same check — CSV import bypasses the service layer
entirely). Also asserts the expected markers actually appear in the
generated output (`APPROVAL_LOCKED_FIELDS`, the locked value, and
`disabled: true`), since `tsc` alone would pass just as well on an entity
whose locked-value branch silently didn't render. This repo's own
`json_schema.yaml` declares no `x-approval` entity, so none of these
branches are ever compiled by step 12 otherwise. ~6s. See
`scripts/check_approval_lockdown_gate_fixture.sh`.

**Step 11 (`test:payment-gate`)**: same shape as steps 4-10, for the
write-once Stripe integration stubs (`lib/stripe.ts`,
`app/api/payment/checkout/route.ts`, `app/api/webhooks/stripe/route.ts`)
emitted when a fixture entity declares `x-payment: true`. Exists because
`code_generator/tests/test_payment_gate_fixture.py` only proves the stubs
are *written* — it never proves the written TypeScript actually
type-checks, and this repo's own `test:e2e:build` (step 12) never compiles
these stubs either, because no entity in this repo's own `json_schema.yaml`
declares `x-payment: true`. That gap is exactly how a stale Stripe SDK
`apiVersion` literal (hardcoded in `stripe_lib_stub.ts.jinja2`) shipped
undetected and broke `next build` in any consumer that actually declared
`x-payment: true` — the literal drifts on every `stripe` SDK bump,
including patch bumps within the same `^` caret range, because the SDK's
own `LatestApiVersion` type is baked fresh into each published version. The
fix removes the literal rather than replacing it with a newer one (a
`props.apiVersion || DEFAULT_API_VERSION` fallback in the SDK's own source
makes omission behaviorally identical to pinning the current version,
without a stale literal to go stale again). ~4-6s. See
`scripts/check_payment_gate_fixture.sh`.

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
