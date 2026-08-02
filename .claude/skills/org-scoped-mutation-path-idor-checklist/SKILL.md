---
name: org-scoped-mutation-path-idor-checklist
description: |
  When adding or reviewing a new mutation path (create/update/delete server
  action, API route, or import handler) on an org-scoped entity
  (should_filter_by_org / organization_id present), read paths
  (list/search/getDetail/export) commonly enforce the org-membership filter
  via buildAccessWhere/findFirst, but mutation paths are easy to leave on a
  bare findUnique/findMany fetch — organization_id passes through
  lib/authz.ts's ItemContext index signature but resolvePermissions() never
  checks it, so general.update/general.delete=true silently lets one org
  overwrite or delete another org's record (IDOR). Trigger when writing or
  reviewing a new generator template/mutation path for an org-scoped entity,
  when a task description mentions "org isolation", "organization_id filter",
  "cross-org", "IDOR", "should_filter_by_org", or when auditing
  create/update/delete/import code paths for multi-tenant boundary
  enforcement.
  Do NOT use for: read-path org filtering (list/search/getDetail/export) that
  already routes through buildAccessWhere/findFirst — those are the CLEAN
  reference implementation this checklist compares against, not gap
  candidates. General authz/permission-role design unrelated to org
  membership. Non-multi-tenant projects with no organization_id concept.
---

# org-scoped-mutation-path-idor-checklist

## North Star

`lib/authz.ts`'s `ItemContext` only carries `creator_id` / `assignee_id` (plus
an `[key: string]: unknown` index signature that lets extra fields pass
through silently without being checked). `resolvePermissions()` /
`canAccess()` / `requireApiPermission()` / `requirePermission()` never look at
`organization_id` — the org boundary must be enforced by adding the filter to
the **initial DB lookup** in the mutation path itself, not by extending
`ItemContext`. Read paths (list, search, `getDetail`, export) already do this
correctly via `buildAccessWhere()` / org-filtered `findFirst`. Every mutation
path added after that point has to independently repeat the same pattern —
and three of them didn't, at HIGH severity, plus one LATENT MEDIUM.

## 4-point checklist

For any code path that fetches a record before mutating it on an org-scoped
entity:

1. **Does the path use `findUnique`/`findMany` without an org filter to fetch
   the record before mutating it?** — `findUnique({ where: { id } })` and
   `findMany({ where: { id: { in: ids } } })` both fetch globally, ignoring
   org boundaries.
2. **Is `should_filter_by_org` checked at all?** — if the template branch
   never conditions on it, the org filter simply isn't there regardless of
   what other paths in the same file do.
3. **Is `organization_id` actually present in the `where` clause reaching
   Prisma?** — not just computed (`getAssociatedOrganizations(actorId)` /
   `_assocOrgIds`) but threaded into the query itself. An initial fix attempt
   can replace `findUnique` with an org-filtered `findFirst` but then still
   let a null result fall through — see point 4.
4. **When the org-filtered lookup returns null/empty, does the null/empty
   case actually short-circuit the permission check — or does it fall through
   to a `general.*` permission that grants access anyway?** —
   `requirePermission(model, op, item, userId)` in `lib/authz.ts` falls back
   to the top-level `general | creator | assignee` union permissions whenever
   `item` is falsy. If the org-filtered fetch returns null (cross-org id) and
   the code doesn't `throw`/404 on that null before calling
   `requirePermission`, a user with `general.update = true` sails through the
   permission check even though the record doesn't belong to their org — the
   org filter only restricted what was *read*, not what gets *written*. This
   was found live during test-writing for an `org_isolation.cy.ts` case and
   required an explicit `if (!existing) throw` in addition to swapping
   `findUnique` → org-filtered `findFirst`.

## Byte-diff containment (generator template changes only)

When the fix lives in a shared Jinja2 template or a Python codegen function
used by both org-scoped and non-org-scoped entities, confine every change
(actorId hoisting, `findFirst` vs `findUnique`, `where`-clause formatting)
strictly inside the `{% if should_filter_by_org %}` branch. An unconditional
refactor of surrounding code (e.g. moving `actorId` declaration or reformatting
a `findMany` call outside the conditional) will produce collateral byte diffs
across every non-org-scoped entity's generated output. Verify with a two-way
golden diff (baseline vs fixed generation of the same schema): non-org-scoped
entities must be byte-for-byte identical; only org-scoped entity files should
change. One real fix attempt failed exactly this check (~40 unrelated
entities' `actions.ts` changed) and required a follow-up commit to contain the
diff.

## Example

An audit of the app-generator templates found:
- **GAP-1** (`api_detail_route.ts.jinja2`, PUT/DELETE): `findUnique({ where:
  { id } })`, no org filter — cross-org record overwrite/delete via REST API.
- **GAP-2** (`generators.py` `_upsert_body`, session upsert): same pattern via
  a server form action — no API key required.
- **GAP-3** (`actions.ts.jinja2` `remove{{ parent_pascal }}`): `findMany` over
  `ids` with no org filter; `general.delete=true` skips the creator/assignee
  filter entirely, deleting cross-org records.
- **GAP-4** (`api_import_route.ts.jinja2`, LATENT): CSV import UPDATE path key
  lookup has no org filter either, but no current entity has both
  `x-import-key` and `organization_id`, so it's unexercisable today —
  implemented preventively, not e2e-verified.

Implementation found and fixed two bugs the audit's fix design didn't
anticipate: (A) the missing `if (!existing) throw` described in point 4
above, discovered while writing `org_isolation.cy.ts`; (B) the collateral
byte-diff from an unconditional refactor, described above. Final state:
GAP-1–3 fixed and e2e-verified (`org_isolation.cy.ts`, 7/7 passing), GAP-4
fixed but latent; mandatory gate fully passing, zero skips; two-way golden
diff clean.

## Do NOT

- Do not treat "org filter present in the `where` clause" as sufficient proof
  of a fix — check that a null/empty org-filtered result actually blocks the
  subsequent permission check rather than falling through to a `general.*`
  grant (point 4).
- Do not apply a template/codegen fix without a two-way golden diff proving
  non-org-scoped entities are byte-for-byte unchanged.
- Do not assume `ItemContext`'s `[key: string]: unknown` index signature means
  `organization_id` is checked anywhere — it passes through structurally but
  `resolvePermissions()` never reads it.
