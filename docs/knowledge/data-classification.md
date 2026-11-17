# Data classification and the protection each class gets

This page defines the classes of data a generated application holds and states, for each class, the controls the
generated code applies today. It describes what the code does; where a class has no control for a property
(logs, exports, retention), the table says so. Field-level PII marks and the erasure function are in `x-pii.md`.

## Classes

| Class | What it is | Where it lives |
|-------|------------|----------------|
| Secret | Values that grant access: passwords, API keys, MFA secrets and recovery codes, session and refresh tokens, `AUTH_SECRET`, service credentials | `user.password`, `user.api_key_hash`, `user.mfa_secret`, `mfa_recovery_code`, `Session`, `Account`, environment variables |
| Personal data | Data about an identifiable person: the `user` columns marked `x-pii` (`direct`, `indirect`, `sensitive`), attachment file names, mobile device names | `user`, `attachment`, `mobile_session` |
| Business data | Records of the entities in the schema | the entity tables |
| Operational record | Audit trail and technical logs | `audit_log`, application log output |

`x-pii` covers only the `user` entity and only drives `anonymizeUser()`. It is the personal-data mark, not a
classification of the other classes; a property of any other entity carries no class in the generated code.

## Controls per class

| Class | At rest | In logs | In API responses and export | Erasure and retention |
|-------|---------|---------|-----------------------------|------------------------|
| Secret | Passwords: bcrypt hash. API keys: stored only as `api_key_hash` (`api-key-hashing.md`). MFA secret: AES-256-GCM (`lib/mfa/crypto.ts`). Service credentials: Secret Manager or sensitive Vercel variables, not files in the repository (`scripts/gcp-setup.sh`, `scripts/vercel-env.sh`) | Redacted by key name and by value pattern in `lib/logger.ts` (`lib/logger-redaction-rules.ts`: passwords, tokens, cookies, API keys, `Authorization` values, JWTs, email addresses) | Credentials are read from headers and sent in bodies, never in URLs; the entity field list decides which `user` columns are returned | `anonymizeUser()` clears `password`, `mfa_secret`, `Account`, `Session` and recovery codes; no automatic expiry beyond `api-key-expiry.md` |
| Personal data | Stored in clear text in the database, except attachment file names, which are AES-256-GCM encrypted (`lib/compliance/attachment_name_crypto.ts`) and stored under an opaque key | Email addresses in log strings are redacted by value pattern; other personal fields are not recognised; `x-pii` is not consulted | Decided by the entity field list; `x-pii` is not consulted (`x-pii.md`) | `anonymizeUser()` on request only; no schedule, and `x-retention` has no effect |
| Business data | Clear text in the database | Prisma slow-query log prints the SQL with parameters replaced by a count (`lib/prisma-slow-query.ts`) | Decided by the entity field list and the caller's permissions | Kept until deleted; no automatic retention |
| Operational record | `audit_log` is append-only (`audit-log-append-only.md`); optional write-once copies in GCS or S3 with a retention period | Not applicable | Not applicable to the append-only table; see `audit-log-append-only.md` | Per-object retention on the optional copies; partition export is a manual procedure |

Transport protection depends on the connection strings: the database client honours the `sslmode` carried in
`DATABASE_URL` (`lib/db-url.ts`), and the platform terminates TLS for browser traffic. The generated code does not
force TLS on a connection string that does not ask for it.

## Tracing the controls

| Requirement | Control | Where it is verified |
|-------------|---------|----------------------|
| Secrets never appear in logs | key and value redaction in the logger | `lib/logger.ts` and its tests |
| Query parameters never appear in logs | slow-query formatter | `lib/prisma-slow-query.test.ts` |
| Personal data can be erased on request | `anonymizeUser()` | `x-pii.md` lists the covered columns and the effects checked on a running application |
| File names do not leak personal data from a database dump | attachment name encryption and opaque storage keys | `attachment-storage.md` |
| The audit trail cannot be rewritten | append-only table and optional write-once copies | `audit-log-append-only.md` |

The ASVS rows for this area (V14.1.1, V14.1.2, V14.2.4) are in `security-asvs-coverage.md`.
