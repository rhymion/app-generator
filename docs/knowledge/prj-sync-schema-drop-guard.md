# prj:sync prisma/schema.prisma drop guard

`scripts/prj_sync.py` syncs a consumer's `../prj` overrides into this
generator project. Every file it handles except `messages/*.json` (deep
merged) and `vercel.json` (skipped, generator-owned since `crons` moved
to generated output — see the code comment in `scripts/prj_sync.py`) is
copied **verbatim**: the consumer's `prj/` copy overwrites whatever is
already at the destination path.

For `prisma/schema.prisma`, a verbatim overwrite is dangerous: when this
generator adds a new `model` or field to its own `prisma/schema.prisma`,
a consumer's `prj/prisma/schema.prisma` — captured earlier and hand-
maintained since — does not yet have that addition. A plain
`shutil.copy2` sync silently reverts the destination back to the
consumer's stale content, dropping the new model/field with no warning.
This is not hypothetical: it happened identically three times (proj_c/
app-template, proj_h/insurance-app, proj_g/inventory-app) at the same
commit boundary, `f06d2a0b` (issue #707/#717, the `idempotency_key`
model and `user.api_key_expires_at` field) — see issue #646.

## The guard

Before syncing `prisma/schema.prisma`, `prj_sync.py` parses `model { }`
blocks (name + field names, via `_parse_prisma_models` — a regex-based
scan, not a full Prisma parser; sufficient for this repo's schema
formatting convention of a `model` line followed by a body and a closing
`}` alone on its own line) from both the current destination file and
the incoming consumer file, and diffs them (`_diff_prisma_schema_drop`).

- **Direction matters.** Only `model`/`field` entries present in the
  *destination* (this generator's current content) but *absent* from
  the *incoming consumer file* are flagged. Content present only in the
  consumer's file — a consumer's own model, or a field a consumer added
  to a shared model — is never flagged. That is a consumer's own
  customization flowing in as designed, not something to guard against;
  flagging it would break real consumer extensions, which the design for
  issue #646 explicitly ruled out.
- **On a drop: skip the copy, don't silently proceed, and fail the run.**
  `prj_sync()` leaves the destination file untouched (so no content is
  actually lost — "zero diff" for that one file) and prints an `ERROR`
  line naming every dropped `model`/`model.field` entry, then returns a
  non-zero exit code once all other files have been processed.
  Non-zero is chosen over "warn and keep going" because this generator's
  own `lint_prj_synced.py` already treats a non-zero `prj_sync.py` exit
  as fail-closed (aborts before any lint attempt), and `vercel-build`'s
  `run-s prj:sync python-generate ...` chain stops at the first failing
  step — a warning printed to a log that is not reliably read had
  already failed to prevent this exact class of incident three times.
  Other files still sync normally; only the guarded file's copy is
  skipped, so an unrelated `prj/` change is not blocked by this.
- **This is a heuristic, not a certainty.** The guard cannot distinguish
  "consumer's `prj/` predates a generator addition" from "consumer
  intentionally removed a generator-default model/field" — both look
  identical from file content alone. It always surfaces the case for a
  human to confirm rather than guessing either way.

## Consumer-side remediation

When the guard fires, mirror the missing model/field into the
consumer's own `prj/prisma/schema.prisma` (see app-template PR#123 for
the pattern used for the `f06d2a0b` case specifically) and re-run
`prj:sync`. This does not replace judgment about when to write the
actual database migration on the consumer side — that stays governed by
whatever migration-cadence policy the consumer repo/operator already
follows.

## Scope

The guard covers `prisma/schema.prisma` only (issue #646's acceptance
criteria: "at least `prisma/schema.prisma`"). Other hand-maintained
files synced verbatim from `prj/` are not covered by this specific
guard; extending the same drop-detection approach to another file type
would need its own parser for that file's structure and is a separate
decision.
