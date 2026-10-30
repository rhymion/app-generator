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
| `.security-manifest.json` | Written by `generate-code` (git-ignored): the applicable cells per entity. |

## Claiming a cell

A test carries a comment anywhere in the file:

```
// security-cell: entity=<entity> operation=<operation> case=<case>
```

The generated API spec (`test_api_spec.cy.ts.jinja2`) carries these markers for its permission-denied and
cross-organization tests. A hand-written spec claims a cell the same way, with the entity written out.

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

## Applicability

A cell exists when every `requires` flag of its values is true for the entity. Cross-organization cases are dropped for
an entity without an organization column. Anything else without a test belongs in the allowlist.

## Route enumeration

`test_api_route_authentication_enumeration.py` checks two things for every route template: the caller is
authenticated, and each update, delete and action handler checks the permission against the target record (not only
at entity level). `test_security_matrix.py` checks that every route template `generate.py` renders for an entity is
either an operation in the matrix or listed under `unmodelled_templates` with a reason, so a new kind of route cannot
skip the matrix.
