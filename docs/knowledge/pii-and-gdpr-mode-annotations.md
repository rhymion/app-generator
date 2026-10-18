# `x-pii`, `x-retention` and `x-gdpr-mode`

Three schema annotations describe personal data. Only `x-pii` changes generated code. `x-gdpr-mode` and `x-retention` are
accepted in a schema (`x-gdpr-mode` is validated) and are read by nothing that produces output.

## At a glance

| | `x-pii` | `x-gdpr-mode` | `x-retention` |
|---|---|---|---|
| Placed on | A field | A model or a field | Declared as a field annotation |
| Values | `direct`, `indirect`, `sensitive`, `none` | `internal`, `consumer`, `both` (default `both`) | Free text |
| Checked by `validate.py` | Yes, the value must be one of the four | Yes, the value must be one of the three | No |
| Changes generated files | **Yes**, but only on the `user` entity | **No** | **No** |
| Read by | `build_anonymize_user_context()` in `code_generator/build_context.py` | `build_context.py` stores it in the template context as `model_gdpr_mode` and `gdpr_mode_fields`; no template reads either | Nothing |

Changing `x-gdpr-mode` to `internal`, `consumer` or removing it produces byte-identical generated output, both when set on
the `user` model and when set on every `user` field. `x-retention` has the same property.

## What `x-pii` does

Only the fields of the `user` entity are read. An `x-pii` annotation on any other entity is validated and then ignored.

When the `user` entity has at least one `x-pii` field, the generator writes `lib/compliance/anonymize_user.ts`, which
exports `anonymizeUser(userId)`. Without such a field the file is not generated. One database transaction does the following:

1. Deletes the user's OAuth `account` rows, `session` rows and `mfa_recovery_code` rows.
2. Updates the `user` row, setting each annotated field as follows:

| Annotated field | Value written |
|---|---|
| `email` (any `x-pii` value) | `<userId>@deleted.invalid`, which keeps the unique constraint satisfied |
| Any other `direct` field | `'[deleted]'` |
| A boolean field | `false` |
| Any other field | `null` |

3. Always sets `emailVerified` and `mfa_secret` to `null`, and sets `anonymized_at` and `invalidated_at` to the current time.
   These do not depend on annotations.

The user row is kept so that foreign keys stay valid. `audit_log` is not touched: it is append-only, its `metadata` holds no
personal data, and `actor_user_id` remains as a pseudonymous key (see `audit-log-append-only.md`).

Things that follow from this:

- **The classification does not choose between delete and replace.** `direct`, `indirect` and `sensitive` differ only in
  one case: a `direct` string field becomes `'[deleted]'` instead of `null`. Every annotated field is scrubbed.
- **`x-pii: none` still scrubs the field.** The generator skips only a field with no `x-pii` at all, so `none` is treated
  like `indirect` and `sensitive`.
- A field without `x-pii` is left unchanged, apart from the three columns in step 3.
- Nothing else reads `x-pii`: not the CSV export, the log output, the OpenAPI document or the screens.

## When `anonymizeUser()` runs

The `user` entity in the default schema declares `x-generate.invalidate` with `handler: anonymizeUser` and
`module: lib/compliance/anonymize_user`. The generated action `POST /api/user/[id]/actions/invalidate` calls that handler. It
requires the `delete` permission on `user`, and the list and edit screens show a confirmation that states the action is
irreversible.

So the scrub is an erasure, not a deactivation. The schema has no flag to disable a user and keep the data. The anonymized
row cannot sign in: its password is `null`, its sessions and OAuth accounts are deleted, and the mobile token route rejects
any user whose `anonymized_at` is set.

Any other entity that declares `invalidate` without a handler gets a stub that sets `invalidated_at` when the model has that
column and otherwise throws (see `invalidate-no-handler-write-once-stub.md`). It does not use `x-pii`.

## `x-gdpr-mode`

`x-gdpr-mode` is meant to classify whether a model or field concerns employee data (`internal`) or general consumer data
(`consumer`). In the current generator it is a validated label. A consumer schema that carries it generates the same code as
one that does not. The README makes the same statement.

## `x-retention`

`x-retention` has no validation and no reader. The text in `json_schema.yaml` is documentation of an intended use.

## Where the annotations are declared

`x-pii`, `x-retention` and `x-gdpr-mode` appear as documentation blocks at the top of `code_generator/json_schema.yaml`, and
`build_user_schema.py` treats them as generator meta-configuration rather than per-entity keys.
