# generate-schema — consumer procedure + Completion gate (canonical, cmd_714)

Canonical text for the bulk of `generate-schema.md` in consumer repos
generated from this repo (app-generator). Consumer repos hold a thin
reference to this file instead of a standalone copy — see
`docs/knowledge/consumer-commands-canonical-source.md`.

**cmd_714 scope note**: unlike `update-component.md` and `update-code.md`,
this file is **not** a candidate for full replacement by a one-line
reference (the style used for `investigate.md`). Sections marked below as
"KEEP LOCAL" contain consumer-measured facts (current `prj/` file counts,
specific verification runs tied to a commit) that would become wrong for
two of three consumers if collapsed into one shared line — see
`docs/knowledge/consumer-commands-canonical-source.md` for the cmd_711/③
finding this reaffirms. Only the sections below (Scenario &
Confirmation Protocol, and the generic parts of the Completion gate) are
canonical; the consumer-specific parts stay in each consumer's own
`.claude/commands/generate-schema.md` alongside a reference to this file
for the rest.

## Scenario & Confirmation Protocol

### Scenario A — Fresh start (default schema only)

No custom models or entities have been added yet. The repository contains only the
default Prisma models (`user`, `organization`, `role`, `permission`, etc.) and
default JSON schema entities.

- Describe the application domain and the models/entities you want to create.
- The AI applies the six confirmation rules below before proceeding.

### Scenario B — Add to existing schema

Custom models and/or entities already exist. You are extending the schema with new ones.

- Describe what you want to add (new Prisma model, new JSON entity, or both).
- The AI applies the six confirmation rules below before adding anything.

---

### Confirmation rules (AI must verify before acting)

**① Default model/entity preservation**
Keep all default Prisma models and JSON schema entities unless explicitly instructed
otherwise. If deletion is requested, explain the risks (broken relations, cascade effects)
and ask for confirmation before deleting.

**② Naming convention**
New model and entity names must be singular lowercase (e.g., `product`, `purchase_order`).
If the user specifies a plural or uppercase name, explain the standard rule and the risks
of non-standard naming, then ask for confirmation before proceeding.

**③ ID type — String CUID only**
The primary ID is always `String @id @default(cuid())`. If the user requests a different
type (e.g., integer), keep it as a non-primary unique field instead. Explain this
constraint and confirm with the user.

**④ Existing feature first**
If a built-in feature (comment, attachment, reaction, approval, etc.) can largely satisfy
the requirement, recommend using it. Explain that labels and display names are easily
changed without altering the model structure. Confirm before creating a custom model.

**④a Built-in extension keys, proactively**
Before writing a workaround for something the generator seems not to support, check
`app-generator/docs/knowledge/schema-yaml-configuration.md` for an existing `x-*` key that
already expresses it. Use it even if the task description doesn't name it — this is the
default, not something that needs to be asked for, and applies with extra force in
fast-track mode (⑥).

**⑤ JSON schema array display**
Confirm whether to show an independent entity's list on another entity's detail page.
Default: do NOT add a user-created item list to the user detail page unless explicitly
requested. For other relationships (e.g., show `resource` list on `organization` detail?),
always confirm.

**⑥ Fast-track option**
Offer the user the option to skip all confirmation prompts and let the AI choose the best
approach autonomously. In fast-track mode the AI generates and presents the result;
the user follows up with adjustments after reviewing the generated application.

**⑦ Deviating from a source diagram**
If the task description includes or references an ER diagram or another external design
document, the generated schema does not need to match it exactly. Shaping the schema to
what the generator actually supports is a legitimate choice — write down *what broke and
why* as fact, kept separate from any "this is the better design anyway" justification.

---

## Completion gate

Two-stage e2e, mirroring app-generator's own pattern
(`app-generator/.claude/commands/generate-schema.md §Completion gate`):
the mandatory local gate runs the API-only Cypress suite; the full suite
(including UI specs) is not a required local step — it runs automatically
at merge time via CI.

Required, in this order:

1. `npm run lint` — runs `prj:sync` internally, then lints exactly the
   `.ts`/`.tsx` files `prj:sync` just reported syncing (see below for
   why this is not app-generator's own `lint` script and does not
   measure the full generated codebase).
2. `npm run test:e2e:build` — prj:sync (idempotent re-run; safe — step 1
   already did the same copy) + docker:up:test + generate-code + db:push +
   db:generate + db:seed-tenant + build
3. `npm --prefix app-generator run check:generated` — generated code matches templates/schema
4. `npm run test:e2e:cy:api` — API Cypress specs only (mandatory dev-time gate)
5. `npm --prefix app-generator audit --omit=dev --audit-level=high` — production-dependency vulnerability scan

Not a local step — enforced by CI instead:

6. `npm run test:e2e:cy:start` — full Cypress suite including UI specs.
   Runs automatically on push/PR to this consumer's own default integration
   branch via this repo's own `.github/workflows/ci.yml` (`e2e-tests` job).
   Do not run this locally as a gate; it's covered before merge regardless.

### Why pytest and vitest are not required steps here

`npm run test:pytest` and `npm run test:vitest` (both delegate to
`app-generator/`) are **not** required steps for this task type in a
consumer repo. app-generator already runs both against its own code in its
own CI (`pytest`, `unit-tests` jobs in
`app-generator/.github/workflows/ci.yml`) — and this task type's own scope
rule already forbids touching `app-generator/`, so re-running them here
against unmodified app-generator content is redundant.

vitest specifically stays dropped even accounting for prj/-sourced content
(see the lint section below for why lint is a different case), **as long
as none of this repo's own `prj/` files is named `*.test.ts`/`*.spec.ts`
— KEEP LOCAL: the current `prj/` file count and composition is a measured
fact per consumer, see this repo's own `.claude/commands/generate-schema.md`
"## <this repo> specifics" section, not this file.**

### Why lint stays — and why it is not app-generator's own `lint`

`npm run lint` here does **not** delegate to app-generator's own `lint`
script (`eslint --max-warnings 20`, unscoped over that whole repo) —
it delegates to `npm --prefix app-generator run lint:prj`
(`app-generator/scripts/lint_prj_synced.py`). This is a decision (cmd_683,
2026-08-13): a consumer's lint is not a copy of the generator's own lint.
app-generator's own code is already covered by app-generator's own CI;
what a consumer repo needs to check is whether `prj/`'s own hand-written
content — the only thing unique to that repo — passes ESLint once
synced to its real destination paths.

`lint:prj` runs `prj:sync` itself, takes prj_sync.py's own
`copied`/`merged` stdout lines as the list of what to lint (never
re-derives that list independently), filters to `.ts`/`.tsx`, and lints
exactly those files. Because the population is explicitly the output of
`prj:sync` and nothing else, running it before or after `generate-code`
makes no difference to what gets measured — there is no larger,
unscoped population for step ordering to accidentally expose (contrast
with app-generator's own `lint`, which genuinely must run before
`generate-code` to match its own CI precondition — see
`app-generator/docs/knowledge/lint-gate-must-match-ci-precondition.md`
and `app-generator/docs/knowledge/consumer-prj-scoped-lint.md` for the
full contrast between the two). Step 1 here is placed first purely so a
badly-formed `prj/` change is caught before spending time on the much
slower `test:e2e:build` step, not because of a scope leak this ordering
prevents.

**KEEP LOCAL — "Fail-closed" semantics section**: the exact wording of
the "`lint:prj` exits non-zero when..." paragraph that normally follows
here is **not** canonicalized. cmd_714's diff audit found inventory-app's
and insurance-app's copies of this paragraph describe genuinely different
fail-closed semantics (inventory-app: fails only if `prj:sync` could not
be observed running against a real `../prj` at all — a `prj/` with zero
`.ts`/`.tsx` files but real other content is a legitimate pass;
insurance-app: fails if `prj:sync` reports zero `.ts`/`.tsx` files for
any reason, including a legitimately-empty fresh `prj/`). This is either
a real, consumer-specific product decision or an unresolved inconsistency
in `lint:prj`'s actual behavior across consumers — cmd_714 does not
resolve which, since determining that requires reading each consumer's
actual `lint:prj` invocation/config, not just comparing docs. Flagged for
follow-up; each consumer's own doc keeps its own current wording verbatim
until that follow-up resolves it.

**No `--max-warnings` ceiling here**, unlike app-generator's own `lint`
— only ESLint errors (or the fail-closed check above) fail this step.
See `app-generator/docs/knowledge/consumer-prj-scoped-lint.md` for why a
ceiling inherited from app-generator's own template-surface baseline
would not be a meaningful signal for `prj/`'s own, structurally
different and independently growing content.

**KEEP LOCAL — measured verification result**: the paragraph confirming
`npm run lint` was actually run against this repo's real `prj/` content
and its exact file count/exit status, and the paragraph explaining how
this fix supersedes the ordering-only fix that preceded it, are both
per-consumer measured facts tied to a specific commit — keep verbatim in
each consumer's own doc, not here.

#### History of this section

An earlier revision of this doc delegated `npm run lint` to
app-generator's own `lint` script and placed it after `test:e2e:build` —
measuring the full generated codebase (hundreds of pre-existing,
per-entity template warnings unrelated to `prj/`). That was fixed in two
stages: first the *ordering* (moved before `generate-code`, reducing but
not eliminating the false-population problem and still using a warning
ceiling never calibrated for `prj/`'s own content), then the *delegate
target* (replaced entirely with the purpose-built, `prj/`-scoped
`lint:prj` mechanism described above — ordering relative to
`generate-code` is no longer a correctness requirement for this step at
all, only a minor performance consideration: fail fast before the slow
build step).

### CI does not run this step — a green CI run does not mean lint passed

Confirm this against each consumer's own `.github/workflows/ci.yml`
directly rather than assuming — **KEEP LOCAL**, since whether a lint job
exists in CI is itself a per-consumer fact, not a generic one. As of
cmd_714, app-template's CI defines exactly one job (`E2E Tests`) with no
lint job of any kind. A product gate is deliberately not made to depend
on CI (a local-only check must still work for a developer who never
touches CI, per this generator's own gate-design principle), so this is
not itself a defect in any consumer that also lacks a CI lint job — but
it means a green CI run on a PR is not evidence that `npm run lint` was
ever run or passed on that PR in such a consumer.

### npm audit — why it stays

`npm --prefix app-generator audit --omit=dev --audit-level=high` remains
a required step even though app-generator's own `audit` CI job already
audits this same dependency tree: a new high/critical CVE can be
published in an already-pinned dependency *after* app-generator's own
audit last passed, with no app-generator commit to re-trigger it (a
`nanoid` vulnerability surfaced exactly this way in practice). As of
cmd_714, none of the three known consumer repos (app-template,
inventory-app, insurance-app) run an audit job in their own CI, so this
local step is the only check standing between a newly-disclosed
vulnerable pin and merge in any of them.
