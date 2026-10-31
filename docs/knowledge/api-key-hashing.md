# API key hashing

## What this is

An account's API key is stored only as its SHA-256 hash. The database, the in-process authentication cache, REST
responses, exports, imports, the audit log and the logs never hold the key itself. The key is shown once, when its owner
issues it, and cannot be shown again. (Issue #1157.)

| Column on `user` | Meaning |
|---|---|
| `api_key_hash` | Lowercase-hex SHA-256 of the key's UTF-8 bytes; `null` while no key is set. Indexed. |
| `api_key_issued_at` | When the current key was issued; `null` while no key is set, and for a key issued before the hash existed. |
| `api_key_expires_at` | Optional expiry, unchanged: see [api-key-expiry.md](api-key-expiry.md). |

Both new columns exist only in `prisma/schema.prisma`, like `mfa_secret`. They are not properties of `user` or `setting`
in `code_generator/json_schema.yaml`, so no generated form, REST body, CSV import or export, search or OpenAPI schema can
read or set them. `user.api_key` no longer exists.

## Why a plain SHA-256

A key is `mk_` followed by 256 random bits (`generateApiKey()` in `lib/api-key.ts`). It cannot be guessed or brute-forced
offline, so a salted or deliberately slow password hash would add cost without adding protection. A deterministic digest
also lets `authenticateApiKey()` find the row with one indexed equality lookup (`where: { api_key_hash }`); a salted hash
would force a scan of every row. An HMAC with a server secret would protect a leaked table further but ties every key to
that secret, which then has to be rotated with them; it was not chosen.

The lookup compares hashes inside the database index, not the key. The key itself is never compared in application code.

## Where the hash is computed

`hashApiKey()` in `lib/api-key.ts` is the only application-side implementation. `authenticateApiKey()` hashes the
presented `X-API-Key` / `Authorization: Bearer` value, then uses the hash as the lookup value, as the authentication
cache key and as the rate-limit bucket name for failed attempts. The cache therefore holds no usable credential.

## Issuing a key

The account settings page has an API key section (`components/setting/ApiKeyPanel.tsx`, mounted on `setting` through
`x-custom-components`). It shows whether a key is set, when it was issued and when it expires. Pressing the button calls
`issueApiKey()` (`lib/setting/api-key-actions.ts`), a Server Action that acts on the session user only. It

1. generates the key,
2. stores its hash, the issue time and the expiry chosen by the owner (the site default when none is given),
3. drops the previous hash from the authentication cache of the current server process,
4. writes the audit event `auth:apikey.issue` (without the key),
5. returns the key in its response, which the panel shows once.

Leaving the page discards the key. Issuing a new key stops the previous one from working at once in the current process;
another process stops accepting it when its cache entry ages out (at most 5 minutes in production, see
[multi-tenancy-and-permissions.md](multi-tenancy-and-permissions.md)). The expiry of the new key is chosen when issuing ([api-key-expiry.md](api-key-expiry.md)).

An edit form cannot store a key: the property is not part of any form, so there is no way to bring a chosen value in.

## Seeds and tests

- `scripts/seed-baseline.ts` stores the hash of the admin key. Under `NODE_ENV=production` it prints the key once, and only
  when this run created the account ([seed-baseline-credential-hardening.md](seed-baseline-credential-hardening.md)).
- `anonymizeUser()` sets `api_key_hash` and `api_key_issued_at` to `null` (always; no `x-pii` annotation is needed).
- Cypress support code and the generated test helpers store `api_key_hash: hashApiKey(key)`. The generated `createKeyedUser()`
  in `cypress/support/db-helpers.ts` returns the user with the plain key as `api_key` so a spec can send it as a header.
- The leak canary gate ([leak-canary-test.md](leak-canary-test.md)) seeds a marker into `user.api_key_hash`.

| What is proved | Test |
|---|---|
| The hash is SHA-256 hex of the UTF-8 bytes, and PostgreSQL's `sha256()` gives the same value | `lib/api-key.test.ts`, `cypress/e2e/api/api_key_storage.cy.ts` |
| Authentication looks up by the hash and never by the key | `lib/api-auth.test.ts` |
| The key authenticates; the stored hash and an altered key do not | `cypress/e2e/api/api_key_storage.cy.ts` |
| No plaintext column; no key or hash in the setting, user, list, export or search responses or the audit log | `cypress/e2e/api/api_key_storage.cy.ts` |
| A request body or CSV import cannot set the key, the hash or the issue time | `cypress/e2e/api/api_key_storage.cy.ts` |
| Issuing stores only the hash, returns the key once, keeps the expiry | `lib/setting/api-key-actions.test.ts` |
| The page shows the key once, the new key works, the old key is rejected, a later visit shows no key | `components/setting/ApiKeyPanel.test.tsx`, `cypress/e2e/auth/settings_api_key_issue.cy.ts` |
| The hash column is scrubbed on erasure | `code_generator/tests/test_anonymize_user_related_records.py` |
| The hash column is a leak canary | `code_generator/tests/test_leak_canary.py` |

## Consumer migration

The generator ships no migrations. A consumer adds `prisma/sql/api_key_hash_migration.sql` to a Prisma migration of its own
at deployment time. The statements add the two columns, set `api_key_hash` from each stored key with PostgreSQL's built-in
`sha256()` (no extension), drop `user.api_key` and its index, and create the hash index, in one transaction. Existing keys
are not rotated: the same key authenticates after the migration. The issue time of an existing key stays `null`.

Steps for a consumer:

1. Bump the generator submodule to a commit that contains this change.
2. Remove the `api_key` property from `user`, remove `api_key` from the `x-generate.fields` of `setting`, and delete any
   `components/setting/api_key.tsx` of your own. The default schema's `setting` entity mounts `ApiKeyPanel` through
   `x-custom-components`; a schema that declares its own `x-custom-components` on `setting` must list it.
3. Run `npm run prj:sync` and `npm run generate-code`; run `prisma migrate dev --create-only`, then replace the generated
   `migration.sql` body with the contents of `prisma/sql/api_key_hash_migration.sql` (the diff Prisma proposes drops
   `api_key`, which would lose the keys).
4. Apply it to a copy of the database first: the keys that authenticated before must authenticate after. Then deploy with
   `prisma migrate deploy`. Applying it to a deployed database is the operator's step.
5. Any code of your own that reads or writes `user.api_key`, or reads it from a Prisma `select`, must use `api_key_hash`
   (and `hashApiKey()` from `lib/api-key.ts` to turn a key into the value to store or look up).
6. Tell users that a key can no longer be displayed: they keep using the key they already have, and issue a new one from the
   account settings page if they lost it.

## Static analysis note

CodeQL's `js/insufficient-password-hash` flags `createHash('sha256')` over a value it classifies as a password. The value
here is a 256-bit random API key, not a user-chosen password, so a slow hash adds nothing (see "Why a plain SHA-256").
`rejectUnknownApiKey()` already used the same call for the rate-limit bucket name before this change.
