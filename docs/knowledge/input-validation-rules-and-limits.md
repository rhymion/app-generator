# Input validation rules, cross-field consistency and limits

This document lists where a generated app validates input, which rules the generator applies to every entity, where an application adds its own cross-field rules, and which numeric limits exist. It describes the code as it is today. Coverage rows: V2.1.1, V2.1.2, V2.1.3, V2.3.2 and V15.3.6 in [security-asvs-coverage.md](security-asvs-coverage.md).

## Where validation runs

| Layer | What it checks | Where |
|-------|----------------|-------|
| Browser form | Required, decimal, date/time, plus the schema keywords `minLength`, `maxLength`, `minimum`, `maximum`, `pattern` | `components/{entity}/form_validation.ts` and the generated form. These keywords are enforced **only** here (see [schema-yaml-configuration.md](schema-yaml-configuration.md), "Validation constraints"). |
| Server, every write path | The generated rules below, then the hand-written rules | `lib/{entity}/service_validation.ts` |
| Database | Column types, unique indexes and foreign keys from the Prisma schema | `prisma/schema.prisma` |

The server layer runs for REST routes and Server Actions alike, inside the same transaction as the write. A failure throws `AppError` with code `VALIDATION` (field-level input error, carries the field key and a reason of `missing` or `invalid`) or `CONFLICT`, which the routes map to an error response without writing anything.

Do not rely on a schema `maxLength`, `minimum`, `maximum` or `pattern` for a server-side guarantee: a request that bypasses the form is not checked against them. Enforce such a limit in the hand-written rules below.

## Rules applied to every entity (generated)

`validateOnAdd` and `validateOnUpdate` call the same function, in this order:

| Order | Rule | Failure |
|-------|------|---------|
| 1 | Required fields are present. A value counts as missing when it is `null`, `undefined`, a blank string, `NaN` or an invalid date. | `VALIDATION`, reason `missing` |
| 2 | Decimal fields match `^-?\d+(\.\d+)?$` (a blank value is skipped). | `VALIDATION`, reason `invalid` |
| 3 | Date, time and date-time fields hold a valid value of their declared format. | `VALIDATION`, reason `invalid` |
| 4 | One-to-one relations: a required one is present; a given id exists in the target table; no other record already links it. | `VALIDATION` (missing, does not exist) or `CONFLICT` (already linked) |
| 5 | Direct attachment fields refer to an attachment that is unlinked or already belongs to this record (entities with a direct attachment field). | `VALIDATION` |
| 6 | Exclusive parent columns: exactly one parent column is set, taking the stored value when an update omits it (entities with exclusive parents). | `VALIDATION` |
| 7 | Write-locked values: a field declared with `x-write-locked-values` cannot be set to a locked value unless the record already holds it. | `VALIDATION`, reason `invalid` |
| 8 | State transitions: an update may only move a state field along a declared transition, and a create may only start in a declared initial state (entities with a state machine). | `VALIDATION`, reason `invalid` (`no such transition`, or `transition not permitted by x-approval`) |
| 9 | The hand-written rules in `lib/{entity}/service_validation_custom.ts` (`validateCustomRules`). | whatever it throws; a `VALIDATION` error without a reason is tagged `invalid` |

Unique-index violations raised by the database are mapped to `CONFLICT`.

## Cross-field consistency

The generator knows no cross-field rule beyond steps 4 to 8 above. Any other relation between fields (an end date after a start date, a total equal to the sum of its lines, a quantity within stock) is an application rule and belongs in `validateCustomRules`.

`validateCustomRules(tx, data, currentId, prevRow, actorId)` is a write-once stub the generator creates for every entity and never overwrites:

- `data` holds the submitted fields; `currentId` is `null` on create; `prevRow` is the stored row on update and `null` on create, so a rule can compare old and new values.
- It runs inside the write transaction, so a rule can query other tables and a thrown error rolls the write back.
- It must throw `AppError('VALIDATION', message, fieldKey)` to reject; returning means accept.
- `validateOnDelete` has the same shape for deletes (`service_validation_delete_stub.ts.jinja2`).

Details and examples: [same-entity-validation-socket.md](same-entity-validation-socket.md), [pre-edit-row-handoff-to-custom-validation.md](pre-edit-row-handoff-to-custom-validation.md), [actor-id-handoff-to-custom-validation.md](actor-id-handoff-to-custom-validation.md).

## Limits

Every limit in the generated app is global (the same for every user and every entity). There is **no** per-user or per-organization record count, storage quota or other business limit, and no schema key to declare one. A business limit such as "at most N open orders per customer" is an application rule: implement it in `validateCustomRules` and add a test for it.

| Limit | Value | Configuration | Where |
|-------|-------|---------------|-------|
| REST list page size | 200 maximum; a larger `pageSize` is refused | none | `lib/_pagination.ts` |
| Search page size | 100 maximum (clamped) | none | `search_route.ts.jinja2`, `search_actions.ts.jinja2` |
| CSV import rows | 5000 | `IMPORT_MAX_ROWS` | `api_import_route.ts.jinja2` |
| CSV import size | 10 MiB | `IMPORT_MAX_BYTES` | `api_import_route.ts.jinja2` |
| Upload size | 10 MiB | `UPLOAD_MAX_BYTES` | `lib/_upload_validation.ts` |
| Comment text | 10000 characters | none | `api_comments_route.ts.jinja2`, `api_comment_item_route.ts.jinja2` |
| Attachments per request | 100 | none | `api_attachments_route.ts.jinja2` |
| Ids per options lookup | 200; context 4096 characters | none | `api_options_route.ts.jinja2` |
| Mention search text | 200 characters | none | `mention_users_api_route.ts.jinja2` |
| Rate limits (per user id or IP) | `api:read` 300/min, `api:write` 60/min, `upload:file` 30/10 min, sign-in, MFA, registration and API-key buckets | `api:read`, `api:write` and `upload:file` have environment overrides (`RATE_LIMIT_API_READ_LIMIT`, `RATE_LIMIT_API_WRITE_LIMIT`, `RATE_LIMIT_UPLOAD_LIMIT`) | `lib/rate-limit/index.ts`; see [api-idempotency-and-rate-limiting.md](api-idempotency-and-rate-limiting.md) |
| Idempotency key retention | one day | none | `lib/idempotency.ts` |

## Prototype pollution

Coverage row: V15.3.6. There is no lint rule for it; the protection is how request data is handled, and this is the policy for new code:

- A request body is destructured into the explicit, schema-defined fields of the entity (the generated routes and Server Actions do this); fields that are not declared are dropped, and read-only fields are rejected.
- Request data is never deep-merged into another object (no `merge`, `defaultsDeep` or `Object.assign` of a whole body into a shared object) and never used as a property name on an object that code later reads (`obj[userKey]`). Where a lookup by a caller-supplied key is needed, use a `Map` or an object built with `Object.fromEntries`, which defines own properties, as `lib/logger.ts` does for redaction.
- Keys that name the prototype (`__proto__`, `constructor`, `prototype`) have no meaning to the generated code; a body containing them is reduced to the declared fields like any other unknown key.

`deepmerge-ts` is a dependency but no source file imports it; do not use it on request data.

## Testing a rule

A rule in `validateCustomRules` is tested like any other server code: a unit test calls the function with a transaction stub, and an API spec posts a violating body and expects a validation error and no stored record.
