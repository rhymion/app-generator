# Optional `organization` Relationships on Org-Scoped Entities

## The premise

Every entity with an `organization` relationship (`should_filter_by_org`) was, until now, only
ever exercised with that relationship declared **required** — `organization` in the entity's
`required` list, `organization_id String` (non-nullable) in `schema.prisma`. Two independent
gaps surfaced the moment a schema author declared it **optional** instead (removing `organization`
from `required`, `organization_id String?`), each discovered empirically by making the change
against a real testbed schema and running the full generated test suite — not found by reasoning
about the schema shape alone.

## Gap 1: the CREATE-path org-membership check doesn't type-check

`service.ts.jinja2`'s `add{Parent}()` rendered an unconditional org-membership check:

```typescript
const _createOrgIds = (await getAssociatedOrganizations(actorId)).map((o) => o.id);
if (!_createOrgIds.includes(organizationId)) {
  throw new ApiError(404, 'Not found');
}
```

`Array.includes()` requires its argument to match the array's element type (`string`). That's
fine when `organizationId` is a required, non-nullable parameter — but the moment a schema author
makes `organization` optional, `organizationId`'s TypeScript type becomes `string | null`, and
`_createOrgIds.includes(organizationId)` is a real `next build` compile error, not a lint nit.

`update{Parent}()`'s equivalent check was already guarded with `if (organizationId) { ... }`
(pre-existing, presumably because an UPDATE's client-submitted payload could already legitimately
omit an unchanged field). The fix mirrors that same guard onto CREATE. For a required-org entity
the guard is a harmless no-op — TypeScript guarantees a truthy string there, so the guarded and
unguarded forms are behaviorally identical; the guard only *changes* behavior when the type is
actually nullable.

## Gap 2: NULL-organization rows are invisible to every org-scoped read/write path

`organization_id: { in: associatedOrganizationIds }` — used throughout the generated read/write
scope filters — never matches `NULL` in SQL. Once a row's `organization_id` can genuinely be
`NULL`, that row becomes invisible to **every** org-scoped actor, including its own creator: list
returns it as zero rows, detail 404s, even the immediate "verify by GET" step right after a
successful create 404s. This is not a theoretical edge case — it's the *default* outcome, since
nothing else in the schema forces a client to supply an organization once it's optional, and nothing
in the generated test fixtures did either. Making an entity's `organization` optional and adding it
to the standard test-permission infrastructure (`x-generate.test: true`) immediately turned the
majority of that entity's basic generated CRUD tests red.

The fix: a new `org_relationship_optional` context flag (`should_filter_by_org` is true **and**
the `organization` relationship itself is not in the model's `required` list) gates an
`OR: [{ organization_id: { in: [...] } }, { organization_id: null }]` branch in place of the plain
`IN` filter, at every point the **current model's own** organization scoping is checked:

| Template | What it gates |
|---|---|
| `getters.ts.jinja2` | List access-where builder (`build{Parent}AccessWhere`), detail getter |
| `actions.ts.jinja2` | Delete server action's existence/ownership check |
| `actions.ts.jinja2` | Upsert server action's pre-permission existence check (`generators.py`'s `_actor_and_existing_block()`, cmd_634 — see below) |
| `api_detail_route.ts.jinja2` | PUT and DELETE REST routes' existence check |
| `api_import_route.ts.jinja2` | CSV import's match-by-natural-key lookup |
| `search_helpers.ts.jinja2` | Cross-entity global search's per-entity access clause, both the direct site and its `parent.`-qualified `no_page_children` sibling (cmd_640, see below) |

A required-org model gets the plain `IN` filter unchanged — `organization_id` is never `NULL`
there, so the `OR`-null branch would be dead code, and the flag is `false` specifically to avoid
generating it.

### cmd_640: closing the search_helpers.ts.jinja2 gap

`search_helpers.ts.jinja2` builds its own independent Prisma.sql fragments (a raw cross-entity
`UNION` query, not the `and.push({...})` object-filter shape the other templates above use), so
it needed its own `org_relationship_optional` wiring in `generate.py`'s search-entity context
builder (mirroring `build_context.py`'s computation via
`helpers.schema_helpers.get_parent_relationships`) rather than reusing the existing plumbing.
Confirmed against a real Postgres DB via proj_c's `parent1` entity (org made optional by
cmd_611/612): `api/parent1.cy.ts`'s N10 spec (global search coverage) failed with `expected false
to equal true` before this fix, passed after. Unlike the object-filter templates, the
`associatedOrgIds.length > 0` branch here is kept post-fix — but only as a SQL-construction
necessity (`Prisma.join` over an empty array cannot form a valid `IN (...)` list), not as an
access guard; both branches admit `IS NULL` rows unconditionally.

### cmd_634: closing the upsert existence-check gap (and a guard that looked right but wasn't)

`actions.ts.jinja2`'s upsert server action ran its own pre-permission existence check
(`generators.py`'s `_actor_and_existing_block()`) before the shared `update{Parent}()` service
function even fires — same `organization_id: { in: _orgIds } }` gap as every site above, on a real
schema (proj_c's `parent1`, org made optional by cmd_611/612): a record created without an
organization threw `Error('Not found')` on every future update attempt, even from its own
creator. Fixed by wiring the same `org_relationship_optional` OR-null branch into this check.

**A guard that looked prudent, but wasn't the established shape**: an earlier pass at this fix
added `_orgIds.length > 0 &&` in front of the OR-null branch, reasoning that an actor with zero
org memberships shouldn't get blanket access to every NULL-org row via this check. That guard was
reverted after re-checking the codebase's own precedent — every other `org_relationship_optional`
site in the table above (except `search_helpers.ts.jinja2`, which needs it for a different,
SQL-construction reason — see cmd_640 above) uses the unconditional OR-null with no such guard.
Adding a length-guard at exactly one call site, while every sibling existence check for the same
model stays unconditional, doesn't close a real hole — the identical pre-existing gap (a
zero-org-membership `general.update` actor reaching an org-less record) is already reachable
through `api_detail_route.ts.jinja2`'s PUT route (tracked separately, not this cmd's scope) — it
just creates a new, undocumented inconsistency between otherwise-identical checks on the same
model. **Lesson: when extending this pattern to a new call site, match the already-shipped shape
at the sibling sites first; do not add a defensive-looking guard without checking whether every
other site already made — and stuck with — the opposite choice.**

**Still not touched (follow-up candidates, not yet fixed)**:

- The CSV-import FK-*lookup-target* org filters (`lookup_entity_filter_by_org` — whether a
  *referenced* entity like `role` is itself org-scoped — see
  [`csv-import-dotted-fk-org-filter.md`](csv-import-dotted-fk-org-filter.md)) do not admit a
  `NULL`-organization row on the lookup **target** side either: `api_import_route.ts.jinja2`
  lines rendering `organization_id: { in: _importOrgIds }` for a dotted-FK/labelField lookup
  (the simple dotted-key lookup, the non-key FK lookup, and the composite/dotted-label
  candidate-map build) have no `OR ... IS NULL` branch, regardless of whether the *lookup
  entity itself* has `organization` optional. If some other entity's CSV import resolves a
  labelField FK into an org-optional entity (e.g. `parent1`), an org-less target row cannot be
  resolved by natural key — a false `NOT_FOUND`/`MULTI_MATCH` on import. This is a distinct
  computation (the target entity's own optionality, not the importing entity's) requiring new
  plumbing in `build_context.py`'s `_lookup_entity_filter_by_org` logic — genuinely separate
  scope from this pass, not fixed here.

## Open design question: how far should NULL-organization visibility extend?

The chosen semantics — an org-less row is visible to *any* org-scoped actor with the relevant
permission, not scoped to "actors with no organization at all" or any narrower group — is one
defensible reading of "this entity's organization is optional, therefore this row isn't
org-specific," but it is a product/policy choice, not a mechanically-forced one. A schema author
who wants a different visibility rule for optional-org rows (e.g. visible only to their creator,
or invisible to everyone until explicitly claimed) is not served by this default and would need a
different mechanism. Flagged for follow-up, not resolved here.

## Permanent regression coverage

`code_generator/tests/test_build_context.py`: `TestOrgRelationshipOptional` (flag computation) and
`TestOrgRelationshipOptionalRenderedTemplates` (rendered-output assertions on `getters.ts.jinja2`
and `api_detail_route.ts.jinja2`, deviation-injection verified — all assertions confirmed to fail
against the pre-fix templates). `test_org_optional_create_guard.py` covers Gap 1 separately, also
with deviation-injection proof. `test_search_org_null_row.py` (cmd_640) covers
`search_helpers.ts.jinja2`'s independent context wiring, both the direct and `no_page_children`
parent-qualified sites, also with deviation-injection proof.
`test_org_optional_update_existence_check.py` (cmd_634) covers `_actor_and_existing_block()`'s
OR-null admission (admits-null-org, org-required-still-strict, unconditional-no-actor-org-guard
regression, and deviation-injection), also verified end-to-end against proj_c's `parent1` in an
isolated worktree.
