# CSV Import Dotted-FK Org Filter (cmd_521)

## The gap

`code_generator/templates/api_import_route.ts.jinja2` resolves a dotted `x-import-key` entry
(e.g. `role.name` on `permission`) by looking up the referenced entity by its natural key:

```typescript
const _role_rows = await prisma.role.findMany({
  where: { name: _role_csv_val },
  select: { id: true },
});
```

For an organization-scoped parent entity (`should_filter_by_org`), this lookup used to be
unfiltered regardless of whether the *target* of the dotted FK was itself org-scoped. An actor
in org A submitting a CSV value that happens to match a same-named row owned by org B would get
that row's id back, silently linking their new/updated record to a resource outside their org —
the exact class of gap cmd_515 closed for direct saves (`service.ts.jinja2`'s CREATE/UPDATE
validation), but left open in the CSV import path (flagged by cmd_515, deliberately not fixed by
cmd_520, which added the isolation test scaffolding without this fix).

## The fix

Same discriminant as cmd_515's `should_filter_by_org`, applied per dotted-FK **lookup entity**
instead of to the parent model: `code_generator/build_context.py` computes
`lookup_entity_filter_by_org = <lookup entity has organization_id> and <lookup entity not in
('organization', 'user')>` for every dotted `import_key_specs` entry, plus a route-level
`any_dotted_fk_needs_org_filter` (true if *any* dotted key on the route needs it — this can be
true even when the parent entity itself is not org-scoped).

`api_import_route.ts.jinja2` then:
1. Imports `getAssociatedOrganizations` when `should_filter_by_org OR
   any_dotted_fk_needs_org_filter` (previously gated on `should_filter_by_org` alone).
2. Computes `_importOrgIds` under the same broadened condition.
3. Adds `organization_id: { in: _importOrgIds }` to the dotted-FK `findMany`'s `where` clause,
   conditionally per spec (`spec.lookup_entity_filter_by_org`).

A foreign-org match now falls through to the existing `NOT_FOUND` branch — no new error code.
`MULTI_MATCH` (two orgs sharing the same display value) is resolved as a side effect, since the
org filter narrows the candidate set to the actor's own org(s) before the count check.

## The trap: system-global lookup entities

Some dotted-FK targets have no `organization_id` at all (e.g. `role`, which is visible
org-wide by design). Applying the org filter unconditionally to *every* dotted lookup would
return zero rows for these and break every CSV import that references them. The fix computes
`lookup_entity_filter_by_org` **per lookup entity**, not per parent model — `role.name` stays
unfiltered even when the parent entity (e.g. `permission`) is itself org-scoped, while a dotted
FK into a genuinely org-scoped entity gets filtered.

## UPDATE path and export — no separate change needed

The dotted-FK resolution loop runs once, before the CREATE/UPDATE branch, and its result
(`keyWhere`) feeds both: the `matches` lookup used to find an existing row (already
`organization_id`-filtered for the parent) and the `create`/`update` payload. UPDATE never
writes the dotted-FK-resolved column back (`import_update_fields` is scalar-only), so the risk
was entirely in *resolving* the wrong id, which the same fix eliminates for both branches.

Export (`api_export_route.ts.jinja2`) has no dotted-FK resolution step — it reads through
`getters.ts`, which already applies standard org filtering. No change needed there.

## Verification note

This schema (`app-generator`'s own dogfood app) has no naturally org-scoped entity — the CSV
import route templates only render `should_filter_by_org` branches for a *consuming* project's
schema (e.g. an app with an `organization_id` FK on a real entity). The before/after attack
demonstration for this fix was therefore done against a temporary, worktree-local schema
addition (giving `permission` and `dashboard` a synthetic `organization_id` relation and a
`dashboard.name` dotted key) — reverted before the final commit, evidence preserved in the
subtask_521b report — while the permanent, CI-enforced regression coverage is the
`build_context_test.py` unit test below, since this generator's own mandatory e2e gate cannot
exercise `should_filter_by_org` end-to-end until a *consuming* project's org-scoped schema does.

## Permanent regression coverage

`code_generator/tests/test_build_context.py::TestImportKeySpecsLookupEntityFilterByOrg` builds a
synthetic schema fixture with an org-scoped parent, a dotted FK into an org-scoped lookup entity,
and a dotted FK into a system-global lookup entity, and asserts `import_key_specs` computes
`lookup_entity_filter_by_org` (and the route-level `any_dotted_fk_needs_org_filter`) correctly in
both directions — this is what actually runs on every `npm run test:pytest` regardless of which
downstream schema exists.
