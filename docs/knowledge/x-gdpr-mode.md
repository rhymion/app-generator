# `x-gdpr-mode`

`x-gdpr-mode` labels a model or a field as concerning employee data (`internal`), general consumer data (`consumer`) or
both (`both`, the default). It is validated and carried into the template context, and **no generated file depends on it**.
For the annotation that does change generated code, see [x-pii.md](x-pii.md).

## Where it is accepted

| | |
|---|---|
| Placed on | A model, or a field of a model |
| Values | `internal`, `consumer`, `both` |
| Default when absent | `both` |
| Validation | `validate.py` rejects any other value, at model level and field level |
| Template context | `build_context.py` sets `model_gdpr_mode` and `gdpr_mode_fields`; no template reads either |

## Effect on generated output

None. Generating the default schema with `x-gdpr-mode` set to `internal` on the `user` model and every `user` field,
with `consumer` in the same places, and with the key removed, produces byte-identical files. The generated
`lib/compliance/anonymize_user.ts` is the same in all three cases.

A consumer that declares `x-gdpr-mode: both` on its `user` entity therefore generates the same code as one that omits it.

## How it differs from `x-pii`

| | `x-pii` | `x-gdpr-mode` |
|---|---|---|
| Answers | Which personal-data fields are scrubbed when a user is erased | Which kind of data subject a model or field belongs to |
| Changes generated code | Yes, on the `user` entity | No |
| Decides what happens to a column | Yes: the column is set to a placeholder value or `null` | No |
| Entities that use it | `user` only | None |

Erasure scrubs every `x-pii` field, whatever `x-gdpr-mode` says. There is no mode in which a field is kept or removed
based on `internal` or `consumer`.

## `x-retention`

| | |
|---|---|
| Place | A top-level documentation block in `code_generator/json_schema.yaml` (repeated in the test fixtures and in a consumer's `prj/` copy); no field or model in the default schema uses it |
| Type | Free text, for example `account_lifetime` or `30_days_after_deletion` |
| Validation | None: `validate.py` does not mention it |
| Effect | None: no generator code and no template reads it, so a value changes no generated file |
