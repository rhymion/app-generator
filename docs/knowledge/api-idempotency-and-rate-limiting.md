# API idempotency keys and per-API-key rate limiting

## What this is

Stage 1 (d)/(e) of `ai-agent-integration-design.md`'s "Idempotency keys and
rate limiting — resolved design": two independent, purely additive
mechanisms added to the generated REST API surface, both scoped to axis 1
(external callers, agent or otherwise) generally — neither is agent-specific.

- **Idempotency keys** — an optional `Idempotency-Key` request header on a
  single-record `POST` create endpoint (`api_route.ts.jinja2`) makes a
  retried create safe: a repeat with the same key and the same request body
  replays the first call's result instead of creating a second record.
- **Rate limiting** — two new buckets (`api:read`, `api:write`) on the
  existing `lib/rate-limit/` mechanism, keyed by the caller's authenticated
  user id (the identity an API key resolves to), applied to every REST
  route that exclusively authenticates via `authenticateApiKey()`.

Not a new schema key on either count — every `can_create` entity's create
endpoint gets idempotency-key support unconditionally, and every
`authenticateApiKey()`-only REST route gets rate limiting unconditionally.

## Idempotency keys

### Why a database table, not Redis

Redis cannot participate in the same database transaction as the record
being created. If the idempotency key were recorded in a separate store, a
crash between the two writes leaves them out of sync, and a retry after
that crash can still double-create the record — exactly the failure
idempotency exists to prevent. A `idempotency_key` row (`prisma/schema.prisma`,
a hand-maintained system-default table, not a `.jinja2` template — same
category as `lib/rate-limit/`) is written in the *same* Postgres
transaction as the record it guards, so the two either both commit or both
roll back.

### Design

- Scope: single-record `POST` create endpoints only. Update/delete are
  already idempotent by nature; CSV import already has its own
  key-column-based duplicate protection.
- The table holds the client-supplied key, the caller's user id
  (`actor_user_id`), the target entity name (`target_entity`, the route's
  own `parent` identifier — the same caller may reuse one key value across
  different endpoints without collision), a SHA-256 hash of the request
  body (`request_hash`), and the recorded result (`response_status`,
  always 201; `response_body`).
- Same key + same body hash → the cached `response_body` is replayed; none
  of the entity's own create side effects (audit log, `afterCreate`,
  approval-line creation, reservation allocation, or the post-transaction
  assignee-notification triggers) run again.
- Same key + a *different* body hash → rejected as `AppError('CONFLICT')`
  (HTTP 409) — never silently replayed.
- Retention: one day, enforced **logically** at lookup time
  (`lib/idempotency.ts`'s `checkIdempotencyKey` treats a row older than 24h
  as absent), not by a scheduled deletion job — the design ruling
  deliberately does not add a new scheduling mechanism for a housekeeping
  delete. A stale row is simply overwritten in place the next time its
  `(key, actor_user_id, target_entity)` tuple is reused
  (`recordIdempotencyKey`'s `upsert`).

### Where the logic actually lives

`lib/idempotency.ts` (hand-maintained, not generated) exports
`hashIdempotencyBody()`, `checkIdempotencyKey()`, and
`recordIdempotencyKey()`. The check/record calls are threaded into
`service.ts.jinja2`'s `add{{Entity}}()` — **inside its existing
`prisma.$transaction()` callback**, not in a second transaction opened by
the route template — because that is the only way to satisfy "same
transaction as the record" for every entity generically:

- `add{{Entity}}()` gains one new optional trailing parameter,
  `idempotency?: { key: string; bodyHash: string }`.
- At the top of the transaction: if `idempotency` is present, look up a
  live cached result and return it early (skipping create + side effects)
  on a hash match, or throw `CONFLICT` on a hash mismatch.
- At the bottom of the transaction: if `idempotency` is present, record the
  just-created result under that key before returning it.
- The two post-transaction notification blocks (`has_assignee_id`'s assign
  notification, `child_assignee_notify_create_code`) are wrapped in `if
  (!_idempotentReplay)` — otherwise a replayed request would re-send a
  notification that already fired on the original request.

`api_route.ts.jinja2`'s `POST` handler only reads the `Idempotency-Key`
header, hashes the parsed body, and passes both through as the new
argument — it does not touch the transaction itself.

### Fixture-gate shimming

Five of the `.claude/commands/update-generator.md` Completion gate's
fixture gates (decimal, oto-mandatory, oto-decimal, approval-lockdown,
direct-attachment) exercise a generated file that transitively imports
`add{{Entity}}` from `service.ts` (directly, or via `FormUpsert.tsx` →
its Server Action). Each such fixture's isolated Prisma client (a small,
fixture-only schema) doesn't declare `idempotency_key`, so the *real*
`lib/idempotency.ts`'s `Prisma.TransactionClient` type (resolved through
the fixture's own `@/app/generated/prisma/client` remap) fails to type-check
against it — the exact same category of problem `shims/prisma.ts`/
`shims/authz.ts`/`shims/api-auth.ts` already solve for those fixtures.
Fixed the same way: each of the five now ships a `shims/idempotency.ts`
(same public signatures, throws `'fixture stub'`, never actually invoked
under `tsc --noEmit`) plus a `"@/lib/idempotency": ["./lib/idempotency.ts"]`
tsconfig `paths` entry and a matching `cp` line in the corresponding
`scripts/check_*_gate_fixture.sh`.

## Rate limiting

**Already exists — two new buckets on an existing mechanism, not a second
one.** `lib/rate-limit/index.ts` already implements bucket-scoped limiting
with an in-memory and a Redis adapter, auto-selected by `getRateLimiter()`
based on `REDIS_URL`.

New buckets, added to `PRODUCTION_BUCKETS`:

- `api:read` — 300/minute, covers `GET` list/detail.
- `api:write` — 60/minute, covers `POST`/`PUT`/`DELETE`/bulk.
- Both keyed by the caller's resolved user id (`actorId`, already computed
  by `authenticateApiKey()`), not IP — an API caller can share or rotate
  its IP, but the account an API key resolves to is its real identity
  (mirrors the existing `auth:mfa:challenge` precedent of keying by
  identity when IP isn't a reliable signal).
- Both overridable via `RATE_LIMIT_API_READ_LIMIT` /
  `RATE_LIMIT_API_WRITE_LIMIT` env vars, following the exact
  `RATE_LIMIT_AUTH_CREDENTIALS_LIMIT` precedent already in the file.
- A limited request returns HTTP 429 with `{ error: 'rate_limited',
  retryAfter: <seconds> }`, a `Retry-After` header, and an
  `X-RateLimit-Bucket` header — the same response shape `proxy.ts` already
  uses for the `auth:*` buckets.

### Where it's wired in

Every REST route template whose handlers authenticate *exclusively* via
`authenticateApiKey()` (no dual-auth session fallback): `api_route.ts.jinja2`
(`GET` → `api:read`, `POST` → `api:write`), `api_detail_route.ts.jinja2`
(`GET` → `api:read`, `PUT`/`DELETE` → `api:write`), and
`api_bulk_route.ts.jinja2` (`POST`/`PUT`/`DELETE` → `api:write`). The check
runs immediately after `authenticateApiKey()`, before any permission lookup
or DB query, so a rate-limited caller costs one cache/counter check, not a
full permission resolution.

**Deliberately not wired into `api_export_route.ts.jinja2` /
`api_import_route.ts.jinja2`**: both use `resolveActorId()`'s dual-auth
(session cookie *or* API key), not `authenticateApiKey()` exclusively. A
per-API-key bucket doesn't have a natural meaning for a session-authenticated
UI caller on the same route, and the design doc's own buckets are scoped to
"GET list/detail" and "POST/PUT/DELETE/bulk" — export/import weren't named.
Left as an open scope question for a future stage if a real need for
rate-limiting those two surfaces surfaces.

## Verification

- Full `.claude/commands/update-generator.md` Completion gate (all 20
  steps) run against this repo's own dogfood schema — including
  `test:e2e:cy:api` (268/268 passing) and `test:e2e:cy:ui`, neither of
  which sends `Idempotency-Key` or approaches either rate-limit ceiling, so
  both mechanisms are exercised only as a pure no-op on the existing
  suites (opt-in idempotency; per-actor-scoped rate limits with a fresh
  actor per test).
- No dedicated Cypress/unit test for the idempotency replay/conflict path
  or the 429 response shape was added in this pass — out of this task's
  own scope; a future task adding such coverage should exercise: same key
  + same body → 201 with the identical body and no duplicate row; same key
  + different body → 409; and the `api:write` bucket actually returning 429
  once exhausted (with `RATE_LIMIT_API_WRITE_LIMIT` narrowed for a fast
  test, mirroring the existing `RATE_LIMIT_AUTH_CREDENTIALS_LIMIT` test
  override pattern).
