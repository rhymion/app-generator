# `x-self-only`: Permission-Independent Access Invariant (Stage 1)

## The problem it solves

The generator's `creator` permission scope lets an admin grant "Creator role can read/update/delete
their own rows" — but that scope is only active when `general.read` (etc.) is *false*. In
`getters.ts`'s `build{Entity}AccessWhere()`:

```typescript
if (!perms.general.read) {
  if (perms.creator?.read && userId) or.push({ creator_id: userId });
  // ...
}
```

Grant `general.read: true` to any role and this entire block is skipped — every user with that
role sees every row, Creator scope or not. The same `!general.read` (or equivalent
`general.update`/`general.delete`) escape exists in `search_helpers.ts`, `actions.ts`, and
`api_bulk_route.ts`.

For most entities that's fine — `creator` is meant to be one configurable option among several.
But some entities need a stronger guarantee: "only the record's creator can ever access it" as a
fixed property of the *entity*, not a permission setting an admin could accidentally widen.
Personal, per-user data (private notes, per-user preferences, health-adjacent records) is the
primary case. `x-self-only` declares that invariant at the schema level and enforces it
unconditionally, independent of any permission grant.

## When to use `x-self-only` vs. the `creator` permission scope

| | `creator` permission scope | `x-self-only` |
|---|---|---|
| Strength | A configurable option — an admin can widen visibility by granting `general.read`/`update`/`delete` | A fixed invariant — no permission grant can widen it |
| Use when | Ownership matters, but support/admin roles legitimately need broader visibility by design | Ownership is absolute; broader visibility (if ever needed) must be an explicit, audited exception |
| Declared | Per-role, at runtime (`permission` table rows) | Per-entity, at schema-author time (`x-self-only` in `json_schema.yaml`) |

## Schema declaration

```yaml
personal_note:
  x-generate: { list: true, view: true, new: true, edit: true, delete: true, api: true }
  x-self-only: true            # shorthand — equivalent to { admin_bypass: false }
```

or, to allow an audited privileged-role bypass:

```yaml
personal_note:
  x-generate: { ... }
  x-self-only:
    admin_bypass: true
```

**The shorthand's `admin_bypass` always defaults to `false`.** The loose/permissive direction is
never the implicit default — a schema reader should be able to tell who can see a self-only
entity's rows without checking anywhere else. `admin_bypass: true` must be written out explicitly.

## What "unconditional" means in the generated code

Every affected code path drops the `general.read`/`update`/`delete` escape entirely for
`x-self-only` entities and checks `creator_id === actorId` as the *sole* gate:

- `getters.ts` — `build{Entity}AccessWhere()` (list/search/export), `get{Entity}Detail()`
  (single-row read; the query filters `id` **and** `creator_id` in one round trip, unifying
  "not found" with "not permitted" per the org-isolation 404 convention).
- `search_helpers.ts` — the cross-entity full-text search union. No `admin_bypass` path here —
  see "Admin bypass scope" below.
- `actions.ts` / `api_bulk_route.ts` / `api_detail_route.ts` (single-item PUT/DELETE) — the
  `general.delete`/`update` escape is removed; ownership is the only check, and a non-owner's row
  reads as `404 Not Found`, not `403 Forbidden`.
- `service.ts` — `update{Entity}()` independently re-verifies `creator_id` against the actual row
  before writing, so a caller that reaches the service layer through any path other than the
  routes above (present or future) still can't write another user's row. This mirrors the
  org-isolation save-path lesson: a getter-layer check alone is not enough; the write path itself
  must also check.
- CSV import/export — `creator_id` is forced into `import_unimportable_columns` (a CSV header
  naming it is rejected outright, never silently accepted); import can only create/update the
  caller's own rows (natural-key lookups are `creator_id`-scoped, so a collision with another
  user's row reads as "no match" → attempted create, not an update of someone else's data); export
  is `creator_id`-filtered and includes `creator_id` itself as a read-only diagnostic column.
- FK candidates — `search{Entity}Options()` is the same function used for the entity's own
  autocomplete and for another entity's FK-candidate lookup, so it's covered by the same fix
  automatically. A caller with zero owned rows gets `{ options: [], permissionDenied: undefined }`
  (graceful degradation, no throw) rather than an empty-vs-denied ambiguity.

## Admin bypass (`admin_bypass: true`)

A designated privileged role (currently: `Administrator`, matching the existing `audit_log`
special-case in `lib/authz.ts`) can read across every user's rows — but **the bypass and the
audit write are inseparable**. `lib/self_only.ts`'s `trySelfOnlyAdminBypass(entity, actorUserId)`:

1. Checks the actor holds the `Administrator` role. Not privileged → bypass denied, no audit
   write attempted.
2. Attempts to write an audit row (`self_only:admin_bypass`, via `recordAuditEvent` with a forced
   non-swallowing failure path). Write succeeds → bypass granted. **Write fails → bypass denied**,
   falling back to the ordinary `creator_id`-restricted view.

There is no code path that grants the bypass without a corresponding audit row — "record can't be
written" is not a special case that lets the bypass through anyway. This is deliberately
fail-closed: an admin who hits a transient audit-write failure sees *less* than usual (their own
rows only), never silently gets *more*.

### Admin bypass scope

The bypass only applies to **reads** (`build{Entity}AccessWhere`, `get{Entity}Detail`, and by
extension `search{Entity}Options`/FK candidates, since they share the same access-where builder).
It does **not** apply to:

- Delete (`actions.ts`, `api_bulk_route.ts` DELETE, `api_detail_route.ts` DELETE) — ownership is
  the sole gate, unconditionally, with no bypass. Support investigating a report is a read
  operation; deleting someone else's data is a much higher-consequence action this mechanism
  doesn't grant.
- Update (`api_bulk_route.ts` PUT, `api_detail_route.ts` PUT, `service.ts`'s save-path check) —
  same reasoning.
- Cross-entity full-text search (`search_helpers.ts`) — implementing an audited bypass inside a
  raw-SQL, multi-entity `UNION` query is a nontrivial addition on its own; global search for a
  self-only entity currently stays strict (owner-only) even when `admin_bypass: true` is set. If a
  real need for admin-bypass-in-search emerges, treat it as a follow-up, not an assumed side
  effect of the flag.
- Audit log viewing — unaffected either way: `audit_log` access is already an Administrator-only
  capability with no self-service view for ordinary users (see `getModelPermissions`'s
  `model === 'audit_log'` special case in `lib/authz.ts`), so there is no existing "self-filtered
  by default" surface for `x-self-only` entities to further restrict. The `self_only:admin_bypass`
  events themselves land in the same Administrator-only `audit_log` view as any other audit event.

### Admin bypass and the coarse permission gate

`trySelfOnlyAdminBypass()` only controls the *row-level* filter inside each entity's own getters.
Every generated API route also runs a separate, coarser check first —
`requireApiPermission()` / `getModelPermissions()` in `lib/authz.ts` — which looks up an explicit
`permission` table row for `(role, entity)`. For most entities that row exists because the entity
is enumerated somewhere a permission grant makes sense (e.g. the generator's own
`cypress/support/db-helpers.ts` `ALL_ENTITIES` test fixture, or a real admin's permission-management
screen). A self-service `x-self-only` entity — most starkly `setting`, which nobody would ever
"grant a permission" for since every user manages only their own — has **no such row for anyone**,
so the coarse gate denies before the row-level bypass ever runs.

The fix is a build-time-generated allowlist (`lib/self_only_admin_bypass_entities.ts`,
`SELF_ONLY_ADMIN_BYPASS_ENTITIES`, populated in `generate.py` from every entity where
`is_self_only && self_only_admin_bypass`) that `getModelPermissions()` consults **only in its
existing "no permission rows found" branch** — mirroring the pre-existing `audit_log`
special-case, and just as read-only. Consulting it only in the no-rows branch matters: an entity
like `personal_note` legitimately *can* have a real, explicitly granted `permission` row (it's
still enumerated in `ALL_ENTITIES` for testing), and that real grant must win over the generic
admin shortcut, not be silently overridden by it.

## Applying `x-self-only` to a non-generator-owned entity: `setting`

`setting` (`allOf: [$ref: user, ...]`) is a proxy view over the acting user's own `user` row, not
an independent table — the Stage 1 design initially assumed every self-only entity would have its
own `creator_id` column to filter on, but here the row *is* a `user` row, and `user` has no
`creator_id` at all. The resolution: `user.creator_id` is made to always equal `user.id` (every
user row is its own creator) — see the next section — so `setting`'s ownership filter is still a
plain `creator_id = actorId` check, no second code path required.

Because `setting` and `user` share the same underlying Prisma model, the `x-self-only` annotation
and every template branch it triggers must stay scoped to `setting`'s own getters/actions/routes
(`lib/setting/*`, `app/api/setting/*`) — never to `lib/user/*`. Applying it to the shared `user`
model would make every other entity's FK reference to `user` (mention author display, comment
creator names, approver pickers, etc.) invisible too. `x-self-only`'s entity-name keying (not
Prisma-model-name keying) already routes correctly through `build_context()`'s `parent` vs `model`
distinction; there is no special-case code required for this — it fell out of the existing
generator architecture, but is easy to get wrong when adding a new proxy-view self-only entity by
hand, so watch for it.

## `user.creator_id === user.id`: a structural invariant, not a habit

Since `setting` is a proxied view of `user` and uses `creator_id` as its self-only filter (see
above), that filter only means "is this my own account" if `creator_id` equals `id` on every real
user row. All four user-creation call sites (`lib/auth/create-user.ts`,
`app/api/auth/register/route.ts`, `scripts/seed-tenant.ts`, `scripts/seed.ts`) generate the id up
front and pass it as both `id` and `creator_id`.

A database `CHECK (creator_id = id)` constraint was considered and rejected: two existing test
fixtures (`cypress.config.ts`'s `db:createUserWithName` task and
`cypress/support/audit_log/helper.ts`) deliberately create `user` rows with a *different*
`creator_id`, simulating the pre-existing, unrelated `Creator`-permission-scope CSV-import feature
on the `user` entity — a blanket constraint would break both. Neither fixture stamps a usable
password, so neither can ever be the authenticated actor behind a real self-only access check.

Instead, `lib/auth/creator-id-self-reference-guard.test.ts` is a static structural gate: it scans
`app/`, `lib/`, and `scripts/` for every `prisma.user.create`/`.upsert()` call site and asserts
`creator_id` is assigned the same identifier as `id`, with the two test-fixture files above as a
named, reasoned allowlist. Any new production code path that creates a `user` row without
self-referencing `creator_id` fails this test — the guarantee is enforced at build/test time
rather than by a DB constraint that can't distinguish the two fixture call sites from the four
real ones.

## Validation (`validate.py`)

Two schema-time checks reject a mis-declared `x-self-only` entity before generation:

- The underlying Prisma model must actually have a `creator_id` column
  (`validate_self_only_creator_id_columns()` — checked against the real `schema.prisma` text,
  *not* the JSON schema's `properties`, since `creator_id` is Prisma-schema boilerplate that is
  never listed as a JSON-schema property for any entity, self-only or not).
- `creator_id` must never appear in `x-import-key` (checked in `validate_schema()`) — it must
  always be session-stamped, never user-supplied.

## Integration with org isolation

An entity with both `organization_id` and `x-self-only` gets **both** filters, composed with
**AND** (never OR): `organization_id IN (associated orgs)` and `creator_id = userId` are pushed as
independent `AND` clauses. A pure B2C entity (no `organization_id`) is unaffected either way.

## Stage 2 (not implemented — future work)

This is app-layer enforcement only. Row-Level Security (Postgres `FORCE ROW LEVEL SECURITY`) would
add DB-layer defense-in-depth, but **the current dev/test DB connection is a superuser, and
superusers bypass RLS even with `FORCE ROW LEVEL SECURITY`** — confirmed by direct measurement
during design (see the design investigation doc). Stage 2 requires provisioning a dedicated
non-superuser application DB role first; that's an operations task, not a generator change, and is
out of scope here. The app layer (Stage 1) is the primary protection; treat RLS as optional
additional depth once the DB role exists.

## Sample entities

- `setting` — the acting user's own account settings — is the proxy-view case: a real,
  production-shipped entity applying `x-self-only: { admin_bypass: true }` to a `user`-backed view
  rather than its own table. See "Applying `x-self-only` to a non-generator-owned entity" above
  for what's different about it. Its own-table regression coverage
  (`cypress/e2e/api/self_only_setting_access_control.cy.ts`) is the primary behavioral proof this
  repo's own CI carries for the mechanism today.
- `personal_note` — a private per-user note with its own independent table and `creator_id`
  column, `admin_bypass: true` — was this repo's original minimal worked example and doubled as
  its own-table regression-test fixture. Removed from the default `json_schema.yaml`/
  `schema.prisma` (cmd_575): it existed only to give a hand-written cypress spec
  (`self_only_access_control.cy.ts`, since deleted from this repo) something to exercise, not
  because it's a feature every consumer should inherit by default. Both the entity and its spec
  now live in `app-template`'s `prj/` (the one consumer that actually wants a personal-note
  feature), where they keep proving the mechanism end-to-end for that project. One coverage
  narrowing is a known, explicitly accepted trade-off of this move: no entity in this repo's own
  default schema combines `x-self-only` with `list: true` any more (`setting` is `list: false`),
  so the self-only **list-query** filter's behavior (unlike its detail/edit/admin_bypass behavior,
  still proven via `setting`) is no longer runtime-proven by this repo's own CI — only
  type-checked, via `setting`'s always-generated (but unreachable, since `setting` has no list
  page) `getSettingPage`/`buildSettingAccessWhere`. See cmd_575's completion report for the full
  reasoning.
