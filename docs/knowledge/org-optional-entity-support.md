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
| `api_detail_route.ts.jinja2` | PUT and DELETE REST routes' existence check |
| `api_import_route.ts.jinja2` | CSV import's match-by-natural-key lookup |

A required-org model gets the plain `IN` filter unchanged — `organization_id` is never `NULL`
there, so the `OR`-null branch would be dead code, and the flag is `false` specifically to avoid
generating it.

**Deliberately not touched**: the CSV-import FK-*lookup-target* org filters (whether a
*referenced* entity like `role` is itself org-scoped — see
[`csv-import-dotted-fk-org-filter.md`](csv-import-dotted-fk-org-filter.md)) and the cross-entity
global search path (`search_helpers.ts.jinja2`, which builds its own independent SQL fragments and
has the identical NULL-visibility gap but wasn't in scope for this pass — flagged as a follow-up,
not yet fixed).

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
with deviation-injection proof.
