# Logging inventory

Which records the application writes, where they go, who can read them and how long they are kept. It complements [logging.md](logging.md) (how to call the logger and what it redacts) and [audit-log-append-only.md](audit-log-append-only.md) (the audit table's integrity design). It maps to OWASP ASVS 5.0 V16.1.1 and V16.2.3 in [security-asvs-coverage.md](security-asvs-coverage.md).

## Layers

| Layer | Written by | Destination | Contains |
|---|---|---|---|
| Audit log | `recordAuditEvent` in `lib/audit-log.ts` | Table `audit_log` in the application database; optionally copied to write-once object storage | Security-relevant events: who did what to which row |
| Application log | `logger` in `lib/logger.ts` | Process standard output and standard error | Operational events and failures, redacted |
| Slow-query log | `lib/prisma.ts`, formatted by `lib/prisma-slow-query.ts` | Same process output, through `logger.warn` | One line per query slower than a threshold, parameter values omitted |
| Platform request logs | The hosting platform | Decided by the platform | Request access records. Not produced or configured by this repository |

No other sink exists. Application code does not call `console.*` (enforced by lint, `check:generated` and a template test; see [logging.md](logging.md)), does not write log files and does not send records to a third-party service. A consumer that adds a sink must add it to this table.

## Events

### Audit log

Each row has `action`, `actor_user_id` (nullable, no foreign key so the row outlives the user), `target_table`, `target_id`, `metadata` (JSON) and `created_at` (UTC). The `action` is `<surface>:<verb>`. Actions written today:

| Action | When |
|---|---|
| `auth:signIn`, `auth:signOut` | Sign-in and sign-out |
| `auth:signIn.reject` | A sign-in refused, for example a domain outside the allow-list; the actor is empty when no user was resolved |
| `auth:createUser` | A user account is created |
| `auth:account.unlink` | A linked sign-in provider is removed |
| `auth:mfa.enabled`, `auth:mfa.disabled` | Multi-factor authentication changes |
| `auth:apikey.issue`, `auth:apikey.expiry` | An API key is issued or reaches its expiry |
| `<entity>:create`, `<entity>:update`, `<entity>:delete` | Entity writes, including `role` and `permission` |
| `self_only:admin_bypass` | An administrator reads rows that a self-only entity normally restricts to their owner |

Emails and free text are kept out of `metadata`; the table is append-only, so a row cannot be redacted later (`lib/auth/audit-no-pii.test.ts`). The table has no source address, user agent or request id; that gap is tracked in the coverage table (V16.2.1).

A failed audit write outside a transaction is logged and does not fail the request. Inside a transaction the error is rethrown and the transaction rolls back.

### Application log

Messages carry a bracketed tag naming the source, for example `[audit_log:write_failed]`, `[rate-limit:fail_open]`, `[auth:signIn:reject]`, `[auth:createUser]`, `[register]`, `[anonymizeUser]`, `[_notifier:write_failed]`. They record failures that were swallowed so the request could continue (audit write, rate-limit store, notification write, search index creation), rejected sign-ins, account creation, API errors and which database adapter was chosen at start-up. Severities are `debug`, `info`, `warn` and `error`. Format varies: some records are single-line JSON, others a message plus an object. Normalizing it is tracked in the coverage table (V16.2.4).

### Slow-query log

Enabled when `PRISMA_SLOW_QUERY_LOG=true`, and by default outside production unless it is `false`. A query at or above `PRISMA_SLOW_QUERY_THRESHOLD_MS` (default 50) produces `[prisma slow-query <ms>ms] <sql> -- params=[<n> redacted]`.

## Access

| Record | Who can read it |
|---|---|
| `audit_log` rows | A caller with `read` permission on `audit_log`, through the REST route `/api/audit_log` and the generated screen. There is no write route: rows are created only by `recordAuditEvent` |
| Application and slow-query log | Whoever can read the process output of the deployment: the hosting platform's log viewer or drain, or the terminal in local development |
| Archived audit objects | The principal that holds read permission on the configured bucket |

## Retention

- **`audit_log` table:** no deletion or expiry runs. Rows stay until a partition is exported and retired as described in [audit-log-append-only.md](audit-log-append-only.md).
- **Object-storage copy:** when `x-generator.audit-log-storage.enabled` is set, each object is retained for `AUDIT_LOG_GCS_RETENTION_DAYS` or `AUDIT_LOG_S3_RETENTION_DAYS` days; see the same document for modes and permissions.
- **Application and slow-query log:** the application keeps nothing. Retention is whatever the hosting platform or log drain applies.
