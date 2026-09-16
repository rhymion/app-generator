# Consumer `.claude/commands/*.md` — canonical source

`docs/consumer-commands/{generate-schema,update-code,update-component}.md`
in this repo hold the canonical, shared text of the corresponding
`## Completion gate` (and, for `generate-schema.md`, the `## Scenario &
Confirmation Protocol`) sections used by consumer repos generated from
this repo (app-template / inventory-app / insurance-app). This mirrors
the pattern already used for `.claude/commands/investigate.md` and for
`docs/knowledge/vercel-deploy-scripts-canonical-source.md` — consumers
hold a thin reference instead of an independent copy.

These three files live under `docs/`, not `.claude/commands/`, because
this repo's own `.claude/commands/generate-schema.md` and
`.claude/commands/update-code.md` already exist at those paths for a
different audience (this repo's own generator-development tasks, not a
consumer's `prj/`-scoped tasks) — reusing the same path would collide
with, and be wrong content for, this repo's own slash commands. There is
no `update-component.md` collision (this repo's equivalent is
`add-component.md`), but the other two files force all three into a
separate `docs/consumer-commands/` location for consistency.

## Why these three are not a uniform "one-line reference" case

Unlike the vercel scripts (byte-identical across all three consumers) or
`investigate.md` (fully generic, no consumer-specific content),
An earlier investigation found these three files contain
a mix of genuinely shared procedure text and genuinely consumer-specific
measured facts (current `prj/` file counts, verification results tied to
a specific commit, and in `generate-schema.md`'s case a real divergence
in documented `lint:prj` fail-closed semantics between two consumers).
Collapsing the whole file into one reference line would make the
consumer-specific facts wrong for whichever consumer(s) didn't originate
them — this is why that investigation's own resolution left these three files
untouched (recorded as "out of scope, confirmed not a match for the
reference-collapse pattern"), and why this canonicalization only
covers the sections marked as shared in each of the three
`docs/consumer-commands/*.md` files — the rest stays local to each
consumer, referencing the canonical file for the shared part only.

- `update-component.md`: canonicalized in full (only the project name and
  `prj/` file count varied across consumers — both are handled as local
  facts the consumer's own thin file states directly, not templated here).
- `update-code.md`: canonicalized in full, **with one behavior change**:
  the `check:generated` gate step (previously present only in one
  consumer's copy) is included here for all consumers. See the "Universal step,
  not app-template-specific" note at the top of `docs/consumer-commands/update-code.md` —
  the reasoning for the step is generic to this generator's `db_table`
  service-layer convention, not specific to any one consumer's schema.
  Extending it to the consumers currently missing it is a real
  gate-behavior change and should be confirmed before the distribution
  task that actually edits those consumers' own gate docs lands.

- `generate-schema.md`: **partially** canonicalized — the `## Scenario &
  Confirmation Protocol` section and most of the `## Completion gate`
  section are shared; several subsections are explicitly marked
  "KEEP LOCAL" in the canonical file because they are measured facts or
  (in one case) a genuine documented behavioral divergence between
  consumers that this change does not resolve.

## What this canonicalization does not do

This change modifies **only** this repo (app-generator) — no consumer
repo's `.claude/commands/*.md` is edited here. A future distribution
task is expected to: (a) replace each consumer's own copy of these three
files with a short local file (frontmatter + intro + a reference to the
relevant file(s) here + a small consumer-specific facts section), mirroring
`investigate.md`'s existing thin-reference shape, and (b) resolve the two
open items flagged above (the `check:generated` step extension, and the
`lint:prj` fail-closed semantics divergence) rather than silently
adopting one side.
