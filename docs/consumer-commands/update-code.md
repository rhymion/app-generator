# update-code — consumer Completion gate (canonical)

Canonical text for the `## Completion gate` section of `update-code.md` in
consumer repos generated from this repo (app-generator). Consumer repos
hold a thin reference to this file instead of a standalone copy — see
`docs/knowledge/consumer-commands-canonical-source.md`.

**Universal step, not app-template-specific**: at one point,
only app-template's copy of this gate included step 2
(`check:generated`) below; inventory-app's and insurance-app's copies were
missing it. The reasoning for the step (a `check:generated`-detectable
generated-code drift can be introduced by any `update-code` task,
regardless of which consumer or which entities it touches — see the step's
own rationale) is generic to the generator, not specific to app-template's
schema. This canonical form includes the step for all three consumers;
closing the gap in inventory-app's and insurance-app's own gate docs is
deferred to the future distribution task that will actually touch consumer
repos, and should be reviewed and approved before that PR lands since it
is a real gate-behavior change, not mere doc consolidation.

Two-stage e2e, mirroring app-generator's own pattern
(`app-generator/.claude/commands/update-code.md §Completion gate`): the
mandatory local gate runs the API-only Cypress suite; the full suite
(including UI specs) is not a required local step — it runs automatically
at merge time via CI.

Required, in this order:

1. `npm run test:e2e:build` — prj:sync + docker:up:test + generate-code + db:push + db:generate + db:seed-baseline + build
2. `npm --prefix app-generator run test:vitest` — unit tests against the generated tree; must run after step 1 (see below for why)
3. `npm run check:generated` — must run after step 1 (needs the generated `lib/`/`app/` tree on disk); see below for why
4. `npm run lint` — must run after step 1, not before (see below for why)
5. `npm run test:e2e:cy:api` — API Cypress specs only (mandatory dev-time gate)
6. `npm --prefix app-generator audit --omit=dev --audit-level=high` — production-dependency vulnerability scan

Not a local step — enforced by CI instead:

7. `npm run test:e2e:cy:start` — full Cypress suite including UI specs.
   Runs automatically on push/PR to this consumer's own default integration
   branch via this repo's own `.github/workflows/ci.yml` (`e2e-tests` job).
   Do not run this locally as a gate; it's covered before merge regardless.

### check:generated — why it's a required step here, not just generate-schema's

`check:generated` was already a `generate-schema.md` completion-gate step
(schema-changing tasks only). That was the whole reason a real violation
(the `commentable` bridge's comment/reaction writes going straight to
`prisma.comment.*`/`prisma.reaction.*` from `lib/db_table/actions.ts`
instead of through a service layer) went unnoticed from 2026-05-23 until
a later fix in app-template: `update-code` tasks — routine feature work, not
schema changes — are both far more frequent and exactly the kind of task
that can introduce a new write:direct violation (e.g. a hand-authored
server action reaching for `prisma.<model>.*` directly) without ever
touching a schema file, so a generate-schema-only gate structurally never
saw it. Requiring the step here closes that gap at the source instead of
relying solely on CI to catch it after the fact. The underlying risk is a
property of any consumer built on this generator's `db_table` service-layer
convention, not of app-template's own schema content specifically.

### Why vitest is a required step here, and pytest is not

`npm run test:pytest` (delegates to `app-generator/`) is **not** a required
step for this task type in a consumer repo: app-generator already runs it
against its own code in its own CI (`pytest` job in
`app-generator/.github/workflows/ci.yml`), and it does not inspect
generated output.

`npm --prefix app-generator run test:vitest` **is** required, because
app-generator's own `unit-tests` CI job runs vitest on a checkout that has
not been through `generate-code`. Any test that scans generated files
(gitignored `app/`/`lib/` output, or `prj/`-synced stubs) therefore finds
nothing to check there and passes vacuously, while the same test run
inside a consumer, after `generate-code`, sees the real files. Two real
defects were caught only this way: a static scanner test tripping over a
dead branch in a generated import route, and a stale write-once
`prj/scripts/grant-all-permissions.ts` stub that no longer matched its
test. Neither was visible to app-generator's CI or to any earlier step of
this gate.

**Placement**: run it right after step 1. Step 1 already performs
`generate-code` and `db:generate`, and vitest needs no running database
(`test/flows/**` is excluded by `vitest.config.ts`). Running it before
`check:generated`/`lint`/Cypress fails fast on a broken test before the
slower steps. The absolute cheapest point would be inside step 1, between
`db:generate` and `db:seed-baseline`, but that is an ordering inside
app-generator's own `test:e2e:build` script rather than a gate step, so
this gate does not depend on it.

**Failures**: a failing vitest case here is a real defect to fix (in
app-generator or in the consumer's `prj/`), not something to skip or
loosen. Report the failing test's name and the result of re-running it
individually.

### Why lint stays — and why step order matters

Unlike pytest/vitest, `npm run lint` **is** retained as a required step —
run at step 3, **after** step 1 (`test:e2e:build`, which performs
`prj:sync`), not before. ESLint has no path-based include/exclude rule
that would skip prj/-synced files, so running lint after prj:sync means it
genuinely lints all of this consumer's own `prj/` TS/TSX files at their
synced destination paths inside `app-generator/`, not just app-generator's
own templates. This is real coverage app-generator's own CI cannot
provide: app-generator's own `lint`/`unit-tests` CI jobs check out
app-generator alone with no `prj/` sibling directory, so they structurally
never see this content, no matter what changes in a consumer repo. **Do
not reorder step 3 ahead of step 1** — doing so silently drops prj/ lint
coverage back to zero.

### npm audit — why it stays

`npm --prefix app-generator audit --omit=dev --audit-level=high` remains a
required step even though app-generator's own `audit` CI job already
audits this same dependency tree: a new high/critical CVE can be published
in an already-pinned dependency *after* app-generator's own audit last
passed, with no app-generator commit to re-trigger it (a `nanoid`
vulnerability surfaced exactly this way in practice). Currently, none
of the three known consumer repos (app-template, inventory-app,
insurance-app) run an audit job in their own CI, so this local step is the
only check standing between a newly-disclosed vulnerable pin and merge in
any of them.
