# Input validation rules, cross-field consistency and limits

This document lists where a generated app validates input, which rules the generator applies to every entity, where an application adds its own cross-field rules, and which numeric limits exist. It describes the code as it is today. Coverage rows: V2.1.1, V2.1.2, V2.1.3, V2.3.2 and V15.3.6 in [security-asvs-coverage.md](security-asvs-coverage.md).

## Where validation runs

| Layer | What it checks | Where |
|-------|----------------|-------|
| Browser form | Required, decimal, date/time, plus the schema keywords `minLength`, `maxLength`, `minimum`, `maximum`, `pattern` | `components/{entity}/form_validation.ts` and the generated form. The server enforces the same keywords too (rules 2 and 4 below), so the form is a convenience, not the guarantee. |
| Server, every write path | The generated rules below, then the hand-written rules | `lib/{entity}/service_validation.ts` |
| Database | Column types, unique indexes and foreign keys from the Prisma schema | `prisma/schema.prisma` |

The server layer runs for REST routes and Server Actions alike, inside the same transaction as the write. A failure throws `AppError` with code `VALIDATION` (field-level input error, carries the field key and a reason of `missing` or `invalid`) or `CONFLICT`, which the routes map to an error response without writing anything.

The server checks every supplied value against its field's JSON schema rules (Issue #1271): the JSON type always; `enum`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `pattern` and `format` (`uri`, `email`) only where the schema declares them. No schema key is involved. Unknown keys in a REST body are dropped by the route (it reads only the entity's declared fields), not rejected.

## Rules applied to every entity (generated)

`validateOnAdd` and `validateOnUpdate` call the same function, in this order:

| Order | Rule | Failure |
|-------|------|---------|
| 1 | Required fields are present. A value counts as missing when it is `null`, `undefined`, a blank string, `NaN` or an invalid date. | `VALIDATION`, reason `missing` |
| 2 | Every supplied value matches its field's runtime rule (`lib/_field_rules.ts`, Issue #1271): a string, integer, number or boolean as the schema types it; and, where declared, a value in `enum`, within `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum`, at least `minLength` code points, matching `pattern` (not checked on foreign-key columns, whose reachability check decides) and of `format` `uri` (an http(s) URL or a root-relative path, as `lib/_safe_url.ts` accepts) or `email`. A missing or blank value is left to rule 1; decimal and date/time columns are left to rules 3 and 5. | `VALIDATION`, reason `invalid` |
| 3 | Decimal fields match `^-?\d+(\.\d+)?$` (a blank value is skipped). | `VALIDATION`, reason `invalid` |
| 4 | String fields are at most their maximum length: the schema's `maxLength`, or 65535 when none is declared (Issue #1273). Counted in Unicode code points, as JSON Schema counts. Every writable string column is checked; decimal-backed strings have rule 3 instead. There is no opt-out. | `VALIDATION`, reason `invalid` |
| 5 | Date, time and date-time fields hold a valid value of their declared format. | `VALIDATION`, reason `invalid` |
| 6 | One-to-one relations: a required one is present; a given id exists in the target table; no other record already links it. | `VALIDATION` (missing, does not exist) or `CONFLICT` (already linked) |
| 7 | Direct attachment fields refer to an attachment that is unlinked or already belongs to this record (entities with a direct attachment field). | `VALIDATION` |
| 8 | Exclusive parent columns: exactly one parent column is set, taking the stored value when an update omits it (entities with exclusive parents). | `VALIDATION` |
| 9 | Write-locked values: a field declared with `x-write-locked-values` cannot be set to a locked value unless the record already holds it. | `VALIDATION`, reason `invalid` |
| 10 | State transitions: an update may only move a state field along a declared transition, and a create may only start in a declared initial state (entities with a state machine). | `VALIDATION`, reason `invalid` (`no such transition`, or `transition not permitted by x-approval`) |
| 11 | The hand-written rules in `lib/{entity}/service_validation_custom.ts` (`validateCustomRules`). | whatever it throws; a `VALIDATION` error without a reason is tagged `invalid` |

Unique-index violations raised by the database are mapped to `CONFLICT`. A value longer than its column's `@db.VarChar(n)` (allowed by a larger `maxLength`, which is intended: `maxLength` is the security limit, `n` follows the product spec) is refused by the database (`P2000`) and mapped to a `VALIDATION` error, reason `invalid`, saying the value is too long and naming the field when PostgreSQL reports the column (Issue #1393, `lib/_prisma_value_too_long.ts`).

CSV import refuses a cell longer than the same maximum length before the row reaches the service (row error `INVALID_VALUE`), so a dry run reports it too. Rows of an inline-edited child grid written through the parent's nested create/update are not checked by rules 2 and 4 (they carry no `validateOnAdd`/`validateOnUpdate` of their own; see the comment in `service.ts.jinja2`); their child entity's own REST route and Server Action are checked.

## Cross-field consistency

The generator knows no cross-field rule beyond steps 6 to 10 above. Any other relation between fields (an end date after a start date, a total equal to the sum of its lines, a quantity within stock) is an application rule and belongs in `validateCustomRules`.

`validateCustomRules(tx, data, currentId, prevRow, actorId)` is a write-once stub the generator creates for every entity and never overwrites:

- `data` holds the submitted fields; `currentId` is `null` on create; `prevRow` is the stored row on update and `null` on create, so a rule can compare old and new values.
- It runs inside the write transaction, so a rule can query other tables and a thrown error rolls the write back.
- It must throw `AppError('VALIDATION', message, fieldKey)` to reject; returning means accept.
- `validateOnDelete` has the same shape for deletes (`service_validation_delete_stub.ts.jinja2`).

Details and examples: [same-entity-validation-socket.md](same-entity-validation-socket.md), [pre-edit-row-handoff-to-custom-validation.md](pre-edit-row-handoff-to-custom-validation.md), [actor-id-handoff-to-custom-validation.md](actor-id-handoff-to-custom-validation.md).

## Limits

Every limit in the generated app is global (the same for every user and every entity). There is **no** per-user or per-organization record count, storage quota or other business limit, and no schema key to declare one. A business limit such as "at most N open orders per customer" is an application rule: implement it in `validateCustomRules` and add a test for it (see "Business limits" below).

| Limit | Value | Configuration | Where |
|-------|-------|---------------|-------|
| REST list page size | 200 maximum; a larger `pageSize` is refused | none | `lib/_pagination.ts` |
| Search page size | 100 maximum (clamped) | none | `search_route.ts.jinja2`, `search_actions.ts.jinja2` |
| CSV import rows | 5000 | `IMPORT_MAX_ROWS` | `api_import_route.ts.jinja2` |
| CSV import size | 10 MiB | `IMPORT_MAX_BYTES` | `api_import_route.ts.jinja2` |
| Upload size | 10 MiB | `UPLOAD_MAX_BYTES` | `lib/_upload_validation.ts` |
| String field length | the field's `maxLength`, else 65535 characters (code points) | `maxLength` in `json_schema.yaml`; default `DEFAULT_STRING_MAX_LENGTH` in `code_generator/helpers/string_limits.py` | `lib/{entity}/service_validation.ts`, `api_import_route.ts.jinja2` |
| Comment text | 10000 characters | none | `api_comments_route.ts.jinja2`, `api_comment_item_route.ts.jinja2` |
| Attachments per request | 100 | none | `api_attachments_route.ts.jinja2` |
| Ids per options lookup | 200; context 4096 characters | none | `api_options_route.ts.jinja2` |
| Mention search text | 200 characters | none | `mention_users_api_route.ts.jinja2` |
| Rate limits (per user id or IP) | `api:read` 300/min, `api:write` 60/min, `upload:file` 30/10 min, sign-in, MFA, registration and API-key buckets | `api:read`, `api:write` and `upload:file` have environment overrides (`RATE_LIMIT_API_READ_LIMIT`, `RATE_LIMIT_API_WRITE_LIMIT`, `RATE_LIMIT_UPLOAD_LIMIT`) | `lib/rate-limit/index.ts`; see [api-idempotency-and-rate-limiting.md](api-idempotency-and-rate-limiting.md) |
| Idempotency key retention | one day | none | `lib/idempotency.ts` |

### Business limits are application-specific (Issue #1270)

The generator ships no business limit, by design (ASVS V2.1.3, V2.3.2): what to limit (records per user, per organization, per day, a total amount, a number of open items) and the numbers depend on the product, so they are neither defaulted nor configured through a schema key. An application that has such a rule writes it down in its own documentation and enforces it here:

- **Where:** the entity's `validateCustomRules` in `lib/{entity}/service_validation_custom.ts` (write-once, never overwritten). It runs inside the write transaction on every write path (REST, bulk, Server Action, CSV import), after the generated rules. `currentId === null` means create; `actorId` is the caller; `prevRow` is the stored row on update.
- **How it refuses:** throw `AppError('VALIDATION', message, fieldKey)`; the write is rolled back and the caller gets 422. Use `CONFLICT` when the refusal depends on the current state of other rows rather than on the submitted value.
- **Concurrency:** a count followed by an insert can let two simultaneous requests both pass. Where an exact limit matters, serialize the check (for example a row lock on the owning record with `SELECT ... FOR UPDATE` through a tagged `$queryRaw`, listed in `code_generator/check_generated_allowlist.yaml`, see [raw-sql-policy.md](raw-sql-policy.md)) or back it with a database constraint.

Worked example, "a user may have at most 20 open orders":

```ts
// lib/order/service_validation_custom.ts
import { AppError } from '@/lib/_errors';

const MAX_OPEN_ORDERS_PER_USER = 20;

export async function validateCustomRules(tx, data, currentId, prevRow, actorId) {
  const opensOne = data.status === 'open' && (currentId === null || prevRow?.status !== 'open');
  if (!opensOne) return;
  const open = await tx.order.count({ where: { creator_id: actorId, status: 'open' } });
  if (open >= MAX_OPEN_ORDERS_PER_USER) {
    throw new AppError('VALIDATION', `At most ${MAX_OPEN_ORDERS_PER_USER} open orders per user`, 'status');
  }
}
```

Test pattern (both are needed: the unit test pins the rule, the API test proves it is wired into the write path):

- Unit test: call `validateCustomRules` with a transaction stub whose `order.count` resolves to 19 (accepted) and 20 (rejects with `VALIDATION` on `status`), for a create and for an update that reopens an order; an update that keeps an order open is not counted again.
- API test: create 20 open orders as one user, then a 21st; expect `422` with `field: 'status'`, re-read the list and assert that the count is still 20; a second user can still create one.

## Prototype pollution

Coverage row: V15.3.6. There is no lint rule for it; the protection is how request data is handled, and this is the policy for new code:

- A request body is destructured into the explicit, schema-defined fields of the entity (the generated routes and Server Actions do this); fields that are not declared are dropped, and read-only fields are rejected.
- Request data is never deep-merged into another object (no `merge`, `defaultsDeep` or `Object.assign` of a whole body into a shared object) and never used as a property name on an object that code later reads (`obj[userKey]`). Where a lookup by a caller-supplied key is needed, use a `Map` or an object built with `Object.fromEntries`, which defines own properties, as `lib/logger.ts` does for redaction.
- Keys that name the prototype (`__proto__`, `constructor`, `prototype`) have no meaning to the generated code; a body containing them is reduced to the declared fields like any other unknown key.

`deepmerge-ts` is a dependency but no source file imports it; do not use it on request data.

## Testing a rule

A rule in `validateCustomRules` is tested like any other server code: a unit test calls the function with a transaction stub, and an API spec posts a violating body and expects a validation error and no stored record.
