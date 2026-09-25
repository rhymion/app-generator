# Raw SQL Policy

Governs every `$queryRaw`/`$executeRaw` family call in generator templates and
in this repo's own hand-maintained code (`lib/`, `scripts/`, `cypress.config.ts`).

---

## Overview

| Rule | Detail |
|---|---|
| Default | Use Prisma's query builder or the entity service layer. No raw SQL. |
| `$queryRawUnsafe` / `$executeRawUnsafe` / `Prisma.raw` | **Always forbidden.** No allowlist exception exists for these — every legitimate need this generator has ever had is expressible as a tagged template with zero or bound interpolation. |
| `$queryRaw`\`...\` / `$executeRaw`\`...\` (tagged template) | Allowed only when the Prisma query builder cannot express the query, and only via `code_generator/check_generated_allowlist.yaml` with a recorded reason. Every runtime-supplied value must be bound through `${}`/`Prisma.sql`, never string-concatenated into the query text. |
| Machine enforcement | `code_generator/check_generated.py` (`npm run check:generated`, mandatory gate step 15) scans generator-emitted output; `code_generator/tests/test_sql_safety.py` (`pytest code_generator/tests`, run manually after `generate-code`) is a narrower second signal — see its own module docstring for why it never actually executes inside CI's `pytest` job. |

---

## Why "unsafe-named" APIs are banned outright, even when the call is safe

`$queryRawUnsafe`/`$executeRawUnsafe` accept a plain string and interpolate
values into it before Prisma ever sees them — the API itself carries no
guarantee that a given call is safe, only that *this particular* call happens
to have no runtime-supplied value in it today. A future edit to a call site
that looks safe can silently turn it into a real SQL-injection point, and
nothing in the API's own shape stops that. The tagged-template form
(`` $queryRaw`...` ``/`` $executeRaw`...` ``) does not have this problem:
Prisma binds every `${}` interpolation as a query parameter, so the call is
structurally safe regardless of what a future edit puts inside the
interpolation.

Because of this, prefer the tagged-template form even for a statement that
has no runtime-supplied value at all (e.g. `CREATE EXTENSION IF NOT EXISTS
pg_trgm`) and could just as easily use `$executeRawUnsafe` with the exact
same runtime behavior. The chosen form should never leave a customer or a
future reviewer wondering whether an "unsafe"-named API in shipped code
needed a second look.

## When a raw query is genuinely necessary

A handful of statements have no Prisma query-builder equivalent at all:

- **Cross-entity search** (`lib/search/helpers.ts`, from
  `search_helpers.ts.jinja2`) unions N heterogeneous entity tables under one
  permission-filtered, paginated query. All user-supplied values (search
  text, `userId`, org IDs) are bound via `Prisma.sql`/`${}` parameters.
- **DDL / extension bootstrap** (`lib/db-init.ts`, from `db_init.ts.jinja2`;
  `cypress.config.ts`; `scripts/seed-baseline.ts`) — `CREATE EXTENSION`,
  `CREATE INDEX CONCURRENTLY`. Target names are SQL identifiers, which
  Prisma cannot bind as query parameters regardless of API choice; every
  identifier substituted into these statements is resolved once at
  `generate-code` time from the project's own `schema.yaml` (developer-
  controlled), never from a runtime request.
- **Postgres-specific functions with no Prisma equivalent**
  (`lib/<entity>/service.ts`, from `service_scheduled.ts.jinja2`'s scheduled-
  task claim path) — `pg_advisory_xact_lock(...)`, with the row id bound via
  `${row.id}`.

Each of these is a tagged-template call, listed with a reason in
`code_generator/check_generated_allowlist.yaml`, and commented in its own
template explaining why the query builder doesn't reach and (if there is no
runtime-supplied value at all) where every interpolated value actually comes
from.

## Adding a new raw query

1. Confirm the query builder genuinely cannot express what you need — not
   just that the raw form is more convenient.
2. Write it as a tagged template (`` $queryRaw`...` `` / `` $executeRaw`...` ``
   or `Prisma.sql`), never `$queryRawUnsafe`/`$executeRawUnsafe`/`Prisma.raw`.
3. Bind every runtime-supplied value through `${}`/`Prisma.sql` — never
   `+`-concatenate a value into the query text, even one that "looks" safe.
4. Add a comment at the call site: why the query builder doesn't cover this,
   and (if any part of the SQL text is not a bound runtime value) where that
   text actually comes from — a generate-time schema field, a fixed literal,
   etc.
5. Add an entry to `code_generator/check_generated_allowlist.yaml` with a
   `reason` — `npm run check:generated` (gate step 15) fails closed on any
   `$queryRaw`/`$executeRaw`/`*Unsafe`/`Prisma.raw` use it isn't told about.

## Machine enforcement: what each check actually covers

`check_generated.py` walks every file `generate.py` would write for the
current schema — both per-entity files (`lib/<entity>/*`,
`components/<entity>/*`, `app/[locale]/<entity>/*`, `app/api/<entity>/*`) and
the schema-wide files gated on a project-wide condition rather than any one
entity (`lib/comment/service.ts`/`lib/reaction/service.ts` when reactions are
enabled; `lib/db-init.ts`/`lib/search/helpers.ts` when any entity is
searchable) — and flags `$queryRaw`/`$executeRaw`/`$queryRawUnsafe`/
`$executeRawUnsafe` on **any** receiver (`prisma.`, a `$transaction` callback
param, or any other identifier — the rule is about which method is called,
not what it's called on).

`test_sql_safety.py` globs `lib/**/*.ts` for `$queryRawUnsafe(`/
`$executeRawUnsafe(`/`Prisma.raw(` (call-syntax, not a bare name — so
writing the kind of explanatory comment step 4 above asks for doesn't itself
trip the check). It is a narrower, allowlist-free backstop for whoever runs
`pytest code_generator/tests` locally after `generate-code`; `check_generated.py`
(step 15, also exercised by CI's `e2e-tests` job) is the check the gate and
CI actually rely on.

## Why this policy exists

Even a call to an "unsafe"-named API that is provably safe today invites
unnecessary suspicion from a customer or a future reviewer skimming shipped
code — the name alone reads as a warning sign regardless of what the call
actually does. The policy above exists to make that judgment unnecessary:
avoid the unsafe-named form wherever a safe equivalent exists, and where a
raw query is genuinely unavoidable, make the reason it's safe and the reason
it's necessary explicit at the call site rather than something a reader has
to reconstruct.
