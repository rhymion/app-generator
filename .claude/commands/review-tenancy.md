---
description: Multi-tenancy review — organization filter coverage, data leak paths, cross-organization operations.
argument-hint: <scope or model to review>
---

This is a **tenancy review** task. Read the relevant source files carefully before evaluating.

Scope: $ARGUMENTS (if empty, review all generated queries and API routes)

Minimum docs to read before starting:
- `docs/knowledge/multi-tenancy-and-permissions.md` — §1 (organization isolation), §4 (when the org filter fires), §5 (current limitations), and the auth/authz system

## Isolation boundary

The boundary generated code enforces today is the **`organization_id` foreign key**,
not the deployment-level `tenant_id` column. An entity is org-scoped when it has an
`organization_id` many-to-one relationship to `organization` and is neither
`organization` nor `user` (`should_filter_by_org` in `code_generator/build_context.py`).
`user.tenant_id` exists and is populated, but generated getters, actions and routes do
not filter on it (see §5 of the doc above). Do not report the absence of a `tenant_id`
filter as a defect of generated code; review it as a documented limitation, and review
the organization boundary as the active one.

## How to run this review

1. Read the relevant source files (schema, generated API routes, getters, actions).
2. Check each item in the checklist below.
3. For each item: cite specific `file:line` evidence.

## Checklist

### Organization filter coverage

- [ ] Every list and detail query of an org-scoped entity filters on `organization_id` in `associatedOrganizationIds` (`getters.ts.jinja2`, `buildEntityAccessWhere()`); detail reads use `findFirst`, not a bare `findUnique` by id
- [ ] Entities that should be org-scoped actually are — each has an `organization_id` FK to `organization` and the `@@index([organization_id])` that `validate.py` requires
- [ ] Where `organization_id` is optional, the `OR: [..., { organization_id: null }]` branch (`org_relationship_optional`) is intended, and rows with a null organization are acceptable to expose to every user
- [ ] `getAssociatedOrganizations(userId)` returns only organizations the user is a member of (`lib/organization/associated_internal.ts`)

### Data leak paths

- [ ] `GET /api/{entity}/{id}` cannot return a row of another organization (`api_detail_route.ts.jinja2`)
- [ ] `GET /api/{entity}` list, search and export (`api_route.ts.jinja2`, `api_export_route.ts.jinja2`) apply the org filter
- [ ] UI Server Actions (`actions.ts.jinja2`) cannot leak cross-organization rows
- [ ] FK option lists and entity-select lookups only offer rows of the actor's organizations

### Cross-organization operations

- [ ] `PUT` and `DELETE /api/{entity}/{id}` re-fetch the target with the org-scoped `findFirst` before `requirePermission()`, and a miss answers 404
- [ ] Bulk routes (`api_bulk_route.ts.jinja2`) filter the requested ids by organization
- [ ] Session upsert and delete actions throw on an org-scoped lookup miss instead of falling through to the write
- [ ] CSV import (`api_import_route.ts.jinja2`) org-filters every existing-row lookup and fetches the actor's organizations once before the row loop
- [ ] Hand-written code (custom routes, custom validation, scheduled tasks) that queries an org-scoped model applies the same filter — `check_generated.py` does not verify `where` clauses

### Deployment-level tenant (documented limitation)

- [ ] Confirm the state described in §5 of the doc still holds: no generated `tenant_id` filtering, no `lib/tenant.ts`, `tenant.status = 'suspended'` not enforced at sign-in. If it has changed, update the doc rather than this command
- [ ] Isolation is app-level (Prisma `where`), not Postgres row-level security; note any hand-written query that could bypass it

## Known gaps / improvement areas

Take these from `docs/knowledge/multi-tenancy-and-permissions.md` §5 rather than copying
them here, and add findings from this review as GitHub Issues on the target repo.

## Completion gate

Run:

1. `npm audit --omit=dev --audit-level=high`

(No build/test/lint required — this is a read-only review task with no code
changes; npm audit is run as a companion vulnerability check.)

> **Note**: When running lint or typecheck in isolation, prefix with
> `npm run generate-code` first. See `AGENTS.md §Generated-code prerequisites
> for gates` for the full rule.
