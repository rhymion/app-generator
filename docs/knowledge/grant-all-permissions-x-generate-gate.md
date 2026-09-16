# grant-all-permissions.ts and the generated UI now respect x-generate, not just RBAC

## The failure this closes

`scripts/grant-all-permissions.ts` (a development/verification tool, not
the production seed) iterated every name in `SEED_ENTITIES` and granted
the Administrator role a blanket `{create, read, update, delete,
import: true}`, without ever consulting that entity's own `x-generate`
configuration. Separately, the generated list page's create ("+") button
(`DataGridClient`/`CardListClient`) rendered on `permissions.create &&
allowCreate` where `allowCreate` reflected only whether the entity was a
bridge child, and the edit icon rendered on `permissions.update` alone —
neither checked `x-generate.new`/`.edit` at all.

The combination: an entity with `x-generate.new: false` or
`x-generate.edit: false` has no `app/[locale]/{parent}/new/` or
`.../edit/[id]/` page (`generate.py` never writes it) and no `POST`/`PUT`
handler in its API route — but `grant-all-permissions.ts` still granted
`create`/`update` anyway, and the UI still rendered the button/icon for
anyone holding that permission (whether granted via
`grant-all-permissions.ts` or by hand through the Permissions UI). Clicking
it 404s. Confirmed empirically on real schemas: this repo's own `user`
entity (`x-generate.new: false`, `delete: false`) and, re-measured directly
against the generated `SEED_ENTITY_GRANTS` object (not re-derived by hand)
for inventory-app: 9 entities with `x-generate.edit: false` —
`purchase_order`/`inventory_adjustment`/`inventory_movement`/
`inventory_reservation`/`sales_order`/`supplier_return`/
`goods_receipt_line_amendment`/`inventory`/`inventory_transaction` — and 4
with `x-generate.new: false` — `asn_status`/`inventory_transaction`/
`supplier_return_status`/`user`.

## Relationship to the prior `edit: false` UI-affordance fixes

This is the same underlying defect class two prior fixes already closed
in two other places, for the same real-world entity
(`purchase_order`) — see:

- `docs/knowledge/view-page-hides-edit-link-for-immutable-entities.md` —
  the **view page**'s "Edit" link (`FormView.tsx`) trusted
  `permissions?.update` alone; now hardcoded `false` at compile time when
  `can_update` (`x-generate.edit`) is `false`.
- `docs/knowledge/create-only-upsert-rejects-update-intent.md` — the
  **Server Action** (`upsert{Parent}()`) silently created a duplicate row
  if reached with an `id` on a create-only entity; now throws.

Those two fixes covered the detail/view page and the write path. This fix
closes the two remaining gaps in the same pattern: the **list page**'s
create button and edit icon, and the **dev permission-grant tool** that
can hand out the RBAC permission in the first place. All four fixes share
one lesson: `permissions.<op>` (RBAC, runtime, per-role) and
`x-generate.<op>` (build-time, per-entity, whether the page/route exists
at all) are orthogonal, and a UI affordance or a permission grant that
checks only the former can dangle. New generator-level code that renders
a button/link or grants a permission tied to create/update/delete should
check both.

## The fix

1. **`seed_entities_context()`** (`code_generator/generators.py`) now
   derives per-entity, per-operation grant flags from that entity's own
   `x-generate` block:

   ```
   create <- x-generate.new
   update <- x-generate.edit
   delete <- x-generate.delete
   read   <- x-generate.list OR x-generate.view
   import <- x-generate.import AND import_eligible (build_context.py's
             own formula: primary entity + x-import-key + (create OR
             update))
   ```

   Exported as `SEED_ENTITY_GRANTS: Record<string, SeedEntityGrant>` in
   the generated `scripts/generated/seed-entities.ts`, alongside the
   existing `SEED_ENTITIES` name list. `grant-all-permissions.ts` upserts
   each entity's own resolved grant instead of a blanket `true`; its
   `DRY_RUN` output reports granted/withheld per operation.

   Delete is included in this same treatment (not left blanket-true) for
   defense in depth, even though it was not independently observed to be
   user-visible (see below) — the script had zero prior test coverage, so
   there was no regression risk in also scoping it, and it keeps one
   consistent rule instead of a carved-out exception.

2. **`page_list.tsx.jinja2`** now always passes both `allowCreate` (true
   only when `x-generate.new` is enabled and the entity is not a bridge
   child) and a new `allowEdit` (true only when `x-generate.edit` is
   enabled) to the shared list component, replacing the previous
   bridge-child-only `allowCreate={false}` special case.

3. **`DataGridClient`/`CardListClient`/`ResponsiveListClient`** gain the
   `allowEdit` prop (mirroring `allowCreate`'s existing shape and
   default `true`). The edit icon/button now renders only when
   `permissions.update && allowEdit`.

Delete was **not** touched on the UI side for the desktop
(`DataGridClient`) layout: the list page already omits `removeAction`
when `x-generate.delete` is `false`
(`{% if can_delete %} removeAction={remove{{ Parent }}} {% endif %}`),
and `DataGridClient`'s toolbar delete button already checks
`permissions.delete && removeAction` — so a `false` `x-generate.delete`
already suppresses the delete button today on desktop, independent of
RBAC. This was directly confirmed (not assumed): with
`x-generate.delete: false`, manually forcing `permissions.delete: true`
in the database still shows no delete button.

**A known, deliberately unfixed gap in the same defect class**:
`CardListClient` (the mobile card layout) renders its own delete
button/checkbox purely on `permissions.delete`, with no
`removeAction`-style structural check at all — a live instance of the
exact same "permission true, `x-generate` false, affordance dangles"
pattern this fix closes elsewhere, specific to the mobile layout. Not
fixed here: widening scope beyond the create/edit affordances actually
verified live was not requested, and this was found only while writing
this fix, not independently verified against a real schema the way the
rest of this document's claims are. Left for a follow-up decision
(fix vs. issue) rather than fixed unilaterally.

Export and Import buttons are similarly unaffected —
both are compile-time-omitted from the page entirely when their
`x-generate` flag disables them (`{% if can_api and can_list and
can_export %}` for `ExportCsvButton`, `{% if import_eligible %}` for
`ImportModal`), never gated by RBAC alone the way create/update were.

## A distinct pitfall found along the way: Jinja2's `.` accessor and `dict.update()`

`seed_entities.ts.jinja2` originally read each entity's grant with
Jinja2's `.` attribute accessor:
`{{ 'true' if seed_entity_grants[entity].update else 'false' }}`.

Jinja2 resolves `.` by trying `getattr()` before falling back to
`__getitem__()`. Python dicts have their own built-in `update()` method,
so `some_dict.update` resolves to that bound method object — always
truthy — instead of the dict's `'update'` key. Every entity's `update`
field silently rendered `true` regardless of the computed value,
defeating the whole point of step 1 above for exactly the one operation
it matters most for. `create`/`read`/`delete`/`import` do not collide
with any dict method name, so the same accessor style rendered them
correctly; only `update` was silently wrong.

This repo's own schema never exercises the buggy branch (no
`SEED_ENTITIES`-eligible entity here has `x-generate.edit: false`), and
neither `test_seed_entities_context.py` (tests the Python context
builder, never the template render) nor this repo's own
`generate-code` + build gate caught it — it surfaced only when
generating a real consumer schema (`purchase_order`, `x-generate.edit:
false`) and reading the actual rendered TypeScript text.

**Takeaway for any future template touching a dict whose keys might
collide with a dict method name** (`update`, `keys`, `items`, `values`,
`get`, `pop`, `copy`, `clear`, ...): use explicit `dict['key']` item
access in Jinja2, never `dict.key` attribute access, unless the
collision has been positively ruled out. A context-builder-level test
(asserting the Python dict has the right values) does not catch this —
only a test that renders the template and asserts the output text does.
`test_seed_entities_template_render.py` is the pattern to follow: render
the real template via `Environment(loader=FileSystemLoader(...))` +
`env.get_template(...).render(...)`, then assert on the rendered string.

## Scope and verification

- Regression tests: `code_generator/tests/test_seed_entities_context.py`
  (grant derivation, including the ordinary raw/view split-pair case vs.
  a genuine cross-entity proxy view for import eligibility),
  `code_generator/tests/test_seed_entities_template_render.py` (template
  render text, the `update`-accessor regression specifically),
  `scripts/grant-all-permissions.test.ts` (the TypeScript script against
  this repo's own regenerated `seed-entities.ts`), and component tests
  in `DataGridClient.test.tsx`/`CardListClient.test.tsx` for `allowEdit`.
- Confirmed live (screenshots via `next build` + `next start`, never
  `next dev` — see
  `nextdev-turbopack-mock-oauth-sentinel-failure-use-build-start.md`):
  this repo's own `user` entity shows no "+" button (`x-generate.new:
  false`), contrasted against `role`'s list page, which shows both a "+"
  button and a per-row edit icon (both enabled). Inventory-app's
  `purchase_order` (`x-generate.edit: false`) shows no per-row edit icon
  at all — verified under the actual worst case the shadowing gap below
  produces naturally (no need to hand-force anything in the database):
  its `permission.update` row was already blanket `true`, granted by
  inventory-app's own **unfixed** `prj/scripts/grant-all-permissions.ts`
  override (see below), and the UI-side fix (items 2-3) suppressed the
  icon anyway.
- Export/Import (`ExportCsvButton`/`ImportModal`) are gated at compile
  time in `page_list.tsx.jinja2` (`{% if can_api and can_list and
  can_export %}` / `{% if import_eligible %}`) — the import statement and
  JSX are absent from the generated file entirely when the flag is off,
  never merely runtime-hidden behind a permission check the way
  create/update were. This predates this fix and is unrelated to it, and
  structurally cannot exhibit the "permission granted, button dangles,
  click 404s" failure this fix closes. No entity across this repo's,
  inventory-app's, or insurance-app's real schemas currently declares
  `x-generate.export: false` or `.import: false` to demonstrate it live
  end-to-end; a scratch-entity attempt in an isolated inventory-app
  worktree was abandoned because a genuinely new entity needs a matching
  Prisma model first (`derive_raw_entity()` looks up `prisma_models
  [entity_key]`) — out of scope for a throwaway check. `can_export`'s own
  boolean (`build_context.py`'s `gen_cfg.get('export', True)`) has no
  direct unit test anywhere in the suite (grep-confirmed) — a pre-existing
  gap, unrelated to this fix, flagged here rather than fixed (out of this
  task's scope).
- Regression risk (this repo, inventory-app, insurance-app):
  `db:grant-all-permissions` is invoked by **no** automated pipeline
  anywhere — `test:e2e:build` and every other CI-facing script use
  `db:seed-baseline` instead (grep-confirmed across all three repos'
  `package.json`). The only place it is called from a test is
  inventory-app's own `test/flows/seed-demo.test.ts` `beforeAll`, which
  asserts only `exit code 0`, not which permissions were granted — and
  that call goes to inventory-app's own **unfixed** override (see below),
  so this fix changes nothing about what that `beforeAll` does. A prior
  report saw this exact command exit 1 in a separate investigation, but
  that report's own follow-up already attributes it to a concurrent
  process disturbing the shared tree it ran against mid-rerun (a
  different, unrelated subprocess's generate-code/cleanup call
  transiently removing generated files), not a code defect, and
  classifies it as an unrelated subsystem from what that investigation
  was scoped to. Independently re-run here, directly, against an isolated
  worktree carrying this fix: exit 0, "Granted full CRUD to Demo role for
  32 entities" — consistent with the prior report's own diagnosis that
  this is an environment/concurrency artifact, not something this fix
  causes or could have fixed either way, since the override this test
  actually calls is untouched by it.

## A shadowing gap this fix cannot close by itself

Both inventory-app and insurance-app maintain their **own**
`prj/scripts/grant-all-permissions.ts` override (a consumer-owned file,
copied verbatim over this repo's script by `prj_sync.py` on every
`prj:sync` run) that grants permissions to a different role set (a
`Demo` role for inventory-app; six department roles for insurance-app)
and imports only `SEED_ENTITIES`, never `SEED_ENTITY_GRANTS` — it still
grants a blanket `true` for every operation, exactly the bug this fix
closes upstream. Because `prj_sync.py` copies `prj/scripts/*` over this
repo's `scripts/*` unconditionally, this fix's permission-side half (item
1 above) will not take effect for either consumer's own override role(s)
until that consumer-owned file is separately updated to consume
`SEED_ENTITY_GRANTS` — an out-of-scope, consumer-repo-side follow-up.
The UI-side fix (items 2-3 above) is **not** shadowed this way: neither
consumer overrides `components/_standard/DataGridClient.tsx` or
`page_list.tsx.jinja2` in `prj/`, so it reaches both consumers' Demo/
department-role users regardless of what their own grant-all-permissions
override does — the more load-bearing of the two defenses for exactly
this reason.
