# Vercel deploy scripts — app-generator is the canonical source

`scripts/vercel-{setup,deploy,env,teardown}.sh` and
`.env.vercel.production.local.example` in this repo are the canonical
copies of the Vercel deployment tooling used by apps generated from
this repo (app-generator itself deploys its own demo via
`scripts/gcp-*.sh`, a separate, unrelated GCP path that reads its own
`.env.production.local` — the two are not the same deployment target
and must not be merged into one file. `scripts/gcp-env.sh` has its own
canonical template, `.env.gcp.production.local.example` — both GCP and
Vercel read the same runtime `.env.production.local`, so gcp-env.sh can
reuse Vercel-derived `DATABASE_URL_PROD`/`DATABASE_URL_UNPOOLED_PROD`
values already present in it; only the `.example` templates differ,
one per deployment path).

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
