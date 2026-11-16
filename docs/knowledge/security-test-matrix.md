# Security test matrix

Every generated route and Server Action is a row of a matrix; every security case is a column. A cell is
"covered" when a test claims it. `npm run check:security-matrix` fails when an applicable cell is neither claimed
by a test nor listed, with a reason, in the allowlist.

## Files

| File | Role |
|------|------|
| `code_generator/security_matrix.yaml` | The matrix as data: axes, their values, which entity flags make a value apply, which values combine. |
| `code_generator/security_matrix.py` | Expands the matrix per entity (the manifest) and compares it with the tests. Names no axis or value. |
| `code_generator/security_matrix_allowlist.yaml` | Cells without a test, each with a written reason. |
| `.security-manifest.json` | Written by `generate-code` (git-ignored): the applicable cells per entity and the `denied_status` of each case. |

## Claiming a cell

A test carries a comment anywhere in the file:

```
// security-cell: entity=<entity> operation=<operation> case=<case> [fk_shape=<shape>]
```

`fk_shape` defaults to `none`, so a marker that does not name it claims the cell of a test that is not about a
reference.

The generated API spec (`test_api_spec.cy.ts.jinja2`) carries these markers for its permission-denied and
cross-organization tests. A hand-written spec claims a cell the same way, with the entity written out.

Tests of hand-written code use the shipped helpers (`expectDeniedFor`, see `docs/knowledge/security-test-helpers.md`),
which take the cell, assert the status the matrix declares for its case (`denied_status` in the YAML, copied to the
manifest) and re-read the database to prove a denied write did not persist. A test file that calls `expectDeniedFor`
without any marker fails the check.

A marker that names a cell the manifest does not have, an allowlist entry that matches no cell, and an allowlist
entry whose cells are all tested now each fail the check too, so neither list can drift from the tree.

## Adding an axis, a value or a combination rule

Edit `security_matrix.yaml` only:

- a new case (for example invalid input): add a value under `axes.case.values` with `requires` flags;
- a new dimension (for example an actor kind): add an entry under `axes`. Give it a `default` so existing markers,
  which do not name it yet, keep claiming their cells;
- restrict which values combine with `combine: {operation: [create, update]}`.

The cells the new axis creates and no test claims are reported as missing until a test claims them or the allowlist
lists them. A `requires` flag must be one of the booleans `generate.py` collects in `security_entity_flags`; an unknown
flag fails the check instead of reading as false.

## References to rows the actor cannot reach

A write that touches a foreign key is tested per kind of reference. The `fk_shape` axis names the kind and applies to
an entity that holds such a reference to an organization-scoped entity (not `organization` or `user`):

| `fk_shape` | Reference held by |
|---|---|
| `many_to_one_required`, `many_to_one_optional` | the entity itself, many-to-one |
| `one_to_one_required`, `one_to_one_optional` | the entity itself, one-to-one |
| `inline_child_required`, `inline_child_optional` | a row of an inline-edited child grid (the key back to the parent is not counted) |
| `many_to_many` | a member of a many-to-many set chosen on the entity |
| `one_to_many` | a member of a one-to-many list chosen on the entity (attached through the member's nullable foreign key) |

The set shapes come from the same checks `service.ts` generates (`set_fk_checks` in `build_context.py`), counted when
the member entity has an organization column. Five cases combine with these shapes only, each limited to the operations
that can perform it and to the shapes it makes sense for:

| `case` | Meaning | `denied_status` |
|---|---|---|
| `fk_to_unreachable` | write a reference to an unreachable row, or add one to a set (create, update, bulk, import, Server Action) | 404 |
| `fk_away_unreachable` | re-point a single reference that holds an unreachable row | 403 |
| `fk_null_unreachable` | clear an optional single reference that holds an unreachable row | 403 |
| `fk_drop_unreachable` | remove a set member, or drop an inline child row, that holds an unreachable row (inline and set shapes) | 403 |
| `fk_delete_unreachable` | delete a record whose reference, set member or inline row holds an unreachable row | 403 |

The behavior behind the cells is described in
[multi-tenancy-and-permissions.md](multi-tenancy-and-permissions.md) ("Foreign keys: a write may only point at a row
the actor can reach"): one rule for every shape, to-many sets included.

Who claims the cells:

- the generated tests `G3.8`-`G3.15` claim the REST cells of the primary display field, generated only when that
  field is a foreign key;
- the security fixture's hand-written spec `cypress/e2e/fk_reference_shapes.cy.ts`
  (`code_generator/tests/fixtures/security_matrix_e2e_gate/`, run by `npm run test:security-matrix-e2e-gate`) claims
  the REST single and bulk cells of every other shape the fixture holds (`sx_ticket`: many-to-one required and
  optional, inline child required and optional, many-to-many, one-to-many; `sx_profile`: one-to-one optional;
  `sx_task`: a required many-to-one that is not the primary field; `sx_entry`: a required and an optional many-to-one
  on an importable entity, through REST and through CSV import), against a row of another organization and against
  rows outside the actor's Creator / Assignee read scope;
- the fixture's Server Action flow `flows/fk_reference_actions.test.ts` claims the `action_add`, `action_update` and
  `action_delete` cells of every shape. The gate copies it to `test/flows/security_matrix_e2e_gate/` after the
  build, scans it for markers (`check:security-matrix --tests cypress test/flows/security_matrix_e2e_gate`) and runs
  it with vitest after the Cypress specs, against the same database. It calls the generated `upsert<Entity>` /
  `remove<Entity>` as a given user through `runAsActor()` (`lib/_request_scope.ts`); `lib/authz`, the services and
  the database are real, and only next-auth, the Next.js `redirect` / `revalidatePath` helpers and the rate limiter's
  Redis backend (the shipped in-memory limiter is used) are replaced. A
  refusal is the action's `{ ok: false, errorCode }` (`NOT_FOUND` for 404, `PERMISSION_DENIED` for 403), followed by
  a re-read of the rows.

## Generated denial tests

The generated API spec (`test_api_spec.cy.ts.jinja2`) claims the REST cells without a foreign-key shape. Group `7.x`
holds the no-permission cases (list, create, update, delete, export, import, detail, bulk create, bulk update, bulk
delete, `/options`; status 403), group `G3.x` the other-organization cases. A denied write re-reads the record(s) with
an authorised key and asserts nothing changed, including each row of a bulk request. A bulk request denied at entity
level answers 403 for the whole request; a bulk item naming another organization is a failed `Not found` item in a 207
answer. The authentication tests (`6.1`, `6.2`) assert `401`. Search and approve/reject denial are not matrix
operations, so the matrix does not track them.

## Applicability

A cell exists when every `requires` flag of its values is true for the entity. Cross-organization cases are dropped for
an entity without an organization column. Anything else without a test belongs in the allowlist.

## Route enumeration

`test_api_route_authentication_enumeration.py` checks two things for every route template: the caller is
authenticated, and each update, delete and action handler checks the permission against the target record (not only
at entity level). `test_security_matrix.py` checks that every route template `generate.py` renders for an entity is
either an operation in the matrix or listed under `unmodelled_templates` with a reason, so a new kind of route cannot
skip the matrix.

`test_cookie_write_cross_site_enumeration.py` adds a third check over the same route sources: a state-changing handler
that reads the session cookie itself must call `assertSameSiteCookieWrite()`, and the cookie-resolving helpers in
`lib/api-auth.ts` must call it before they read the cookie (see [authentication.md](authentication.md)).

`test_rest_credential_confirmation.py` covers the credential-confirmation guard of the self-only account view on both write
paths: the REST update routes and the settings screen's Server Action must call `confirmCredentialChange()` after the
permission check and before the write, and the edit form must post `current_password` (see
[authentication.md](authentication.md)).

See also [security-asvs-coverage.md](security-asvs-coverage.md), which maps each OWASP ASVS 5.0 requirement to the code, test or Issue that covers it.
