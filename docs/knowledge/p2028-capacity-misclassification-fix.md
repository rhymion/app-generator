# P2028 misclassified as VALIDATION (422) in generated write paths

## Behavior

Generated `add{Entity}`/`update{Entity}` functions (`service.ts.jinja2`)
route Prisma's `P2028` ("Unable to start a transaction in the given
time.") to `AppError('CAPACITY', ...)`, which `lib/api-auth.ts`'s
`APP_ERROR_STATUS_MAP` resolves to HTTP `409`.

`P2028` is a transaction/connection-pool timeout: `addEntity`/
`updateEntity` wrap their write in `prisma.$transaction(async (tx) =>
...)`, and under pool contention the transaction can fail to acquire a
connection within Prisma's `maxWait` before the callback ever runs. The
request body may be entirely valid — the failure is a server-side
capacity condition, not a client input error.

## Why this needed a fix

Before this fix, the catch block in both functions special-cased only
`P2002` (unique constraint violation → `CONFLICT`/409) and let every
other `PrismaClientKnownRequestError` — `P2028` included — fall through
to a generic `AppError('VALIDATION', 'One or more fields have an invalid
value')` (422). `CAPACITY` (`'CAPACITY' // pool / inventory exhausted'`)
already existed in `lib/_errors.ts` and was already mapped to 409 in
`APP_ERROR_STATUS_MAP`, but nothing in the generated service layer ever
threw it — the mapping was defined but unreachable.

This was found while investigating elevated 422 rates observed in load
testing under high concurrency. Two properties distinguish this class of
422 from a real validation failure and made it possible to attribute
conclusively:

- A real validation failure (`REQUIRED_FIELDS`/`DECIMAL_FIELDS`/custom
  rules, `service_validation.ts`) always carries a `field`/`reason` key
  (`AppError('VALIDATION', ..., field.key, 'missing')`). Every 422
  produced by this catch-all carries neither — response body is exactly
  `{"error":"One or more fields have an invalid value","code":"VALIDATION"}`.
- Prisma's own raw error log (`prisma:error`, independent of the app's
  `AppError` conversion) in the same run window showed the same-order
  count of `P2028` entries as the unexplained 422s, with no other error
  code present.

Reproduced directly: under `PRISMA_POOL_MAX=1` and high concurrency
against a real generated entity's create/update route, before this fix
the catch-all's field-less 422 fires under contention; after the fix the
same contention produces `409 {"error":"Unable to start a transaction in
the given time","code":"CAPACITY"}` instead.

## Scope: other `PrismaClientKnownRequestError` codes

Cross-referenced the actual codes the pinned runtime (`@prisma/client`,
version in this repo's `package.json`) can emit (grepped directly from
the bundled client rather than relying on general Prisma documentation,
which can describe codes from other versions no longer applicable here —
e.g. `P2024`, often cited as "pool timeout" in older Prisma docs, is not
emitted by this pinned client at all). Of the codes reachable through
this catch-all:

- Legitimately input-shaped, correctly remain under `VALIDATION`/422:
  `P2000` (value too long), `P2003` (FK constraint), `P2007` (invalid
  input value), `P2011` (null constraint), `P2014` (relation violation),
  `P2017`/`P2018` (nested-connect shape errors), `P2020` (value out of
  range).
- Also look misclassified, same shape as `P2028`, but deliberately left
  out of this fix to keep it narrowly scoped — tracked as a follow-up:
  `P2025` (not-found/race condition, arguably closer to a 404 than a
  422), `P2034` (`TransactionWriteConflict` — reachable here via
  `Prisma.TransactionIsolationLevel.Serializable`, used for
  item-reservation entities), `P2037` (`TooManyConnections` — a direct
  pool-exhaustion signal, conceptually identical to `P2028`).

## Relationship to the list-pagination P2028 fix

Distinct from `performance-improvements.md` §5's list-pagination fix.
That fix *eliminates* P2028 for `findMany`+`count` reads by dropping an
unnecessary `$transaction` wrapper entirely. This fix does not remove
`addEntity`/`updateEntity`'s `$transaction` — a multi-model write
genuinely needs atomicity — it only ensures that when pool contention
does produce `P2028` there, the caller gets an accurate `409 CAPACITY`
instead of a misleading `422 VALIDATION`.

## Regression coverage

`code_generator/tests/test_p2028_capacity_misclassification_fix.py`
renders the fixture schema through the real template pipeline and
asserts: the `P2028` → `CAPACITY` branch is present in both
`addEntity`/`updateEntity`'s catch blocks; it is ordered before the
generic `VALIDATION` catch-all (and after the existing `P2002` branch);
and a deviation-injection check confirms the generic catch-all still
fires for a genuinely unhandled code (the fix doesn't accidentally
swallow other cases).
