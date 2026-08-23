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
2. `npm run check:generated` — must run after step 1 (needs the generated `lib/`/`app/` tree on disk); see below for why
3. `npm run lint` — must run after step 1, not before (see below for why)
4. `npm run test:e2e:cy:api` — API Cypress specs only (mandatory dev-time gate)
5. `npm --prefix app-generator audit --omit=dev --audit-level=high` — production-dependency vulnerability scan

Not a local step — enforced by CI instead:

6. `npm run test:e2e:cy:start` — full Cypress suite including UI specs.
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

### Why pytest and vitest are not required steps here

`npm run test:pytest` and `npm run test:vitest` (both delegate to
`app-generator/`) are **not** required steps for this task type in a
consumer repo. app-generator already runs both against its own code in its
own CI (`pytest`, `unit-tests` jobs in
`app-generator/.github/workflows/ci.yml`) — and this task type's own scope
rule already forbids touching `app-generator/`, so re-running them here
against unmodified app-generator content is redundant.

vitest specifically stays dropped even accounting for prj/-sourced content
(see the lint section below for why lint is a different case): as long as
none of the consumer's own `prj/` files is named `*.test.ts`/`*.spec.ts`,
vitest's default test discovery has nothing new to execute against `prj/`
regardless of gate ordering — it would only re-run app-generator's own
existing suite, which is already covered by app-generator's own CI. **This
repo's own current `prj/` file count and composition is a measured fact
that changes over time — see this repo's own `.claude/commands/update-code.md`
"## <this repo> specifics" section for the current number, not this file.**

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
