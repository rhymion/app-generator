# `x-pii`: field classification and the `anonymizeUser()` erasure

`x-pii` marks a property of the `user` entity as personal data. The generator reads the marks of the `user` entity at
generation time and writes one function, `anonymizeUser()`, that scrubs exactly those columns. Nothing else in the
generated application reads `x-pii`.

## Where the annotation is read

| Place | What `x-pii` does there |
|---|---|
| `user` entity properties | Each annotated property becomes one column in the scrub of `anonymizeUser()`. |
| Properties of any other entity | Validated (see below) and then ignored. They change nothing in the generated output. |
| Export, import, list and detail views, REST responses, OpenAPI, log output | Not consulted. What these show is decided by the entity's field list, not by `x-pii`. |
| Columns without the annotation | Left untouched by the scrub. |

The top-level `x-pii:` block of `code_generator/json_schema.yaml` is documentation of the allowed values. The text there
that says the annotation is "required on all user-facing fields" is not enforced: the validator does not require it on
any property.

## Values

The validator (`code_generator/validate.py`) accepts these values on any property of any entity and rejects every other
value with a generation error.

| Value | Meaning | Scrub value written by `anonymizeUser()` |
|---|---|---|
| `direct` | Identifies a person on its own (name, email). | the string `'[deleted]'`; for a column named `email`, the placeholder email (below) |
| `sensitive` | Special-category or authentication data (password, API key, MFA flag). | `null`; `false` for a boolean column; placeholder email for a column named `email` |
| `indirect` | Identifies a person only in combination with other data (avatar). | `null`; `false` for a boolean column; placeholder email for a column named `email` |
| `none` | Documented as "no PII". | Treated like the other values: the column is scrubbed with `null` (`false` for a boolean). See [Known limitations](#known-limitations). |

The scrub value depends on the value of `x-pii` and on the column type only as listed. It does not look at whether the
column accepts `null`.

The default schema annotates these `user` columns:

| Column | `x-pii` | After `anonymizeUser()` |
|---|---|---|
| `name` | `direct` | `[deleted]` |
| `email` | `direct` | `<user id>@deleted.invalid` |
| `password` | `sensitive` | `null` |
| `api_key` | `sensitive` | `null` |
| `mfa_enabled` | `sensitive` | `false` |
| `image_id` | `indirect` | `null` |

## What `anonymizeUser()` does

The generator writes `lib/compliance/anonymize_user.ts` only when the `user` entity has at least one `x-pii` property;
otherwise the file is not generated. The function takes a user id and, in one database transaction:

1. deletes the user's `Account` rows (OAuth tokens), `Session` rows and `mfa_recovery_code` rows;
2. updates the `user` row: every `x-pii` column as in the table above, plus `emailVerified` and `mfa_secret` set to
   `null`, and `anonymized_at` and `invalidated_at` set to the current time;
3. erases the records that belong to the erased person: `mobile_session.device_name` is set to `null` (the session rows
   stay), the person's `notification` rows and `idempotency_key` rows (cached responses of their requests) are deleted,
   and, when `image_id` is an `x-pii` column, the avatar `attachment` row is deleted;
4. checks that no `Account` row is left, and rolls the whole transaction back if one is.

After the commit the function removes the stored avatar file (local `public/uploads`, Vercel Blob, or the Google Cloud
Storage bucket when `x-cloud` is `gcp`). A failure there does not undo the erasure: the result has `success: true` and
the message in `errors`.

A repeated call is allowed. It keeps the first `anonymized_at` and `invalidated_at` (and returns the first time as
`anonymizedAt`), and it still removes related records an earlier call left behind. A call for a user id that does not
exist fails with `success: false`.

The function does not delete other content the person wrote or uploaded, such as comments, reactions or attachments on
other records; those rows are not personal data of the `user` row and stay with their creator id.

The user row itself is kept so that foreign keys (creator, updater, audit log actor) stay valid. The scrub cannot be
undone. The function returns `{ success, userId, anonymizedAt, errors? }`; on any database error the transaction is
rolled back and `success` is `false`.

The function does not write to `audit_log`. The audit log is append-only and holds no personal data, so there is
nothing in it to redact; `actor_user_id` stays as a pseudonymous key.

Columns of the `user` row without `x-pii` are left as they are. In the default schema this includes
`api_key_expires_at`, `email_notifications_enabled`, `tenant_id`, `mfa_token_version`, the creator and updater ids and
the role assignments.

## What triggers it

Nothing runs it automatically. There is no schedule and no retention job. It runs when one of these calls it:

- `POST /api/user/{id}/actions/invalidate`, generated because the default `user` entity declares
  `x-generate.invalidate` with handler `anonymizeUser` from `lib/compliance/anonymize_user`. The caller needs the `delete`
  permission on `user`, resolved against the record being invalidated: a `Creator` or `Assignee` grant applies only to
  records the caller created or is assigned to, and an organization-scoped entity is limited to the caller's organizations
  (the same rule as `DELETE /api/user/{id}`).
- The `invalidateUser` server action behind the invalidate button of the user list page, which needs the same permission.
- Any code that imports and calls `anonymizeUser(userId)` directly.

A `user` entity that declares no `x-generate.invalidate` with this handler still gets the function, but no route or
button calls it.

## Effects in the generated application

Checked on a generated and started application with the default schema:

| Area | Behavior after erasure |
|---|---|
| `user` row | Columns as in the tables above; `anonymized_at` and `invalidated_at` set. |
| Detail view and `GET /api/user/{id}` | The same fields as before, with `name` showing `[deleted]`. `x-pii` does not choose the fields. |
| Export (`GET /api/user/export`) | The same columns as before (`name`, `image_id` in the default schema); the name shows `[deleted]`. |
| Sign-in with email and password, web or mobile | Rejected: `password` is `null`. |
| Sign-in with the old API key | Rejected: `api_key` is `null`. |
| Avatar, mobile device names, notifications | The avatar `attachment` row and file are gone, `device_name` is `null`, the notifications are deleted. |
| `audit_log` | No row is written by the erasure and no existing row is changed. Sign-in events carry the provider only. |
| Mentions in comments (`x-mention`) | A mention is stored as `@[user_id:<id>]` and decoded to the user's current `name` when shown, so it shows `[deleted]` after erasure. Only the id-to-name decoding is covered by unit tests; the end-to-end display is not exercised in the default schema, which has no commentable entity. |
| `x-retention` | No effect. The annotation is documented in the top-level schema block, is not validated and is not read by any generator code or generated file. |

## Known limitations

- Sessions and tokens issued before the erasure keep working: #1061.
- `x-pii: none` is scrubbed like the other values, a scrub value that does not fit the column type or nullability makes
  the whole erasure roll back, and `invalidateUser` does not report that failure: #1060.
