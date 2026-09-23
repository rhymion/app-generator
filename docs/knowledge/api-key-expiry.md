# API key expiry

## What this is

Stage 2 of `ai-agent-integration-design.md` (Issue #717): an optional
expiry on `user.api_key` — the same key column every account already has,
human or agent. No new principal type: an agent is an ordinary `user`
account, exactly like a human's, per the project owner's ruling recorded in
that design doc.

- **`user.api_key_expires_at`** (`prisma/schema.prisma`) — nullable
  `DateTime`. `null` means the key never expires, which is the behavior
  every existing key already has — adding this column changes nothing for
  any key that doesn't opt in.
- **Checked in the single shared validation point.** `authenticateApiKey()`
  (`lib/api-auth.ts`) is the *only* place API-key validation logic lives —
  every route template calls into it, none re-implements it (confirmed in
  the design doc). A key whose `api_key_expires_at` is set and is at or
  before the current time is rejected with `401 API key expired.`, the same
  status code and error shape as an unrecognized key.
- **Cache-safe.** `authenticateApiKey()` caches `api_key → {userId,
  expiresAt}` per-process (production builds only) with a 5-minute TTL. The
  expiry comparison happens against the *current* time on every lookup,
  cache hit or not — so a key that expires partway through its cache TTL is
  still caught on the very next request, rather than staying valid until
  the cache entry ages out.
- **No setter yet.** This stage adds the column and the enforcement check
  only — there is no UI or API surface to set/change `api_key_expires_at`
  today (out of this stage's scope per the design doc; the field can still
  be set directly in the database or via a seed script). A concrete need
  for a setter is its own follow-up, not built speculatively here.

## Where it's documented for API consumers

`code_generator/templates/doc_index.md.jinja2` and `doc_entity.md.jinja2`
both note the optional expiry and the `401 API key expired.` rejection
alongside the existing API-key-authentication instructions.

## Testing

`lib/api-auth.test.ts` covers: no expiry set (never expires), a future
expiry (still valid), a past expiry (rejected), and the exact-now boundary
(rejected — the check is `<=`, not `<`), alongside the pre-existing
unknown-key and missing-header cases.
