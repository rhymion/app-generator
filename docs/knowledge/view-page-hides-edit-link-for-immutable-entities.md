# View page: `canEdit` no longer trusts `permissions.update` alone for immutable entities

## The failure this closes

`components/{parent}/FormView.tsx` (`form_view.tsx.jinja2`) computed its
edit affordance purely from RBAC:

```ts
const canEdit = permissions?.update ?? true;
```

This never consulted `can_update` (`x-generate.edit`), the generator-level
flag that says whether this entity has an update path *at all*. For a
`x-generate.edit: false` entity, no `app/[locale]/{parent}/edit/[id]/`
page is generated and no `update{Parent}()` Server Action exists — but if
an **orphaned** edit page survives on disk from before `edit` flipped to
`false` (not regenerated, so still present), `canEdit` could still
evaluate to `true` whenever the caller's `permissions.update` happened to
be true, rendering a working-looking "Edit" link on the view page straight
into that orphan.

Found as a byproduct of `subtask_999a`'s proj_g orphan sweep, on a real
consumer's `purchase_order` entity (`x-generate.edit: false`):
`components/purchase_order/FormView.tsx` still exposed an Edit link
because it only checked `permissions?.update`. Same root cause, same
incident (`PO-DEMO-025`), as the sibling fix in
`create-only-upsert-rejects-update-intent.md` — that fix stops the
Server Action from silently succeeding once reached; this fix stops the
view page from offering the path to it in the first place. Both are
independently necessary: this fix is a UI-affordance close, not an
authorization boundary — the Server Action guard is what actually makes
the create-only path fail loudly if reached by any other route (a typed
fetch, a stale bookmark, a future regression here).

## The fix

`form_view_context()` already has `can_update` available via the shared
per-entity `ctx` (`fv_ctx = {**ctx, **form_view_context(ctx, schema)}` in
`generate.py`) — no Python change was needed, only the template:

```jinja2
{% if can_update %}
  const canEdit = permissions?.update ?? true;
{% else %}
  const canEdit = false;
{% endif %}
```

For a create-only entity, `canEdit` is now a compile-time-hardcoded
`false`, independent of whatever `permissions.update` evaluates to at
runtime. `editHref={canEdit ? ... : undefined}` therefore never renders
for that entity, regardless of RBAC.

## Scope and verification

- Only the `{% else %}` branch is new; the `{% if can_update %}` branch is
  byte-for-byte the original `permissions?.update ?? true` line.
- Golden-diff, `edit: true` entities: rendered `FormView.tsx` before vs.
  after this template change is byte-for-byte identical (verified via a
  direct Jinja2 render of both the pre-fix template checked out from git
  `HEAD` and the current template, same `ctx`/`form_view_context()`
  output, `can_update=True`).
- Repo-wide: this repo's own `code_generator/json_schema.yaml` has no
  `edit: false` entity, so a full `generate-code` run before vs. after
  this change (and the sibling `actions.ts` fix) produces zero diff
  anywhere under `lib/`, `app/` (excluding the generated Prisma client),
  `components/`, `cypress/`, `messages/`, or `prisma/schema.prisma` —
  confirmed empirically via `git status` after `npm run cleanup` +
  `npm run test:e2e:build` (which reruns `generate-code`).
- New behavior, `edit: false` entities:
  `code_generator/tests/test_view_page_hides_edit_link_when_immutable.py`
  renders `form_view.tsx.jinja2` directly (same technique as the sibling
  `actions.ts` test) against a synthetic `edit: false` fixture and asserts
  `const canEdit = false;` is present and `permissions?.update` is absent
  from the rendered output entirely.
- This only closes the generator-level UI affordance. It does not modify
  or replace `npm run cleanup --prune-orphans`'s inability to
  automatically sweep an orphaned edit page whose entity's
  `x-generate.edit` flipped from `true` to `false` — that remains a
  known, separate limitation (see the sibling doc). This fix means an
  orphan that survives can no longer be *linked to* from the regenerated
  view page, and even if reached by another route, the Server Action it
  posts to now rejects the update intent instead of silently creating a
  duplicate.
