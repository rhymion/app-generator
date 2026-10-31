# Cryptographic inventory and key management

This document lists every cryptographic key, algorithm and use in the generated app, and describes what happens to each when the root secret changes. It describes the code as it is today. Coverage rows: V11.1.1 and V11.1.2 in [security-asvs-coverage.md](security-asvs-coverage.md).

## Root secret: `AUTH_SECRET`

`AUTH_SECRET` is the only key material the app holds in configuration for its own cryptography. One value feeds several independent uses; each use either takes the value directly or derives its own key from it.

| Property | Current behavior |
|----------|------------------|
| Generation | `scripts/vercel-env.sh` and `scripts/gcp-env.sh` generate it once and persist it (`openssl rand -base64 32` on GCP). Later runs reuse the stored value. |
| Per-environment separation | Vercel Production reads `AUTH_SECRET`, Preview reads `AUTH_SECRET_STAGING`; Preview never receives the Production value. The test environment uses its own generated value. See [authentication.md](authentication.md). |
| Storage | Vercel project environment variable, or the `app-nextauth-secret` / `app-auth-secret` Secret Manager entries on GCP (`scripts/gcp-setup.sh`). Cloud Run reads the `latest` version at start-up (`scripts/gcp-deploy.sh`). |
| Minimum strength | Not enforced by the app. The deployment scripts generate 256 bits; a hand-set value is used as given. A missing value makes each use below fail closed (see the table). |
| Key identifier | None. A stored value does not record which `AUTH_SECRET` produced it, and only one value is accepted at a time. |

## Inventory

| Use | Algorithm | Key | Where | Stored or sent as |
|-----|-----------|-----|-------|-------------------|
| Web session cookie | Auth.js JWT strategy: encrypted JWE (Auth.js defaults) | `AUTH_SECRET`, handled by Auth.js | `auth.ts` | Session cookie. No session row is read per request. |
| Mobile access token | HS256 JWT (`jose`), 15-minute lifetime, claim `type: mobile_access` | `AUTH_SECRET` used directly as the HMAC key | `lib/mobile-auth.ts` | Bearer token, never stored |
| Mobile refresh token, stored form | HMAC-SHA256 | `AUTH_SECRET` | `hashRefreshToken()` in `lib/mobile-auth.ts` | Hex digest in `refresh_token_hash` (unique-indexed for lookup). The token itself is 32 random bytes and is never stored. |
| MFA TOTP secret at rest | AES-256-GCM, 12-byte random nonce | SHA-256 of `AUTH_SECRET` + `mfa-encryption-v1` | `lib/mfa/crypto.ts` | `v1:<nonce>:<tag>:<ciphertext>` (hex) in `user.mfa_secret` |
| Attachment original file name | AES-256-GCM, 12-byte random nonce | SHA-256 of `AUTH_SECRET` + `attachment-name-encryption-v1` | `lib/compliance/attachment_name_crypto.ts` | Same `v1:` wire format in `encrypted_original_name`; the visible name is a random UUID |
| Import confirmation token | HMAC-SHA256 over `actor:entity:expiry`, 5-minute lifetime | `AUTH_SECRET` | `lib/_import.ts` | base64url token returned to the caller; compared with `timingSafeEqual` |
| Payment cancel proof (only when the schema has a payable entity) | HMAC-SHA256 over `payment-cancel:<id>` | `AUTH_SECRET` | `cancelToken()` in `code_generator/templates/payment_checkout.ts.jinja2` | Query value inside the `cancel_url` given to Stripe; returns no token (fails closed) when `AUTH_SECRET` is unset |
| Password | bcrypt (`bcryptjs`), cost 10 | Per-hash salt, no server key | `lib/auth/password-check.ts`, `lib/auth/credential-confirmation.ts` | `user.password` |
| MFA recovery codes | bcrypt, cost 10 | Per-hash salt, no server key | `lib/mfa/recovery.ts` | Hash per code, single use |
| API key, stored form | SHA-256, unsalted, deterministic | None | `lib/api-key.ts` | `user.api_key_hash`. The key is `mk_` + 32 random bytes in hex and is shown once. See [api-key-hashing.md](api-key-hashing.md). |
| Secret comparison | SHA-256 of both sides, then `timingSafeEqual` | None | `lib/_secret_compare.ts` | Not stored |
| Idempotency request fingerprint | SHA-256 over the JSON body | None | `lib/idempotency.ts` | Hex digest next to the idempotency key |
| Audit-log digest chain | SHA-256, chained per closed period | None | `lib/audit-log-integrity/digest.ts`, `partition-export.ts` | `audit_log_digest` and write-once storage. See [audit-log-append-only.md](audit-log-append-only.md). |

Other secrets are configured separately and are not derived from `AUTH_SECRET`: `CRON_SECRET` (scheduled-task bearer), `STRIPE_WEBHOOK_SECRET`, OAuth client secrets, database and storage credentials. They are random values supplied by the platform or the operator; the app only compares or forwards them.

No asymmetric keys, key agreement or digital signatures are used by the app code. TLS keys and cipher suites belong to the platform.

## Lifecycle

- **Create.** The deployment scripts generate `AUTH_SECRET` on first run and store it per environment. Nothing in the app creates it.
- **Use.** Read from `process.env.AUTH_SECRET` on each call; derived keys are recomputed per call and are not cached or written anywhere.
- **Rotate.** There is no supported in-place rotation. The app accepts exactly one value, and stored ciphertext and digests carry no key identifier, so there is no way to read old values with the old key while writing new ones with the new key. Changing the value has these effects:

| Item | Effect of changing `AUTH_SECRET` |
|------|----------------------------------|
| Web sessions | All sessions stop verifying; every user signs in again. |
| Mobile access tokens | Stop verifying; clients refresh. |
| Mobile refresh tokens | The stored HMAC no longer matches, so every refresh fails and every mobile user signs in again. |
| Import and payment cancel tokens | Outstanding tokens stop verifying. Import tokens live 5 minutes; a payment cancel link already sent to a buyer stops working. |
| MFA secrets | Stored secrets can no longer be decrypted (the GCM tag check fails), so verification and enrollment throw for every enrolled user until each re-enrolls. The data is not re-encrypted. |
| Attachment names | Decryption fails; the generated getters log a warning and show the stored UUID name instead of the original name. The original names are not recoverable under the new secret. |
| Passwords, API keys, recovery codes, audit-log digests | Unaffected; they do not use `AUTH_SECRET`. |

  Rotate only after planning for the MFA re-enrollment and the loss of original attachment names, or leave the value unchanged. Re-encrypting stored data and keeping two accepted values during a rotation window are tracked in #1291.
- **Compromise.** Treat a leaked `AUTH_SECRET` as a leak of every use above: replace it in the environment's secret store and redeploy, accept the effects in the rotation table, and re-enroll MFA. A leaked `AUTH_SECRET` also lets its holder derive the MFA and attachment-name keys, so previously exposed database dumps become decryptable.
- **Destroy.** `scripts/vercel-teardown.sh` removes the Vercel variable. Deleting the stored secret on GCP is an operator action outside the scripts.

## Algorithm choices that are fixed in code

The bcrypt cost (10), the AES-256-GCM and HMAC-SHA256 choices and the `v1` wire-format prefix are constants in the files listed above. The `v1` prefix lets a reader reject an unknown format; it does not select a key. Configurable cost and key identifiers are tracked in #1291.

## Related

[authentication.md](authentication.md), [api-key-hashing.md](api-key-hashing.md), [audit-log-append-only.md](audit-log-append-only.md), [security-asvs-coverage.md](security-asvs-coverage.md).
