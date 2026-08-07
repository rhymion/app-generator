# Writable Prisma Defaults on the "New" Page (cmd_594)

## The problem it solves

Any field with a Prisma `@default(...)` that json_schema's `required:` array excludes while the
field stays DB non-nullable (`derive_raw_entity`: `not pf.nullable and not pf.has_default` is the
only path into `required:` — so a default of any kind always keeps a field out of it) used to lose
that default on the "new" page whenever a user left the field untouched.

The clearest symptom: a `DateTime @default(now())` column, e.g. `inventory_transaction.occurred_at`
in a downstream consumer. `build_context.py:_default_value()` seeded the "new" page's initial React
state as `null` for every datetime field, unconditionally. If the user never touched the field:

1. `FormUpsert.tsx`'s submit handler always sends the FormData key —
   `formData.set('occurred_at', occurredAt?.toISOString() || '');` — so an untouched `null` state
   submits `''`, not an omitted key.
2. `occurred_at` is DB non-nullable (see above), so `_build_form_data_gets()`'s non-nullable branch
   runs: `const occurredAt = new Date(occurredAtStr);` — `new Date('')` is `Invalid Date`.
3. `service.ts`'s `create()` call passes `occurred_at: occurredAt` unconditionally — Prisma rejects
   the Invalid Date and the create throws.

Three other field classes had the same root bug without the crash:

- **number** with a nonzero literal default (e.g. `quantity Int @default(5)`): seeded `null` →
  submitted `''` → `Number('')` is `0` → silently overwrites the default with `0`.
- **boolean** with `@default(true)`: `_default_value()` was hardcoded to return `'false'`,
  ignoring `defn.get('default')` entirely — an untouched field always submitted explicit `false`.
- **plain (non-enum) string** with a literal default (e.g. `tenant_id String @default("default")`):
  seeded `''` unconditionally, ignoring the schema default.

`nativeEnum`/plain-string-enum fields were already correct (cmd_446 pilot: `_default_value()` reads
`defn.get('default')`, falling back to the first enum member).

## Why `'default' in defn` alone doesn't catch `now()`

`schema_deriver.py` deliberately **omits** the `default:` json-schema key for Prisma *dynamic*
defaults (`now()`, `cuid()`, `uuid()`, `autoincrement()` — anything `_parse_default()` recognizes as
ending in `()`), on the reasoning that a dynamic default has no static value to show in a UI
(cmd_574). That means a field like `occurred_at` never carries a `default:` key at all — checking
for one misses exactly the field class this bug is about.

The fix instead detects "this field has *some* Prisma default, static or dynamic" via the same
signature `derive_raw_entity` itself uses to exclude a field from `required:`: excluded from
`required:` **and** still DB non-nullable (`type` has no `'null'` member). That combination can only
happen when `pf.has_default` is true — nullable fields are always excluded from `required:`
regardless of a default, so the "not required, not nullable" pair isolates the has-default set.
A field with a static default also satisfies `'default' in defn`, so the check is
`'default' in defn or (not is_req and not is_null)` — the second disjunct is what recovers the
dynamic-default case the first one can't see.

## The fix

`build_context.py:_default_value()` (top-level `page_new.tsx` initial state):

- **datetime**: seeds `'new Date()'` (a writable "now", editable before submit) when the
  has-default signature above is true; unchanged (`'null'`) otherwise (a genuinely optional
  datetime column with no default should stay blank).
- **number**: seeds the schema's literal `default:` value (respecting int vs float) when present;
  unchanged otherwise.
- **boolean**: `str(defn.get('default', False)).lower()` — was hardcoded `'false'`.
- **plain string**: seeds the literal `default:` value when present; unchanged (`"''"`) otherwise.

`generators.py:_new_prop_val()` (DataGrid child new-row seeding) already read `defn.get('default')`
correctly for boolean and number — only its plain-string / plain-string-enum branches needed the
same treatment `_default_value()`'s enum branches already had.

A related trap found while fixing number fields: the generated `NumberField` JSX used
`defaultValue={src.p || undefined}`. Once `_default_value()` can seed a real `0` default, `0 ||
undefined` evaluates to `undefined` — the falsy `0` gets swallowed and the input renders blank
despite `src.p` correctly being `0`. Changed to `?? undefined` (nullish coalescing), which only
falls through on `null`/`undefined`.

## What was deliberately left alone

- `generators.py:_new_prop_val()`'s datetime branch always seeds `dayjs().toISOString()` for *any*
  datetime field, default or not — including a purely optional field with no Prisma default at
  all. That's the opposite failure mode (over-eager "now" injection instead of a dropped default)
  and isn't this bug; left unchanged to keep the fix narrowly scoped.
- Whether `now()`-backed timestamps should instead omit the FormData key entirely when untouched
  (so Prisma's own `@default(now())` fires at the actual write time, rather than seeding "the
  moment the form was opened") is a genuine, unresolved business-semantics question for fields like
  `occurred_at` — the chosen fix (seed a writable "now", matching what the DataGrid-child path
  already did) stops the crash and matches "a writable default value" literally, but a "send
  nothing, let the DB default apply at write time" alternative may be more correct for audit-style
  timestamps specifically. Flagged for a follow-up decision rather than resolved unilaterally here.

## Verification

`test:e2e:cy:api` cannot exercise this bug class at all — API specs call `cy.request()` directly
against REST routes, never the browser form's default-seeding JS. Verification instead required
before/after Cypress **UI** spec comparisons (`cy.visit()` + real form interaction) in isolated
worktrees of two downstream consumers, with the fix applied as a standalone patch on top of each
consumer's current pinned `app-generator` submodule commit (not a submodule bump to `develop` HEAD,
which would have pulled in unrelated commits and contaminated the comparison):

- **proj_g**: `inventory_transaction.cy.ts`'s `2.1 creates with minimal data (required fields
  only)` flips FAIL→PASS (the exact target crash); zero regressions in the same spec pair; a
  broader 46-spec desktop+mobile sweep found no `PrismaClientValidationError` anywhere and no
  regression among its pre-existing (unrelated) failures.
- **proj_c**: the full 86-spec / 781-test desktop+mobile UI suite is an exact match before/after —
  same 741 passing / 40 failing on both sides, spec-for-spec and test-for-test, proving the change
  doesn't regress a broad, actively-developed consumer.
