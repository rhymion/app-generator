# Vercel deploy scripts — app-generator is the canonical source

`scripts/vercel-{setup,deploy,env,teardown}.sh` and
`.env.vercel.production.local.example` in this repo are the canonical
copies of the Vercel deployment tooling used by apps generated from
this repo (app-generator itself deploys its own demo via
`scripts/gcp-*.sh`, a separate, unrelated GCP path that reads its own
`.env.production.local` — the two are not the same deployment target
and must not be merged into one file. Note: `scripts/gcp-env.sh` and
`scripts/vercel-env.sh` both reference a `.env.production.local.example`
file in their own error messages, but no such example file is actually
committed in this repo today — only `.env.vercel.production.local.example`
and `.env.example` exist at repo root).

Previously, three consumer repos (app-template / inventory-app /
insurance-app) each carried their own independent copy of these files.
Investigation found the five files byte-identical
across all three consumers, and the env template differing only by
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (present in inventory-app and
insurance-app, missing in app-template — a real gap in app-template,
not legitimate divergence; both vars are read by this repo's own
`scripts/seed-baseline-credentials.ts`). No app-generator-side original
of these files existed — they were promoted here from the consumers'
duplicated copies (permitted under an established judging pattern: three
consumers wanting the same thing is itself the signal to canonicalize,
even when the generator had no prior copy of its own).

Consumers now hold a thin reference to these files (a symlink into
their own `app-generator/` submodule checkout) instead of an
independent copy — same "positive: one canonical, negative: a
one-line reference" pattern already used for
`.claude/commands/investigate.md`. Do not reintroduce a standalone
consumer-side copy; edit here and let the submodule bump carry the
update downstream.
