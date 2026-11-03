---
name: security-test-matrix
description: |
  Use when adding or changing a route, Server Action, import/export path or other
  mutation path, or when writing or reviewing security tests. Describes the security
  test matrix (operation x actor/case x foreign-key shape), how to claim a cell with a
  `security-cell:` marker, which helpers to use, the foreign-key reachability rule, and
  that every denial must be verified by re-reading the database. Also holds the
  org-scoped mutation-path IDOR checklist (formerly its own skill): mutation paths on an
  organization-scoped entity must filter by organization in the initial lookup.
  Trigger words: "security test", "permission denied", "cross-org", "IDOR",
  "should_filter_by_org", "organization_id filter", "check:security-matrix".
  Do NOT use for: read-path org filtering that already goes through buildAccessWhere,
  general role design, or projects with no organization_id.
---

# Security test matrix

Every route and Server Action is a row; every security case is a column. A cell is covered when a test claims it
with a comment `// security-cell: entity=<e> operation=<op> case=<case> [fk_shape=<shape>]`, or is listed with a
reason in `code_generator/security_matrix_allowlist.yaml`. `npm run check:security-matrix` fails otherwise. The matrix
itself is data in `code_generator/security_matrix.yaml`; full description in `docs/knowledge/security-test-matrix.md`.

## Rules

1. **Every new route or action gets tests**: permission denied (403), another organization (404, organization-scoped
   entities) and invalid input; add a `case` to the matrix YAML for a new kind of input rather than an ad-hoc test.
2. **Assert the explicit status** the matrix declares (`denied_status`), never a range such as `>= 400`.
3. **Re-read the database** after every denied write (each row of a bulk request) and assert nothing changed.
4. **Foreign-key reachability**: a write that carries a foreign key is tested per `fk_shape` against a row the actor
   cannot reach (other organization, no read permission, outside a creator/assignee scope).
5. **Hand-written code** uses the shipped helpers `expectDeniedFor`, `seedActorWithoutRole`,
   `seedActorFromOtherOrganization` (`docs/knowledge/security-test-helpers.md`); generated specs already carry markers.
6. A test that starts failing after a cell is filled is a vulnerability candidate: triage it as one, file it as its
   own Issue with severity, do not just patch the test.
7. Gate: `npm run check:security-matrix`, `npm run check:generated`, `npm run check:handwritten-routes`.



## Org-scoped mutation paths: IDOR checklist

## North Star

`lib/authz.ts`'s `RecordContext` only carries `creator_id` / `assignee_id` (plus
an `[key: string]: unknown` index signature that lets extra fields pass
through silently without being checked). `resolveRecordPermissions()` /
`canAccessRecord()` / `requireApiRecordPermission()` / `requireRecordPermission()` (and their entity-only counterparts) never look at
`organization_id` — the org boundary must be enforced by adding the filter to
the **initial DB lookup** in the mutation path itself, not by extending
`RecordContext`. Read paths (list, search, `getDetail`, export) already do this
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
   `requireRecordPermission(model, op, item, userId)` in `lib/authz.ts` needs a
   record, so a null org-filtered result cannot be passed to it. The temptation
   is to fall back to `requireEntityPermission(model, op, userId)`, which answers
   with the top-level `general | creator | assignee` union. If the org-filtered
   fetch returns null (cross-org id) and the code doesn't `throw`/404 on that
   null before the permission check, a user with `general.update = true` sails
   through even though the record doesn't belong to their org — the org filter
   only restricted what was *read*, not what gets *written*. The entity-only
   check is for the coarse gate in front of the lookup, never for deciding on a
   record that was not found. This was found live during test-writing for an
   `org_isolation.cy.ts` case and required an explicit `if (!existing) throw`
   in addition to swapping `findUnique` → org-filtered `findFirst`.

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
- Do not assume `RecordContext`'s `[key: string]: unknown` index signature means
  `organization_id` is checked anywhere — it passes through structurally but
  `resolveRecordPermissions()` never reads it.
