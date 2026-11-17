# API key expiry

## What this is

Stage 2 of `ai-agent-integration-design.md` (Issue #717): an optional
expiry on the account's API key (stored as `user.api_key_hash`, see
`api-key-hashing.md`) — every account, human or agent, has the same key columns. No new principal type: an agent is an ordinary `user`
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
- **Cache-safe.** `authenticateApiKey()` caches `SHA-256(key) → {userId,
  expiresAt}` per-process (production builds only) with a 5-minute TTL. The
  expiry comparison happens against the *current* time on every lookup,
  cache hit or not — so a key that expires partway through its cache TTL is
  still caught on the very next request, rather than staying valid until
  the cache entry ages out.
- **The owner sets the expiry, and only the owner.** The account settings page
  (`components/setting/ApiKeyPanel.tsx`) offers the expiry when issuing a key and
  for the current key afterwards. Both go through Server Actions in
  `lib/setting/api-key-actions.ts` that act on the session user only and take no
  user id: `issueApiKey({ expiresAt })` and `setApiKeyExpiry(expiresAt)`. No
  administrator override and no maximum exists. `user.api_key_expires_at` is not a
  schema property, so no REST route or edit form can write it.
- **Choices.** `expiresAt` is an ISO date-time strictly in the future, or `null` for a key
  that never expires. A past or malformed value is rejected on the server
  (`parseRequestedApiKeyExpiry()` in `lib/api-key-expiry.ts`); `setApiKeyExpiry`
  also rejects an account that has no key. Changing the expiry does not change
  the key.
- **Default for a new key.** When `issueApiKey()` is called without `expiresAt`, and as the
  initial value on the issue form, the key expires `siteConfig.auth.apiKeyDefaultExpiryDays`
  days after issue (`lib/site-config.ts`). The value `null` makes new keys never
  expire by default. If the property is removed, the generator default of 90 days
  applies. The default applies only to keys issued after it is set; a key that
  already exists keeps its expiry, and a `null` expiry stays "never expires"
  (including keys migrated from the plaintext column).
- **Shown on the settings page.** The key section shows the current expiry, "Never expires."
  or, once it has passed, "Expired …".
- **Other servers.** Changing the expiry drops the key's authentication-cache entry
  in the process that handled the change; other processes pick it up when
  their entry ages out (at most 5 minutes in production). Issuing a key sets the new expiry
  together with the new hash.

## Where it's documented for API consumers

`code_generator/templates/doc_index.md.jinja2` and `doc_entity.md.jinja2`
both note the optional expiry and the `401 API key expired.` rejection
alongside the existing API-key-authentication instructions.

## Testing

`lib/api-key-expiry.test.ts` covers the default (site setting, fallback, none) and the validation of a chosen
expiry. `lib/setting/api-key-actions.test.ts` covers issuing with the default, a chosen date and none, rejection of a past
or malformed date, and changing and clearing the expiry for the session user only. `components/setting/ApiKeyPanel.test.tsx`
covers the form, and `cypress/e2e/auth/settings_api_key_issue.cy.ts` covers the whole flow against the database.
`lib/api-auth.test.ts` covers: no expiry set (never expires), a future
expiry (still valid), a past expiry (rejected), and the exact-now boundary
(rejected — the check is `<=`, not `<`), alongside the pre-existing
unknown-key and missing-header cases.
