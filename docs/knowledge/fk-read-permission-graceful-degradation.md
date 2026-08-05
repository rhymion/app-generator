# FK Read-Permission Graceful Degradation (Option B)

## The problem

Creating or editing a record with a foreign-key relation requires an autocomplete picker for
that FK — `search{Target}Options()` (in `lib/{target}/getters.ts`) enumerates candidate rows for
the picker. That enumeration is access-controlled the same way a list page is: it calls
`assertPermission(permissions, 'read', target)`, and throws if the acting user lacks `read` on
the FK's target model.

Before this fix, that throw propagated out of the page's `Promise.all()` and crashed the whole
Server Component render to the `error.tsx` boundary — an actor with full CRUD on the entity
itself, but no `read` on one of its FK targets, could not open the create or edit page at all.

Viewing an existing record never has this problem: the list/detail getters fetch the FK's label
via a Prisma `include` (a join that returns one attached row), not via `search{Target}Options()`'s
independent enumeration. `assertPermission` is only invoked for the entity being listed/viewed,
never for an included relation's target model. Enumerating "all rows of X, please" and "the one
row of X this record already points to" are different operations with different disclosure
risk, so it makes sense that only the former is permission-checked — but the resulting form
crash was a UX accident, not something the security check itself intended.

## Special-case survey (which relations require target-read)

| Case | Relation shape | Requires target read? |
|------|-----------------|----|
| (a) | Direct many-to-one FK | Yes — via `search{Target}Options()` |
| (b) | Dotted `labelField` (e.g. `location.warehouse.name`) | Only the *direct* FK target — deeper levels are fetched via nested Prisma `include`, no separate permission check |
| (c) | Bridge / auto-create one-to-one (`<model>able`) | Yes, for every bridge parent target |
| (d) | DataGrid child's own FK (e.g. a line-item's `product_id`) | Yes — the child's FK target is added to the parent page's selection targets |
| (e) | Self-referential FK (e.g. `category.parent_id → category`) | Yes, technically, but rarely an issue — a user who can list an entity almost always already has read on it |
| (f) | FK introduced by `x-approval` / `x-reservation` | Yes for the FK'd entity itself (e.g. `approval_flow`); one level deeper (e.g. `approval_flow.approver_role_id`) is `include`-fetched, same rule as (b) |
| (g) | Selector one-to-one (`getAvailable{Target}sFor{Parent}()`) | No — this getter calls `prisma.{target}.findMany()` directly and never called `assertPermission` at all, which is its own (adjacent) bug: an unchecked read, not a crash |
| (h) | `organization_id` (a `should_filter_by_org` entity's org-isolation boundary FK) | **Not applicable — excluded, see below.** This is not an RBAC read-permission case at all. |

### (h) is a different mechanism, not a variant of graceful degradation

An entity with `should_filter_by_org` (any relation targeting `organization`) has its PUT/DELETE
existence lookup scoped by `getAssociatedOrganizations(actorId)` — actual organization
**membership** — not by any `read` permission row on the `organization` model (cmd_515). An actor
can hold full CRUD permission on the entity itself and *still* be scoped out entirely if they
belong to zero organizations: the row is never found, so the request 404s before the FK is ever
evaluated. This is org isolation working as designed, not a denied-read UX problem, and it must
never be given the "field is preserved" treatment described below — that would assert success
(HTTP 200) for a request cmd_515 correctly rejects. See cmd_576.

## Option B: what changed

Two getters can now report "I can't check this" instead of throwing:

- `search{Target}Options()` — returns `Object.assign([], { permissionDenied: true })` when the
  actor lacks read on the target, instead of throwing.
- `getAvailable{Target}sFor{Parent}()` (the selector one-to-one case, (g) above) — now actually
  checks permission (closing the unchecked-read gap) and applies the same no-throw, flagged-empty
  treatment on denial.

The affected FK field then renders as a disabled, read-only field (showing the record's current
value, if any) instead of an interactive picker:

- **Required FK, denied**: the field cannot be cleared (`AppFieldRelation`'s clear button only
  renders when `!required`). There is no way for this actor to supply a replacement value, so
  clearing it would strand the record in an unsubmittable state. The `/new` page for an entity
  with a required, denied FK is blocked entirely with an explanatory `Alert`, since there is no
  way to populate the field at all before first save.
- **Optional FK, denied**: the field can still be cleared to `null` — clearing loses no
  information the actor could otherwise provide anyway.
- **Persistence**: a required FK omitted from an update call (because the UI can't offer a way to
  change it) is *not* treated as a validation failure — the service layer falls back to the
  record's current value in the database before validating, rather than nulling or rejecting it.
  This guarantee lives in the shared service layer (`lib/{entity}/service.ts`'s `update{Entity}`),
  so it protects both the generated API route and the form's server action, not just one caller.

## A pitfall this surfaced: Server-to-Client Component prop serialization

The `permissionDenied` flag is attached to the *options array itself* returned by the getters
above (`Entity[] & { permissionDenied?: boolean }`), not as a separate field on a wrapper object.
That works fine as long as the flag is read within the same Server Component that fetched it
(e.g. the `/new` page's required-FK blocking check runs entirely server-side, before anything
crosses a component boundary).

It does **not** work if a Client Component tries to read that same flag off the array *after* it
has been passed down as a prop: a non-index property attached to a JS array does not survive the
Server-to-Client Component serialization boundary (React's Flight protocol only carries indexed
array elements across that boundary, the same way `JSON.stringify` would drop the extra property).
`FormUpsert.tsx` is a Client Component, and it needs the flag to decide whether to render
`AppFieldRelation`'s disabled branch — reading `initial{Target}s?.permissionDenied` there always
evaluated to `false` in practice, silently defeating the entire feature in the browser even
though the getters logic was correct in isolation.

The fix: the page (a Server Component) computes the boolean from the array's flag *before*
passing anything to the client, and passes it down as its own primitive boolean prop
(`initial{Target}sPermissionDenied`) alongside the array. Primitives serialize fine. If you add
a new code path that threads a flag or marker through an array/object crossing a Server-to-Client
boundary, extract it into its own prop server-side rather than relying on the client to read it
back off the shared value — this class of bug produces no type error and no runtime exception,
only a component that silently behaves as if the flag were always unset.

## Testing

- `cypress/e2e/api/{entity}.cy.ts` (generated, mandatory gate): a regression test is generated for
  any entity with a required many-to-one relation *other than* `organization_id` (`4.4 preserves
  {fk} ...`), verifying that a PUT omitting that FK preserves its existing value. The relation
  picked is `next(r for r in relationships if r['required'] and r['target'] not in (model,
  'organization'))` (`code_generator/generators_test.py`) — self-referential FKs are excluded for
  the reason in row (e) above, `organization_id` is excluded for the reason in row (h). If an
  entity's *only* required non-self relation targets `organization`, no 4.4 test is generated for
  it at all (there is no other FK left to exercise the graceful-degradation scenario against).
- `cypress/e2e/api/{entity}.cy.ts` also generates `G3.4 PUT by an actor with no organization
  membership returns 404` for every `should_filter_by_org` entity (independent of which relation,
  if any, got picked for 4.4) — this is the case row (h) actually asserts: the same
  `db:createApiUserWithPermission` fixture used for 4.4 (full CRUD, zero org memberships), but the
  expectation is rejection, not preservation.
- `cypress/e2e/api/fk_read_permission_graceful_degradation.cy.ts` (hand-written, mandatory gate):
  browser-session coverage proving the edit page doesn't crash, that unrelated field changes can
  still be saved, and that the optional/required clear-button asymmetry actually renders as
  designed — this is the layer that caught the serialization pitfall above, since the generated
  API-key-based spec never exercises the Server-to-Client boundary at all.
