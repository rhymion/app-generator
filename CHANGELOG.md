# Changelog
All notable changes to this project will be documented in this file.
The format is based on Keep a Changelog (https://keepachangelog.com/),
and this project adheres to Semantic Versioning (https://semver.org/).

## [4.0.0] - 2026-09-16

### Fixed
- **A `vercel.json` that lost its `regions` key (or predates it) was never
  repaired by `generate-code`**: `_write_vercel_json_crons` in
  `code_generator/generate.py` already reads back and patches this
  otherwise hand-authored file (for the `crons` key), but a missing
  `regions` key was previously left absent forever. It now self-heals: a
  missing `regions` key is backfilled with the single-region default
  (`['sin1']`); an existing value -- whatever it is -- is never touched.
  Covered by new cases in `code_generator/tests/test_vercel_json_crons.py`.
  See `docs/knowledge/vercel-region-alignment.md`.
- **An unreachable Redis crashed the whole `/api/auth/*` surface instead of degrading**
  (Issue #587): `lib/rate-limit/redis.ts`'s `check()` had no error handling around its
  `ioredis` `eval` call, so a Redis outage produced an uncaught exception on every
  credential/OAuth sign-in and callback request. The Redis adapter now fails OPEN on any
  error — availability over the marginal brute-force protection lost while Redis is down —
  and always logs the degraded window (`console.error`, tagged `[rate-limit:fail_open]`) so
  the fallback is never silent. Covered by a new test in `lib/rate-limit/redis.test.ts`.
- **OAuth+MFA second-factor Server Action had no rate limiting** (Issue #588):
  `completeMfaChallenge` (`app/[locale]/mfa-challenge/actions.ts`) isn't reachable through
  `proxy.ts`'s `/api/auth/*` rate-limit matcher — it's a normal page route's Server Action —
  so it had zero protection against a stolen-session attacker brute-forcing the
  TOTP/recovery code. Added a new `auth:mfa:challenge` rate-limit bucket (10 attempts / 5
  min, `lib/rate-limit/index.ts`), keyed by the session's user id rather than IP: the
  attacker already holds a valid first-factor session and can rotate IPs, but not the
  session's user id. Surfaces a new `RATE_LIMITED` error on the challenge page. Covered by
  a new `app/[locale]/mfa-challenge/actions.test.ts`.
- **`grant-all-permissions.ts` (dev/verification tool) granted an operation regardless of
  that entity's own `x-generate` configuration**: it iterated every `SEED_ENTITIES` name and
  granted a blanket `{create, read, update, delete, import: true}`, never consulting
  `x-generate.new`/`.edit`/`.delete`/`.list`/`.view`/`.import`. When an operation is disabled
  (e.g. `x-generate.new: false`), `generate.py` never writes the corresponding page/route, but
  the Administrator role still received the permission — so the generated UI showed an
  affordance (the list page's "+" button, and the edit icon) that 404s when clicked, directly
  undermining demo usability. `seed_entities_context()` (`code_generator/generators.py`) now
  derives a per-entity, per-operation grant from each entity's real `x-generate` block (the
  same `can_create`/`can_update`/`can_delete`/`can_list`/`can_view` formula
  `build_context.py`'s own per-entity context builder uses, plus `build_context.py`'s own
  `import_eligible` formula for `import`), exported as `SEED_ENTITY_GRANTS` in the generated
  `scripts/generated/seed-entities.ts` alongside the existing `SEED_ENTITIES` name list.
  `grant-all-permissions.ts` now upserts each entity's own resolved grant instead of a
  blanket `true`, and its `DRY_RUN` output reports granted/withheld per operation. Confirmed
  on real schemas: this repo's own `user` entity (`x-generate.new: false`, `delete: false`)
  and, re-measured directly against the generated `SEED_ENTITY_GRANTS` object for
  inventory-app: `purchase_order`/`inventory_adjustment`/`inventory_movement`/
  `inventory_reservation`/`sales_order`/`supplier_return`/`goods_receipt_line_amendment`/
  `inventory`/`inventory_transaction` (`x-generate.edit: false`, 9 entities) and
  `asn_status`/`inventory_transaction`/`supplier_return_status`/`user`
  (`x-generate.new: false`, 4 entities) now
  correctly withhold `create`/`update` instead of granting it. Regression covered by
  `code_generator/tests/test_seed_entities_context.py` and a new
  `scripts/grant-all-permissions.test.ts` vitest suite.
- **`seed_entities.ts.jinja2` silently rendered `update` as always `true`**: the template
  read each entity's grant with Jinja2's `.` attribute accessor
  (`seed_entity_grants[entity].update`). Jinja2 resolves `.` by trying `getattr()` before
  falling back to `__getitem__()` — and Python dicts have their own built-in `update()`
  method, so the accessor returned that bound method object (always truthy) instead of the
  dict's `'update'` key, defeating the fix above for exactly the one operation
  (`x-generate.edit` → `update`) it exists to scope correctly. `create`/`read`/`delete`/
  `import` do not collide with any dict method name, so they were unaffected by the same
  accessor style. This repo's own schema never exercises the buggy branch (no
  `SEED_ENTITIES`-eligible entity here has `x-generate.edit: false`), so it surfaced only
  when generating a real consumer schema and reading the actual rendered TypeScript text.
  Fixed by switching all five fields to explicit `['key']` item access. Regression covered
  by a new `code_generator/tests/test_seed_entities_template_render.py`, which renders the
  real template and asserts the output text (not just the Python context dict) — the prior
  test coverage never exercised the rendering step itself, which is exactly where this bug
  lived.
- **The generated list page's create ("+") button and edit icon rendered regardless of
  `x-generate.new`/`.edit`**: independently of the `grant-all-permissions.ts` fix above, the
  shared `DataGridClient`/`CardListClient`/`ResponsiveListClient` components gated the "+"
  button only on `permissions.create && allowCreate` (`allowCreate` previously reflected only
  whether the entity was a bridge child) and the edit icon only on `permissions.update`, with
  no structural check against `x-generate.new`/`.edit` at all — so any role granted
  create/update permission (via the Permissions UI directly, not only via
  `grant-all-permissions.ts`) saw an affordance that 404s when clicked. This is a second,
  independent defense layer: `allowCreate` now also reflects `x-generate.new`, and a new
  `allowEdit` prop (mirroring `allowCreate`'s shape) reflects `x-generate.edit`, both threaded
  from `page_list.tsx.jinja2` through all three shared list components. Delete was not part of
  this fix: the list page already omits `removeAction` when `x-generate.delete` is `false`, so
  `DataGridClient`'s `permissions.delete && removeAction` check already suppressed that button
  — this is a pre-existing, correct pattern this fix extends to create/edit, not a new
  mechanism. Confirmed with a live screenshot on inventory-app's `purchase_order`
  (`x-generate.edit: false`): with the Administrator role's `update` permission deliberately
  forced to `true` (simulating a hand-granted permission), the edit icon does not render.
- **Composite/dotted `labelField` on an embedded DataGrid child's own FK relation rendered
  blank (issue #539)**: `build_context.py`'s `child_include_entries` builder gave every FK
  relation on an embedded (`x-outputType != list`) child a flat `true` Prisma include,
  regardless of whether that relation's own `labelField` walks a nested relation (e.g.
  `inventory_id`'s `labelField: [item.sku, location.code, bin.code, ...]`). A flat `true`
  only fetches the FK target's own scalar columns, so any dotted `labelField` segment on the
  target's own relation (`item`, `location`, `bin`) rendered as `undefined` at runtime — the
  row displayed with 2-3 of its label segments blank. The same relation's independent list
  page (its own `get{Entity}Detail` getter) already built the correct nested include via
  `_include_entry_for_rel()`/`build_label_expression()`; the embedded-child code path never
  reused that logic. Now each embedded child's own FK relations get the same nested-include
  resolution, reusing the existing `_merge_into_child()` helper — simple (non-dotted)
  `labelField`s are unaffected (stay a flat `true`). Confirmed on real schemas: proj_g
  (`goods_receipt_line`, `inventory_reservation`, `shipment_line`, `asn_line` — 10 affected FK
  relations across 4 embedding parents) and proj_c (`purchase_per_item`, `receiving_receipt_line`,
  `asset_component` — 3 affected FK relations across 3 embedding parents) now produce Prisma
  includes byte-identical to the corresponding independent entity's own getter. Regression
  covered by `code_generator/tests/test_embedded_datagrid_child_dotted_labelfield_include.py`
  (nested-include boundary, and cross-checked against the independent entity's own include).
- **`format: date`/`time` on an embedded DataGrid child's own field always displayed a
  fixed `YYYY-MM-DD HH:mm` (issue #540)**: `generators.py`'s `column_def_context` (the
  embedded-child `GridColDef` builder) hard-coded `dayjs(value).format('YYYY-MM-DD HH:mm')`
  and MUI column `type: 'dateTime'` for every `format: date`/`date-time`/`time` field,
  ignoring the field's own declared `format`. A `format: date` column showed a spurious time
  component, and a `format: time` column showed a spurious date component. Now reuses the
  shared `formatLabelValue()` helper (`lib/_format.ts`, already used by the independent list
  page's `DataGridClient`) so the displayed format matches the field's own `format`; the MUI
  `type` is aligned too (`'date'` for `format: date`, unchanged `'dateTime'` for
  `date-time`/`time`, since MUI's DataGrid has no dedicated `time` column type). The dead
  `show_date_str` variable (computed but never interpolated into the generated output) is
  removed. `date-time` columns render identically to before (unaffected). Confirmed on real
  schemas: proj_g (`purchase_order_line.requested_delivery_date`, `asn_line.expiry_date`,
  `goods_receipt_line.expiry_date`) and proj_c (`parent1_child2.start_date`/`end_date`).
  Regression covered by `code_generator/tests/test_embedded_datagrid_column_date_format.py`
  (`date`/`date-time`/`time` MUI column type and formatter, `date-time` unaffected).
- Investigated a third, related gap flagged during the above (embedded-child DataGrid columns
  never call `get_uri_kind()`, so an `x-uri-kind: link` field would render as plain text
  inside an embedded DataGrid while the independent list page renders it as a link) and
  confirmed it is **not a bug**: this exact branch was already deliberately decided and gated
  (PR#406) — `column_def_context` keeps both `link` and `image` URI kinds as a plain editable
  text cell in every embedded-child DataGrid, on the ruling that a URL is legitimate to type
  into an editable cell (unlike an image, which never renders inside any grid cell anywhere in
  this codebase). Covered by the existing `test:uri-kind-gate` fixture (gate step 13). No code
  change made for this item.

### Added
- **An independent child (own `x-generate`) may now be embedded in a parent's view with any
  non-`list`, non-`comments` `x-outputType`, even when its own `x-generate` disallows
  new/edit/delete** (issue #520). The parent-embedded display stays read-only regardless.
  `x-outputType: comments` keeps its prior restriction. See
  `docs/knowledge/schema-yaml-configuration.md` §7.4.
- **New entity-level schema key `x-write-locked-values` declares field values that only the
  system may write, independent of `x-approval`.** Composes (union) with `x-approval`'s locked
  values — existing `x-approval` entities are unaffected. **Defaults to *unlocked* on a proxy
  view** (opt back in by declaring the key on the view itself). **Renamed**:
  `derive_approval_locked_values()` → `derive_write_locked_values()`;
  `APPROVAL_LOCKED_FIELDS`/`ApprovalLockedField` → `WRITE_LOCKED_FIELDS`/`WriteLockedField` in
  `service_validation.ts` and the CSV import route (its `APPROVAL_LOCKED_VALUE` error code string
  is unchanged). See `docs/knowledge/x-write-locked-values-field-lockdown.md`.
- **Post-decision row freeze now also applies to a *terminal* rejection, not just approval.**
  **Behavior change**: an entity declaring `on_rejected.terminal: true` now rejects
  edit/delete/invalidate (`403 *_forbidden:approval_locked`) on a row at that terminal value,
  where it previously allowed it. A non-terminal rejection or withdrawal still releases the lock
  as before. See `docs/knowledge/appendix/approval-flow.md` §16.15/§16.18.
- **New pre-generation check (`validate_submit_on_default_matches_prisma()`) flags a
  value-level mismatch between an `x-approval.submit_on` field's JSON `default:` and its Prisma
  `@default(...)`** — the existing cross-schema check only checked *presence*, not value
  agreement. Scoped to `submit_on` fields only.
- **Opt-in `binField` on `x-ledger-entities.<domain>`**, a fifth pool-entity column alongside
  the existing required `itemField`/`locationField`/`lotField`/`expirationField` (all still
  required; this key alone is optional). Omitting it is a no-op (byte-identical output). See
  `docs/knowledge/appendix/inventory-reservation-split.md` §7.3.
- **Eight in-tx write hooks now exist**: `afterCreate`, `afterUpdate`, `afterDelete`,
  `validateOnDelete`, `afterSubmit`, `beforeApprove`, `beforeReject`, `beforeWithdraw` — every
  `can_create` entity gets a no-op-by-default stub for each, called inside the write's own
  transaction (a throw rolls back everything). **Behavior change**: a non-audited entity's
  `delete{Entity}` is now wrapped in its own transaction for the first time (previously several
  independent, non-rollback-linked calls). See `docs/knowledge/post-create-side-effect-hook.md`.
- **`validateCustomRules()` now also receives the pre-edit row and the acting user's id
  (`actorId`) as a 5th parameter** — lets a hand-written rule reject a save based on what a
  field WAS, or stamp a system-owned row with the actor. Existing hand-written
  `service_validation_custom.ts` files need no edit. See
  `docs/knowledge/pre-edit-row-handoff-to-custom-validation.md` and
  `docs/knowledge/actor-id-handoff-to-custom-validation.md`.
- **README.md/README_ja.md sync gate** (`npm run check:readme-sync`) — fails closed if a
  branch's diff touches one file without the other. Added as a Completion gate step in
  `add-component.md`, `generate-schema.md`, `update-code.md`, `update-generator.md`. See
  `docs/knowledge/readme-en-ja-sync-gate.md`.
- **`x-filter-values`: view-scoped row restriction, enforced server-side on read and write.** A
  view entity can declare `x-filter-values: { field: [values], ... }` to restrict which rows it
  shows and can write to. A write to a row already outside the view is rejected (`404`).
  Composes with org isolation and `x-self-only` via AND. See
  `docs/knowledge/filter-values-row-scope.md` and `.claude/commands/generate-schema.md`'s
  "x-filter-values" section.
- **Withdraw lockout for entities that never declare `x-approval.on_withdrawn`**, plus a new
  structural validation (`_validate_x_approval_combinations()`) enforcing a truth table over
  `submit_on`/`on_withdrawn`/terminal-`on_rejected`/editability. Withdrawal is blocked at the
  API (`400`) and Server Action layers for entities lacking `on_withdrawn`, and the Withdraw
  button is hidden for them. **Breaking for schema authors**: an invalid combination now raises
  a generation-time `ValueError` naming the entity and failed condition. See
  `docs/knowledge/appendix/approval-flow.md` §16.16.

### Removed
- **Field-level schema key `x-fk-constrained`** (added in #484). The key
  excluded an optional many-to-one FK field from the generated "3.1 adds
  optional data and child items" test's per-field autofill when the
  field's valid values depend on another field on the same row. Reverted:
  no consumer schema declares it as of removal, and the one prior
  consumer usage (an inventory-tracking app's `shipment_line.inventory_id`)
  had already been made a required column with a different fix, which on
  its own retired the need for the key (see that consumer's own schema
  comment on the field). `code_generator/tests/test_fk_constrained.py`
  (4 dedicated tests) is removed with it.

### Fixed
- **A datagrid child's self-referencing FK (e.g. `goods_receipt_line.parent_goods_receipt_line_id
  -> goods_receipt_line`, an `x-splittable` `parentField`) no longer pulls the datagrid's own
  parent/ancestor entity in as an extra, org-blind dependency row** (issue #531). The "FK deps
  needed by datagrid children" loop in `helper_context()`
  (`code_generator/generators_test.py`) walked `resolve_dependencies(target, schema)` for every
  autocomplete FK target unconditionally, including a self-referencing FK whose target is the
  datagrid child's own entity type. That walk followed the child's own other required FKs (e.g.
  `goods_receipt_line`'s own `goods_receipt_id -> goods_receipt`) and registered the datagrid's
  own parent entity as an independent dependency outside any org scope, inflating
  `populateXxxDependencies()`'s created-row count every time it ran and breaking org-count
  assumptions in generated tests (`goods_receipt.cy.ts`'s "1.2 returns page with items" and "N3
  only returns rows from the caller's own organization"). Fixed by skipping a datagrid-child
  field's `dep_target` entirely when it equals the child's own entity type, before any
  resolution happens -- narrower than a prior related fix (issue #531) for a related
  `ReferenceError`, which reordered this same dependency without removing it. Two regression
  tests locking in the ordering fix's specific behavior are updated to assert the new (narrower)
  behavior instead.

  The same unconditional "target is a real dependency" assumption was independently duplicated
  in two more places in `generators_test.py` that also iterate a datagrid child's autocomplete
  FK fields, and both had to be given the identical skip: the `fields_prisma` builder for
  `populate{Parent}{Child}Data()` (the generated "add a child row to an existing parent" test
  helper) still emitted `parent_goods_receipt_line_id: deps.parentGoodsReceiptLine.id` even
  after the fix above removed `parentGoodsReceiptLine` from `deps` -- a dangling reference that
  crashed every UI e2e spec exercising datagrid-child add/edit (`goods_receipt.cy.ts`'s "2.1"
  through "6.2") with `TypeError: Cannot read properties of undefined (reading 'id')`; and the
  `has_child_fk_deps` flag (gates whether a `deps` object is declared and populated at all)
  still counted a self-referencing FK as a real dependency, which would have produced a false
  `has_deps: true` for the (currently hypothetical) case of a datagrid child whose *only*
  autocomplete FK is such a self-reference. Since this class of FK is always nullable (a
  splittable `parentField` cannot be required -- the first, unsplit row has nothing to point
  at), the correct behavior in the row-creation helper is to omit the field from the `create()`
  call entirely, leaving it at its natural `null`.

- **An independent child (own `x-generate` permitting new/edit) embedded in a parent with a
  non-`list` `x-outputType` is now read-only from the parent's edit form too, not just its view
  page** (issue #520/PR#528 follow-up). PR#528's own verification above covered only the view
  page's `FieldsViewGrid` rendering; the edit page (`FormUpsert.tsx`) still built a fully
  writable `DataGridClient` for such a child (add/edit/delete, `EntityAutocompleteCellConfig`
  FK pickers), and the parent's own service still emitted `child_nested_create`/
  `child_nested_update` for it. Root cause: `build_context.py`'s `is_independent` flag was
  gated on `output_type == 'list'` -- harmless before PR#528 (that combination was previously
  impossible), stale once PR#528 allowed it. Fixed by removing the gate and narrowing a new
  `write_ch` (excludes an independent, non-connect child from every write-path site regardless
  of output_type) while leaving the broader `embedded_ch`/`ctx['non_comment_ch']` (needed for
  column-hook generation) unchanged; `FormUpsert.tsx` now renders such a child via the same
  read-only `FieldsViewGrid` + `use{Prop}Columns(false)` FormView.tsx already used. Two related
  dead-prop leaks sharing the same root cause (a self-referencing child's own relation target
  leaking into places that assume a target is never the child's own name) were found and fixed
  alongside it: `context.py`'s `all_option_targets`/`child_rel_targets` and
  `build_context.py`'s `_get_selection_targets()` both produced a dead
  `initial{Child}s`/`search{Child}Options` `FormUpsertProps` pair nothing in the generated
  component ever used. Verified end-to-end through an isolated scratch fixture (independent
  non-list child sharing an FK name with its parent, plus a self-referencing FK) run through
  the real `build_user_schema.py` -> `generate.py` -> `prisma generate` -> `tsc --noEmit`
  pipeline: the generated service's add/update functions no longer reference the child, `tsc`
  is clean, and no dead props remain.
- **Two real-schema-only regressions from the independent-read-only-grid-child fix above
  (issue #520/PR#530), plus a pre-existing, unrelated generated-test-helper defect it exposed
  (issues #531, #532):**
  - A generated Cypress test helper (`cypress/support/<entity>/helper.ts`) could throw
    `ReferenceError` at runtime: the datagrid-child FK-dependency-extension loop in
    `generators_test.py` re-derived a sibling FK's already-registered dep variable name as
    `to_camel_case(<target>)` instead of looking it up, producing a dangling reference whenever
    a self-referencing child shares that target through its own relations (e.g. a
    `destination_bin_id -> bin` FK alongside a `parent_line_id` self-reference on the same
    child). Pre-existing in `generators_test.py`, unrelated to PR#530 — reproduces identically
    against the commit immediately before it.
  - `normalizeChildRefs` could be imported into a generated `service.ts` with nothing left to
    reference it: the import gate checked the unnarrowed `has_non_comment_ch` instead of
    whether the actually-rendered `snapshot_child_mappings` (built from `write_ch`, which
    PR#530 narrows) is non-empty.
  - A generated `FormUpsert.tsx` could destructure unused `initial{Xxx}s`/`search{Xxx}Options`
    props: `FormUpsertProps`' target-exclusion logic already dropped a target reachable only
    through a readonly or undisplayed *parent-level* relation, but had no equivalent exclusion
    for a target reachable only through a read-only independent grid child's *own* FK field.
  Both PR#530-introduced cases are fixed by keying off the actual narrowed
  (`write_ch`/`readonly_indep_grid_ch`-aware) state instead of the unnarrowed one; the
  pre-existing helper.ts defect is fixed by looking up each FK dependency's registered variable
  name instead of re-deriving it.
- **A second, previously-masked `ReferenceError` in the same generated test helper (issue
  #531), exposed only after the `bin` fix above let execution reach it:** `helper_context()`'s
  datagrid-child FK-dependency-extension loop calls `resolve_dependencies()` for a child's own
  self-referencing FK target (e.g. `goods_receipt_line.parent_goods_receipt_line_id ->
  goods_receipt_line`). That nested call has no notion of the *outer* model the whole helper is
  for, so when the child also carries an ordinary required FK back to that outer model (e.g.
  `goods_receipt_line.goods_receipt_id -> goods_receipt`), the nested resolution walks straight
  through it and injects a dep entry whose `target` happens to equal the outer model's own name
  — indistinguishable, by the existing `target == model_name` check, from a genuine
  self-referencing FK on the outer model itself. That misclassification deferred the dep's
  creation to `populate{Pascal}Dependencies()` (run *after* `_create{Pascal}BaseDeps()`
  returns), while the child's own dep that needs it as an FK is non-self and rendered *inside*
  `_create{Pascal}BaseDeps()` — a forward reference to a not-yet-declared variable, thrown only
  at runtime. Fixed by classifying self-ref deps on an explicit tag set only by the two
  deliberate self-ref-injection code paths, instead of on `target == model_name` alone; a dep
  that reaches that shape via nested transitive resolution is now treated as an ordinary
  non-self dep, created in the same function, in the list-order position it was already
  appended at (always before the dependent that needs it). Regression test:
  `code_generator/tests/test_datagrid_child_selfref_grandparent_backref_ordering.py`.
  A related, separately-tracked defect this fix exposes in turn (the same decoy record now
  created successfully also counts toward the outer entity's own-organization row totals in two
  generic CRUD/export tests) remains open — see issue #531 for status.
- **An embedded DataGrid child's column order now follows its own `x-display.form` declaration
  when present** — order only; which columns are shown is unchanged (still governed by the
  existing exclusion rules: `id`/`{parent}_id`/`created_at`/`updated_at`/`creator_id`,
  `one-to-one_bridge` FKs, unrelated `*able_id` FKs). Any field not named in `x-display.form`
  keeps being shown, appended after the named ones in their original schema order; a name in
  `x-display.form` this child has no property for (e.g. parent info) is never newly shown.
- **The generated submit-for-approval Server Action (`submit_for_approval.ts.jinja2`,
  the standalone action for `x-approval.submit_on` — the only path an
  `edit: false` entity has to ever reach it) no longer throws across the
  `'use server'` boundary, and its caller no longer discards the
  result.** Two independent gaps had to close together: the action threw
  every failure (including a reservation-capacity rejection) straight past
  React's Server Components boundary, which strips the message in
  production; and `ApprovalSection.tsx`'s Submit button fired the action
  without `await`ing it or reading any result, so even a correctly
  returned failure had nowhere to go. The action now returns the same
  `ActionFailure` shape the ordinary create/update actions already use
  (`AppError` → its own `code`/`field`/`reason`; the reservation-specific
  capacity error → `CAPACITY`; anything else — deliberately, so a new
  exception type never needs a template change — the field-less `UNKNOWN`
  code, never re-thrown). `ApprovalSection.tsx` now awaits the action
  inside its own pending-tracked transition, disables the button while in
  flight, and displays the failure inline via a new shared
  `getErrorMessage()` helper in `lib/_errors.ts`. See
  `docs/knowledge/error-message-framework.md`. A side-effect regression
  this surfaced and fixed: wrapping the Submit button in a `<span>` (the
  standard pattern for a `Tooltip` whose child can become disabled) while
  the button also carried its own `aria-label` produced two DOM elements
  with the same accessible name — `Tooltip` clones its `title` onto an
  immediate child that has none of its own. The button's now-redundant
  explicit `aria-label` was dropped; its own visible text already supplies
  it.
- **Optional (nullable) enum fields with no `default:` no longer seed the
  first enum member on the "new" form.** `build_context.py:_default_value()`
  (top-level create page) and `generators.py:_new_prop_val()` (DataGrid-child
  new-row seed) each had a gap where an untouched nullable enum field was
  silently pre-filled with its first declared value -- for nativeEnum fields
  only on the top-level path (the DataGrid-child path already checked
  nullability correctly), and for plain (non-nativeEnum) string-enum fields
  on both paths. An untouched optional field now stays unset (`null` for
  nativeEnum, `''` for plain string-enum) instead of fabricating a choice
  nobody made; fields with an explicit `default:` are unaffected, and
  required fields still fall back to the first enum member. Verified via
  golden-diff (regenerating this repo's own dogfood schema produces
  byte-identical output across all 240 generated files) plus an empirical
  before/after check on a temporary scratch field (reverted before commit)
  on both a top-level and a DataGrid-child entity.
- **`sharp`/`baseline-browser-mapping` CVEs resolved** via non-breaking
  `npm audit fix` (GHSA-rgj7-g3m4-5g8c, high, libheif via `next`'s
  transitive dep on `sharp`; GHSA-w5vr-8v7q-w6rv, moderate, via
  `eslint-config-next`'s dependency on `baseline-browser-mapping`). Both
  were newly-published advisories, not a regression from any change in
  this repo. `npm ci` still exits 0 after the lockfile update.
- **~13 more unused-variable lint-gate warning sources root-caused**,
  continuing the pattern documented in
  `docs/knowledge/cmd607-generator-lint-debt-fix.md` (an import or
  parameter declared unconditionally, while the template branch that
  actually reads it is narrower) — across `actions.ts.jinja2`, `service.ts`
  utility imports, `search_helpers.ts.jinja2`, `chart_getters.ts.jinja2`,
  `column_def.tsx.jinja2`, `form_view.tsx.jinja2`, `form_upsert.tsx.jinja2`,
  `getters.ts.jinja2`, three `service_after_*_stub.ts.jinja2` write-once
  stubs, and three generated-cypress-test templates plus the pool
  reservation test helper template. None of these branches are exercised
  by this repo's own `json_schema.yaml` (no x-approval/x-mention/
  commentable/many-to-one-in-datagrid entity, per the approval-lockdown
  fixture's own header comment), so this repo's own lint gate never saw
  them; found and verified by generating against a real consumer schema in
  an isolated worktree (48 ESLint warnings dropped to 2, both in
  hand-written files outside generator scope; a manifest-hash diff
  confirmed only the intended entity-scoped files changed output, none
  added or removed). See
  `docs/knowledge/cmd607-generator-lint-debt-fix.md` for the full
  per-template breakdown.
- **`.env.example` now documents `IMPORT_MAX_ROWS`/`IMPORT_MAX_BYTES`**, the
  two env vars `api_import_route.ts.jinja2` reads to override the CSV
  import row/byte ceilings (defaults `5000` / `10485760` — 10MB). Neither
  was documented anywhere before, so a consumer that needed to change the
  limit had no way to discover the correct var name. Note the var names
  intentionally keep the opposite word order from the generated code's own
  constant names (`MAX_IMPORT_ROWS`/`MAX_IMPORT_BYTES`) — renaming either
  side would touch every generated `api_import_route.ts` across every
  entity, so the mismatch is called out in a comment at the constant
  declarations instead of renamed.
- **Internal role/honorific vocabulary removed from generator-authored
  comments** in `api_import_route.ts.jinja2` (and the two source-only
  files `schema_deriver.py`/`validate.py`, which don't ship but are
  maintained code) — reworded to English, design intent preserved,
  ticket/commit references (`cmd_NNN`) kept as-is.

- **CSV import now commits through the same `lib/{entity}/service.ts`
  functions the REST route and Server Action call, instead of a raw
  `tx.model.create/update`, for any entity whose signature carries no
  embedded-DataGrid-child or bridge-child-parent parameter (a flat CSV
  row has no per-row data source for either shape; those entities keep
  the prior raw-tx path unchanged).** Previously, import bypassed
  `validateOnAdd`/`validateOnUpdate` entirely, so a hand-written
  `service_validation_custom.ts` business rule -- and every
  `afterCreate`/`afterUpdate` side effect (audit logging, notifications,
  reservation allocation, approval edge triggers) -- never ran for
  import; a change the screen/API refuses could still be written through
  import. Confirmed end to end against a real consumer's seeded demo data:
  a purchase-order-line quantity edit the screen correctly rejects (its
  parent purchase order is not in draft status) previously imported
  successfully and now returns the same rejection through import. The
  import route's own former `WRITE_LOCKED_FIELDS`/`findLockedViolation()`
  duplicate of the `x-write-locked-values`/`x-approval` value-lockdown
  check is removed for this now-service-call-backed path -- the identical
  check already lives in `service_validation.ts`'s `validateSchemaRules`,
  which the shared functions call internally; it remains for the
  raw-tx fallback path, which still bypasses the service layer. An
  `AppError` thrown by the service layer is translated into a
  row-numbered `ImportRowError` (field + message) instead of collapsing
  into a generic write-failure string.

- **A composite/dotted-label FK's CSV-import candidate lookup now
  includes org-null rows when its target's own `organization_id` is
  optional**, matching the OR-null form the two sibling dotted-FK lookup
  branches in the same template already use. The composite-label branch
  had been left out of that earlier fix: a lookup entity whose
  `organization_id` is genuinely `NULL` on every row (a shared/global
  reference table, e.g. a seed script that deliberately leaves it unset)
  produced zero candidates for a composite label, and every import
  referencing it failed with a "no such row" error the row's data
  actually satisfied -- confirmed end to end against a real consumer's
  seeded demo data (a goods-receipt-line import naming an existing
  purchase-order-line by its composite label previously failed to
  resolve; now resolves). Golden-diffed against a from-scratch generation
  of a real consumer schema with no `organization_id`-bearing lookup
  targets: zero output changed.

- **A nullable plain-text field written as `''` now persists as `NULL`,
  the same as an omitted/never-set value, wherever
  `add{Parent}`/`update{Parent}` writes it (CREATE, UPDATE, and the data
  object passed to `validateOnAdd`/`validateOnUpdate`/
  `validateCustomRules`).** A blank text input, a JSON body that sends
  `""` instead of `null`, and CSV import's already-`null`-mapped empty
  cell had been producing two different persisted values for the same
  "no value" state depending on which write path produced them --
  silently breaking any later equality-match against the column, most
  concretely a hand-written `find`-then-`create` inventory lookup keyed
  in part on such a field: an existing `NULL`-valued row and a
  freshly-`''`-valued one never matched, so approving a second receipt
  line against a matching bin (with no lot number recorded) created a
  duplicate inventory row instead of adding to the existing one.
  Reproduced end to end against a real consumer's seeded demo data by
  calling the actual write path and post-approval hook: before this fix,
  a second goods-receipt-line approval with an unspecified lot number
  created a second inventory row; after, it adds to the existing row's
  quantity. Scoped to a plain nullable string column only -- not
  date/time, Decimal, or a Prisma-nativeEnum field (none of which treat
  `''` as a meaningful stand-in for "no value"), and never a non-nullable
  string field (`''` is a legitimate, distinct value there). Surveyed
  the mechanism's four generated write-side data-object builders for the
  same one-line pattern; not yet extended to DataGrid child-row nested
  create/update fields, a separate code-generation path -- flagged as a
  candidate for the same treatment if a child-row nullable-text column is
  later found to need it. Historical rows already holding `''` for such a
  column are unaffected by this fix (a data-migration concern, out of
  scope here).

- **An entity with `x-generate.edit: false` (create only, no update path)
  now throws instead of silently creating a duplicate row when its
  Server Action receives an existing record's id.** Previously, the
  create-only branch of `upsert{Parent}()` never read `id` off the
  incoming FormData at all and unconditionally called `add{Parent}()`.
  `FormUpsert.tsx` unconditionally sets `id` in FormData regardless of
  whether the entity is editable, so an orphaned edit page left over from
  before the entity's `x-generate.edit` flipped to `false` (and no longer
  regenerated) could still reach the create-only action with a real
  record id -- and the action silently created a duplicate instead of
  failing loudly. Reproduced against a real consumer's data: a
  `purchase_order`-shaped entity's orphaned edit page created a second
  row for the same purchase order instead of updating the original. The
  fix mirrors the existing symmetric guard on the update-only branch
  (`if (!id) throw new Error('Create not supported')`): a create-only
  body now throws `Error('Update not supported')` when handed a non-empty
  id, before any other work begins. Scoped to the create-only branch
  only -- no entity in this repo's own schema uses that combination, and
  a full generated-output diff before/after this change is byte-for-byte
  identical; see `docs/knowledge/create-only-upsert-rejects-update-intent.md`.

- **The generated view page no longer offers an Edit link for an
  `x-generate.edit: false` entity, regardless of the caller's
  `permissions.update` value.** Previously, `FormView.tsx` computed
  `canEdit` purely from `permissions?.update ?? true`, never checking
  whether the entity has an update path at all -- so an orphaned edit
  page left over from before `x-generate.edit` flipped to `false` could
  still be linked to from the regenerated view page whenever RBAC allowed
  it. `canEdit` is now hardcoded to `false` at generation time for a
  create-only entity, independent of `permissions.update`. Sibling fix to
  the `upsert{Parent}()` guard above -- same incident, same root cause;
  see `docs/knowledge/view-page-hides-edit-link-for-immutable-entities.md`.
  `edit: true` entities are unaffected: golden-diff confirms the rendered
  `FormView.tsx` is byte-for-byte identical to before this change.

- **A readonly field (`x-readonly` / `x-readonly-fields`) is no longer read
  from client input at all on save -- not FormData, not a POST/PUT body, not
  even as a generated service function's own parameter.**
  Previously, `_build_form_data_gets()` still emitted a `data.get(<field>)`
  line for every readonly field, and the REST routes still destructured it
  off the request body -- the value never reached Prisma (an existing,
  correct skip already excluded it from the write), but it still flowed
  into `validate()`/`validateCustomRules()` as if it were real client
  input. For a non-nullable field, `Number(null)` / `new Date(null)` /
  a bare cast silently produced a *wrong but valid-looking* value (`0`, the
  Unix epoch, or an empty string) instead of `undefined` -- so a
  hand-written custom rule that read the field directly (rather than
  `prevRow`, the actual persisted value) could see that fabricated value
  and reject a save that never touched the field at all. Reproduced
  end-to-end with a scratch entity: a `received_at` (readonly, non-nullable,
  required) field combined with a realistic content-freeze custom rule
  made every edit-and-save of an unrelated field throw
  `received_at is locked and cannot change` before the fix, and save
  cleanly after. `client_prop_infos` (a narrower view of `parent_prop_infos`
  excluding readonly fields, mirroring how `x-server-value`-without-override
  fields were already excluded) now feeds the service function's parameter
  list, `validate()`'s payload, `_build_form_data_gets()`, and the REST
  routes' body destructuring/service-call args; `parent_prop_infos` itself
  is unchanged and still feeds `normalizeSnapshot()`'s staleness
  comparison, which legitimately needs every persisted column. Confirmed
  for both a nullable and a non-nullable readonly field, and for a required
  relation FK. Unrelated, pre-existing behavior found (not fixed here,
  out of scope): the REST PUT route's readonly-field compare check
  (`AP-3=B`) can reject a same-valued resubmission of a readonly `date`/
  `date-time` field, because it compares `String(Date)` against the raw
  ISO string from the request body -- different textual formats for the
  identical instant.
- **A hand-written `service_validation_custom.ts` rejection of a value that
  IS present (e.g. an FK that violates a business rule) no longer renders
  as the generic "{field} is required." text a genuinely-missing value
  gets.** `AppError`/`ActionFailure` (`lib/_errors.ts`) gained a
  `reason?: 'missing' | 'invalid'` field for `VALIDATION`-coded errors; the
  generated `REQUIRED_FIELDS`/one-to-one-missing checks tag `'missing'`,
  every other schema-driven `VALIDATION` check (decimal format, dangling
  one-to-one FK, approval-locked field) and any hand-written
  `validateCustomRules()` rejection tag `'invalid'` (the generated
  `service_validation.ts` wraps the custom-rules call and re-tags it, so no
  existing consumer's hand-written file needs editing). `getErrorMessage()`
  (`form_upsert.tsx.jinja2`) now renders a distinct `fieldInvalid` i18n key
  for the `'invalid'` case. The REST API path (`handleApiError`) was
  already correct — it forwards `error.message` verbatim — this only fixes
  the Server Action / UI form path.
- **A field whose FK candidates are narrowed via `x-autocomplete-context`
  no longer offers an unfiltered default list before the user types
  anything.** `EntityAutocomplete.tsx` shows `initialOptions` verbatim
  whenever the input is empty; that list used to come from a static,
  context-blind page-load fetch. Context-filtered relations now seed from
  that same fetch but live-refetch through the context-aware search action
  (`searchXOptions('', [])`, still applying `filterAutocompleteOptions()`)
  on mount and whenever the sibling context field changes. Every other
  relation's generated code is unchanged.
- **A view's `x-readonly-fields` declaration no longer leaks onto every
  other view built on the same Prisma model.** `x-readonly-fields` used to
  be copied onto the shared raw entity during schema reconstruction
  (`build_user_schema.py`), and `build_context.py` read it back from that
  same raw entity — so a proxy/secondary view (e.g. a `setting` page that
  is really just another view of `user`) could not declare a readonly
  field without also locking it down on the model's other view(s).
  `x-readonly-fields` now stays on the view entity that declares it, and
  `build_context.py` reads it from the view entity itself. No current
  schema declares `x-readonly-fields`, so this is a scope fix with no
  observable effect until a schema actually uses it on a shared model; see
  `docs/knowledge/readonly-field-form-rendering.md` for the full writeup
  and `.claude/commands/generate-schema.md` for updated guidance on when
  to use `x-readonly-fields` vs. per-property `x-readonly`.
- **`x-readonly-fields`/`x-readonly` declared on a DataGrid child entity had
  no effect on that child's editable grid.** A readonly-declared child
  column still rendered as an editable cell, and the write path (child
  `create`/`update` body construction) still accepted and persisted
  client-sent values for it with no server-side guard. `generators.py`'s
  child-grid column builder now forces `editable: false` on a readonly
  column, the same pattern the `order` column already used.
  `build_context.py`'s per-child field mapping now excludes readonly
  fields from the `update` write payload entirely (an existing row keeps
  its current value) while still seeding a schema-derived default for
  `create` (a new row has no prior value to preserve). No current schema
  declares `x-readonly-fields`/`x-readonly` on a DataGrid child entity, so
  this is a fix with no observable effect on any existing schema; see
  `docs/knowledge/readonly-field-form-rendering.md` for the full writeup.
- **A CSV-import match key on an optional (nullable) plain scalar column no
  longer treats an empty cell and a stored `NULL` as different values.**
  `import_key_specs`' non-dotted branch hardcoded nullability to `false`
  regardless of the column's actual schema type (unlike the dotted branch and
  `import_field_specs`, which both compute it correctly for the same column),
  so re-importing a row whose key column was left blank never matched the
  existing `NULL` (or a legacy `''`) row and created a duplicate instead. The
  generated import route now normalizes an empty cell to `null` for the
  write, and matches either a stored `NULL` or `''` via a dedicated
  `keyMatchConds` array kept separate from the org-filter branches' own `OR`
  usage so the two conditions never collide. See
  `docs/knowledge/import-key-null-empty-equivalence.md`.

### Changed
- **Approval-request creation moves off the write-once `afterCreate` hook
  (`lib/{entity}/service_after_create.ts`, now retired) into an edge-trigger
  emitted directly into `service.ts.jinja2`'s generated `add{Parent}`/
  `update{Parent}`.** The trigger fires on the transition into a new
  `x-approval.submit_on: {field: value}` declaration's target value — at
  create time from "no row" (unconditionally, if `submit_on` is undeclared —
  the previous default), and at update time only on an explicit
  previous-value-differs / new-value-matches edge, never a level check. Both
  paths share a guard against a second open flow for the same approvable.
  `approval_flow.entity_name` now resolves through the entity's view key
  rather than its Prisma model, so a proxy view can carry its own
  independent approval flows even when it shares a model with other views;
  `resolve_target.ts`'s resolver and model lookup follow suit, while
  `on_approved_dispatch.ts`/`on_rejected_dispatch.ts` stay keyed by model
  (`x-approval` is a raw-entity-level declaration) with the server action
  translating between the two before dispatching. `resubmitApprovalRequest`
  (the dedicated server action, REST route, and its `ApprovalSection.tsx`
  button) is removed — re-submission after a non-terminal rejection is now
  an ordinary edit of the entity's own status field back to `submit_on`'s
  value, which fires the same update-time trigger a first submission fires
  at create time. See `docs/knowledge/appendix/approval-flow.md` §16.4/§16.6
  for the full mechanism, including a known gap: terminal rejection's
  "cannot resubmit" is a workflow expectation, not yet independently
  enforced against a direct status-field write.
- **`user.image` moved from a plain URL string to a direct-attachment FK
  (`x-relationship: {target: attachment, type: direct}`)** — the profile
  picture is now an uploaded file tracked as an `attachment` row (giving it
  the same storage-cleanup inventory every other direct-attachment field
  gets), not an arbitrary URL string. Consequences:
  - **OAuth sign-in no longer copies the provider's profile-image URL** into
    `user.image` (`lib/auth/create-user.ts`) — a user's avatar now comes
    only from their own upload. The `Session.user` type augmentation
    (`auth.ts`) no longer carries an `image` field (it would always resolve
    to `null` under the new shape; nothing in this app read it from the
    session).
  - `components/_standard/CommentListWrapper.tsx`'s avatar now resolves the
    comment creator's uploaded photo through the direct-FK relation
    (falls back to initials, as before, when absent).
  - Prisma: `user.image String?` → `user.image_id String? @unique` +
    `user.image attachment? @relation(...)`. `attachment` gains a
    back-reference field per direct-attachment declaration
    (`user_image user? @relation("UserImage")`); a new
    `validate_direct_attachment_reverse_fields` generate-time check
    fails closed if a `type: direct` declaration is missing its
    back-reference. See docs/knowledge/schema-yaml-configuration.md
    "Direct Attachment FK".
  - No data migration: pre-customer, no production users to preserve.
  - `asset.manual_url` (a consumer-schema field with the same
    misclassification) is out of scope here — tracked as a separate
    follow-up.

### Fixed
- **A proxy view (`parent != model`, e.g. a schema entity that `allOf`-wraps
  another entity instead of its own Prisma model) with `x-generate.list:
  true` never got a sidebar link, even though its list page, API route,
  getters, and search were already generated and working.** Three gates
  were all keyed on `parent == model`, which is false for every proxy view
  regardless of which one:
  - `generators_i18n.py`'s `nav_entities` filter — now just
    `generate_config.list`; a proxy view that should stay hidden opts out
    via its own `x-generate.list: false`.
  - `nav_config.py`'s `entity_group` — was keyed on `model`, so two proxy
    views sharing one model were forced into the same nav group/order.
    Now keyed on `parent` (the view/route name), and `x-nav` itself
    resolves at the view unit first (falling back to the raw model's
    `x-nav` when the view declares none of its own) — two proxy views
    sharing a model can now sit in independent nav groups/orders.
  - `generators.py`'s `seed_entities_context()` (drives
    `scripts/generated/seed-entities.ts`, consumed by
    `grant-all-permissions.ts`) required a direct `id` property, which
    structurally excludes every proxy view. `requirePermission()` checks
    each entity's own route name, not the underlying model, so this left
    every proxy view's own route permanently ungranted. Now excludes only
    an entity actually declaring `x-self-only: {admin_bypass: true}` (the
    framework's own `setting` is the only one that currently does) —
    schema-driven, not name- or structure-based.

  `cleanup.py:624` kept its own separate, narrower `parent == model` copy
  of this same predicate, unintentionally — see the follow-up fix below.
- **`cleanup.py` failed to retract a proxy view's sidebar nav entry**,
  leaving a dead link (pointing at a page `cleanup` had itself just
  deleted) after teardown. Root cause: `cleanup.py`'s own
  `_clean_appended_files` kept a separate literal copy of the
  `nav_entities` filter above, narrower (`parent == model`) than the one
  `generators_i18n.py` used to add the entry in the first place — a
  proxy view's entry was added but never selected for removal. Fixed by
  extracting the filter into a single `nav_config.nav_list_entities()`
  function that both sides now call; `parent == model` entities' existing
  cleanup behavior (e.g. `/user`, `/role`) is unchanged.
  See docs/knowledge/proxy-view-nav-and-permission-scope.md.
- **`GET /api/user/{id}` leaked the password hash and raw `api_key`** —
  `write_only_field_names`/`write_only_props` (`build_context.py`,
  `generators.py`) were computed from `filtered_props` (the subset narrowed
  by an entity's `x-generate.fields` allowlist) instead of the entity's
  full property set. `get{Parent}Detail()`'s Prisma query has no `select`
  clause, so it always fetches every column regardless of that allowlist —
  for an entity whose `fields` list happens to omit a write-only column
  (this repo's own `user` entity: `fields: [name, image_id, roles]`,
  `password`/`api_key` excluded), the write-only set computed empty and the
  unconditional `...user` spread in `getUserDetail()` returned the raw
  bcrypt hash and API key straight through the REST response body. Both
  call sites now derive the write-only set from `model_def.get('properties',
  {})` instead. Confirmed red (leaking) → green (stripped) by curl against
  `GET /api/user/{id}` and `GET /api/setting/{id}` in an isolated worktree.
  See docs/knowledge/code-generation-custom-extensions.md "Upsert-only
  fields are treated as write-only".
- **`db:createApiUserWithPermission` (test fixture) never enrolled its actor in
  any organization**, so the generated `4.4`/`4.5` FK-read-permission
  graceful-degradation tests (`test_api_spec.cy.ts.jinja2`) 404'd before
  reaching the scenario under test on any `should_filter_by_org` entity whose
  `organization` relationship is required — the membership-scoped
  organization-isolation existence check (`api_detail_route.ts.jinja2`)
  rejected the request first. The fixture now accepts an optional
  `organizationId` and, for `should_filter_by_org` entities, `4.4`/`4.5` pass
  the target row's own organization so the actor is a genuine member —
  reproducing "belongs to the organization but lacks read permission on the
  `organization` entity itself" rather than "belongs to zero organizations".
  Cross-organization isolation (`G3.1`-`G3.4`, which already used a separate
  fixture) is unaffected. See docs/knowledge/fk-read-permission-graceful-
  degradation.md.
- **`get_field_metas()` (test generator) mis-categorized a direct-attachment
  FK field as a plain text column** — the generic optional-field
  fill/clear/full-data-populate machinery (`test_spec.cy.ts.jinja2`,
  `cypress/support/{entity}/helper.ts`) tried to type a fake string value
  into it, which either found no matching form label (`SingleAttachmentUpload`
  isn't a labeled text input) or violated the FK constraint outright
  (`populate{Entity}FullData`). Direct-attachment fields are now excluded
  from this generic machinery, the same way an internal bridge FK already
  is. Uncovered until now because no entity in this repo's own schema
  combined `x-relationship: {type: direct}` with `x-generate.test: true`.
- **i18n key collection for a child table's column headers didn't recognize
  `type: direct`** (`generators_i18n.py`) — a direct-attachment field
  reachable as a many-to-many child's column (e.g. `user` as `role`/
  `organization`'s `users` child) got an unstripped `{field}Id` key instead
  of the same stripped-suffix key the field's own entity-level label uses,
  leaving a stray, unreferenced key in `messages/*.json`.
- **`build_anonymize_user_context()`'s PII-scrub field ordering anchor was a
  literal field name** (`'image'`) that silently stopped matching once that
  field was renamed to `image_id` — the Prisma-only fields it inserts
  (`emailVerified`, `mfa_secret`) would have fallen through to the
  end-of-object fallback instead of their documented position. Anchor
  updated to `'image_id'`.
- **The comment/mention creator avatar select in `build_context.py`
  unconditionally assumed `user.image` is a direct-attachment FK** (the
  shape this repo's own schema now uses) — a consumer schema that declares
  `x-mention: true` while `user.image` is still a plain `format: uri`
  string column (`type: direct` is opt-in per schema, not a repo-wide
  migration) failed to build (`TS2322`/`TS2551`) the moment it picked up the
  FK-shaped select. The select now branches on the consuming schema's own
  `user` entity; `types.ts.jinja2`'s three affected branches and the
  shared, non-templated `components/_standard/CommentListWrapper.tsx` now
  type `creator.image` as `{ path: string } | string | null` to match
  either shape. A new sibling fixture,
  `code_generator/tests/fixtures/mention_gate_plain_image/`
  (`npm run test:mention-gate-plain-image`), exercises the plain-string
  branch the original `mention_gate` fixture's own FK-shaped `user.image_id`
  never covered. See docs/knowledge/schema-yaml-configuration.md "user.image
  and the comment/mention creator avatar".

### Removed
- **`scripts/seed.ts` (`npm run db:seed`)** — unused ITS (issue-tracking-system)
  sample-data script. Not referenced by any npm script, prisma seed hook, or
  CI workflow; its only mention in the repo was a stale line in
  `docs/knowledge/troubleshooting.md`. No replacement; if a consumer project
  had a local, unrelated `npm run db:seed` invocation depending on this file
  existing, that invocation now fails.

### Changed
- **`scripts/seed-tenant.ts` renamed to `scripts/seed-baseline.ts`
  (`npm run db:seed-tenant` → `npm run db:seed-baseline`), and its
  neighboring credential-hardening files renamed to match**
  (`scripts/seed-tenant-credentials.ts` → `scripts/seed-baseline-credentials.ts`,
  `scripts/seed-tenant-credentials.test.ts` → `scripts/seed-baseline-credentials.test.ts`,
  `docs/knowledge/seed-tenant-credential-hardening.md` →
  `docs/knowledge/seed-baseline-credential-hardening.md`). The old name
  described a "tenant" concept this script has nothing to do with; the new
  name matches its actual job (seeding the baseline admin user/roles/
  permissions every environment needs). `seed.ts` was deliberately **not**
  reused as the new name (despite being freed up by the removal above) —
  `cy.task('db:seed')`, a same-spelled but unrelated Cypress test-database
  task backed by `cypress/support/db-helpers.ts`, would otherwise collide in
  meaning with `npm run db:seed`. No backward-compatible alias is provided
  (pre-customer, no shipped installs to preserve compatibility for).
  **Consumer impact**: any consumer project or script invoking
  `npm run db:seed-tenant` directly, or a `Bash(npm run db:seed-tenant)`
  permission entry in `.claude/settings.json`, must switch to
  `db:seed-baseline`.
- **Generated apps now default to blocking search-engine indexing.** Generated
  apps are primarily internal tools, and a Vercel production deployment (unlike
  a preview deployment) gets no automatic crawler protection. `app/layout.tsx`
  now sets `<meta name="robots" content="noindex,...">` unless
  `lib/site-config.ts`'s `seo.noindex` is explicitly set to `false` — and
  because the default flipped, an app whose `seo` block (or just `noindex`
  within it) is missing entirely is *also* noindexed, not indexed. See
  `docs/knowledge/noindex-default-and-branding-env-vars.md` for the mechanism,
  why `robots.txt` `Disallow` was rejected, and consumer-impact notes.
- **`scripts/seed-tenant.ts` now also seeds `Creator` and `Assignee` roles.** `Creator` is
  granted exactly `setting.read`+`setting.update`, letting a non-admin user reach their own
  `/setting` page via `x-self-only`; `Assignee` is seeded with no permissions (placeholder for
  future use).
- **Removed the dead in-process notification store from `lib/_notifier.ts`** (a no-op
  `Map`-based read path with zero production callers, plus its startup `console.log`).
  `notify()`'s write path is unchanged except its return type, now `void` (the return value was
  unused everywhere).

### Added
- **`x-relationship: { target: attachment, type: direct }`** — new single-file FK field
  declaration (a profile picture, a signed contract), rendered via `SingleAttachmentUpload`/
  `SingleAttachmentDisplay`. Unlike the existing `attachable_id` bridge, this `attachment` has
  no list/view/new/edit pages of its own. `attachment.attachable_id` is now nullable to allow
  this. See `docs/knowledge/schema-yaml-configuration.md` (Direct Attachment FK).
- **`x-uri-kind: file`** — a third `format: uri` field kind alongside `image`/`link`: uploads
  via `/api/upload` like `image`, but displays as a download link/icon instead of an `<img>`.
  Shares components with the direct-attachment FK above.
- **`NEXT_PUBLIC_APP_TITLE` / `NEXT_PUBLIC_APP_COPYRIGHT`** — optional env vars overriding the
  app title and footer copyright text without a code change. Inlined at build time (a Vercel
  rebuild, not just an env var edit, is needed to pick up a change). See
  `docs/knowledge/noindex-default-and-branding-env-vars.md`.
- **`x-scheduled-tasks`** (top-level, plural) — a bulk, entity-agnostic sibling of
  `x-scheduled-task`, for operations spanning many entities or an entire table with no row
  filter. Shares the task registry and `vercel.json` `crons` array with the entity-level form.
  See "Bulk mode" in `docs/knowledge/scheduled-task-operations.md`.
- **Docs-only changes now skip the Vercel build** for the three consumer projects, via
  `scripts/vercel-ignore-check.sh` + a root-level `vercel.json` stub (`ignoreCommand`) in each
  consumer repo — a Root-Directory-scoped `ignoreCommand` inside this repo's own `vercel.json` is
  never read by Vercel, confirmed empirically. See `docs/knowledge/vercel-docs-only-ignore-command.md`.
- **New `verify-canonical-ci` job in the canonical consumer `.github/workflows/ci.yml`** checks
  out the consumer's `app-generator` submodule and fails if its own body differs from the
  submodule's distributed `docs/consumer-commands/ci.yml` copy — closes the gap where a
  distributed copy silently drifted from canonical (a step's `name:` and several comments had
  already diverged). See `docs/knowledge/ci-workflow-canonical-source.md`.
- **New opt-in Stripe payment integration, gated by a new `x-payment` entity-level schema key.**
  Declaring `x-payment: true` writes three write-once stub files on first `generate-code`:
  `lib/stripe.ts`, `app/api/payment/checkout/route.ts`, and `app/api/webhooks/stripe/route.ts`
  (signature-verified). Scope is one-time purchases only; `.env.example` gains the three Stripe
  env var placeholders. See `docs/knowledge/stripe-payment-integration.md`.
- **`scripts/vercel-{setup,deploy,env,teardown}.sh` and `.env.vercel.production.local.example`
  promoted to a single canonical source**, replacing independently-drifting copies across
  app-template/inventory-app/insurance-app — also fixes a real gap found in the process
  (app-template's copy was missing `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`). See
  `docs/knowledge/vercel-deploy-scripts-canonical-source.md`.
- **New Prisma `Decimal` support in the code generator, mapped to JSON schema type `"string"`
  (never `"number"`)** to avoid silent float-rounding error on read/write/CSV round-trip —
  previously unsupported (`schema_deriver.py` raised `SchemaDivergenceError`). Spans schema
  derivation, form/CSV validation, the numeric-styled form input, and a new `test:decimal-gate`
  fixture (this repo's own schema has no Decimal field, so nothing would otherwise compile these
  branches).
- **New dev/verification-only script `scripts/grant-all-permissions.ts`**
  (`npm run db:grant-all-permissions`) grants the `Administrator` role full CRUD on every
  independent entity in one step, including any entity a consumer project adds. `audit_log`/
  `mfa_recovery_code` stay excluded. `scripts/seed-tenant.ts` (the production seed) is unchanged.
  See `docs/knowledge/seed-baseline-credential-hardening.md`.
- **New opt-in Neon serverless driver adapter for `lib/prisma.ts`, gated by `USE_NEON_ADAPTER`.**
  `scripts/vercel-env.sh` now injects it as `"true"` on every consumer app provisioned via
  `vercel-setup.sh`; unset or any other value falls through to the existing `PrismaPg` path
  unchanged. GCP Cloud Run and local/CI are unaffected.
- **New `npm run lint:prj` script (`scripts/lint_prj_synced.py`)** lints only a consumer's own
  `prj/`-tracked `.ts`/`.tsx` files at their real synced destination paths, without linting this
  repo's templates or the consumer's fully generated codebase. Fails closed (non-zero exit) if
  nothing was measured. See `docs/knowledge/consumer-prj-scoped-lint.md`.

### Fixed
- **An `x-internal` entity's named-constant parent prefix (e.g.
  `COMMENT_REACTION_TYPES`) was derived from `fields:`/`properties:`
  declaration order** — `extract_named_constants` (`generate_types.py`)
  picked the first non-`user` many-to-one FK it encountered while walking
  the entity's properties, so an unrelated schema edit (declaring another
  FK field earlier) could silently rename an already-shipped constant:
  adding `organization_id` anywhere before `comment_id` on `reaction`
  turned `COMMENT_REACTION_TYPES` into `ORGANIZATION_REACTION_TYPES`,
  breaking every hand-written consumer of the old name (the
  comment-reactions API route, the toggle server action). The parent is
  now resolved from an explicit `x-relationship: {constantParent: true}`
  declaration instead — order-independent by construction — and
  `generate.py` fails closed (`SchemaValidationError`) at generation time
  if an `x-internal` enum entity has a candidate non-`user` many-to-one FK
  but none (or more than one) is marked `constantParent: true`, rather
  than silently falling back to order. `reaction.comment_id` (the only
  entity in this repo's own schema this applies to) now carries the
  declaration; `COMMENT_REACTION_TYPES` is unchanged. See
  `docs/knowledge/schema-yaml-configuration.md` ("Named-constant parent
  (`constantParent`)").
- **`lib/attachment/direct_actions.ts` (the direct-attachment FK server action) was
  emitted unconditionally, breaking `tsc`/`next build` for every consumer regardless
  of whether they used the feature.** The file always creates a standalone
  `attachment` row with `attachable_id: null`, which only type-checks when
  `attachment.attachable_id` is nullable in `prisma/schema.prisma` — a manual
  Prisma-alignment prerequisite this repo's own root `prisma/schema.prisma` already
  has, but that no other project's `prisma/schema.prisma` had ever been asked to
  apply, since none of them declare a `type: direct` field. Because `next build`'s
  TypeScript check type-checks every `.ts` file under `lib/` regardless of whether
  anything imports it, the file broke `tsc` for a project with zero `type: direct`
  fields the moment it picked up a recent generator update, with no schema change of
  its own required to trigger it. `generate.py` now emits
  `lib/attachment/direct_actions.ts` only when at least one entity actually declares
  `x-relationship: {target: attachment, type: direct}`, and separately validates the
  `attachable_id`-nullable prerequisite (with an actionable error message) whenever
  an entity does use the feature, instead of leaving it to surface later as a `tsc`
  error deep inside a generated file. See `docs/knowledge/schema-yaml-configuration.md`
  ("Direct Attachment FK").
- **`x-uri-kind: link` fields were silently absent from the create/edit
  form.** A `format: uri` field declared `x-uri-kind: link` was categorized
  correctly by the generator's field-typing logic, and its read-only display
  (view page, list, DataGrid) already rendered as a clickable external link,
  but no input was ever rendered for it in the create/edit form — the field
  could never be set through the UI, and on every edit of an existing
  record the missing form value let the update path silently overwrite
  (erase) any existing value. Also fixed the same field's read-only display
  inside the edit form (when marked `x-readonly`) and the view page: both
  rendered an image widget instead of a link. See
  `docs/knowledge/schema-yaml-configuration.md` (`x-uri-kind`) and
  `docs/knowledge/readonly-field-form-rendering.md`.
- **The list page's DataGrid never actually rendered an `x-uri-kind: link`
  field as a link.** Contrary to the previous entry above, "list, DataGrid"
  was not already correct: the list-page column config never carried a
  `uriKind` attribute at all (only a parent-embedded `BridgeGrid` did), so a
  link-kind field listed in `x-display.table` rendered as a plain string on
  the list page. The list page now passes the same `uriKind: 'link'`
  attribute a `BridgeGrid` already did, so both read-only grids agree. An
  `x-uri-kind: image` field is unaffected by this fix and still never draws
  an image inside any DataGrid cell — list page, `BridgeGrid`, or an inline
  editable child DataGrid — by design; only the single-record view page
  shows an image preview. See `docs/knowledge/schema-yaml-configuration.md`
  (`x-uri-kind`).
- **The `x-scheduled-task` mechanism's generated route only ever exported
  `POST`, but Vercel Cron always invokes with `GET`** — any declared
  schedule would 405 on every real Vercel Cron invocation and silently
  never run (no exception, no red gate). The route now exports both `GET`
  and `POST`.
- **`vercel.json`'s `crons` array is now written automatically by
  `generate.py`** from each entity's `x-scheduled-task` declaration, instead
  of the previous "copy this into `prj/vercel.json` by hand" convention —
  which was itself unsafe: `npm run prj:sync` would copy a hand-placed
  `prj/vercel.json` back over the generator's own file verbatim on every
  sync. `prj_sync.py` now skips `vercel.json` entirely. Only the `crons` key
  is generator-owned; `framework`/`buildCommand`/`regions` and any other
  hand-added key are preserved untouched.
- **`SCHEDULED_TASK_ACTOR_ID`, an environment variable a human had to set by
  hand, is replaced by a fixed-email lookup** (`lib/scheduled-tasks/
  system-actor.ts`) resolved against a system-actor account `scripts/
  seed-tenant.ts` now seeds unconditionally. The env var design returned
  HTTP 500 on every single scheduled-task invocation until someone
  remembered to set it, with nothing surfacing the omission before the
  first scheduled run actually happened; the account seeded by
  `db:seed-tenant` is already guaranteed to exist before that can occur, on
  both the Vercel and GCP deploy paths.
- `validate.py` now rejects a schema declaring more than 100
  `x-scheduled-task` entities (Vercel's per-project cron-job limit, all
  plans) at generate time, instead of letting `vercel.json` reach Vercel
  with an unsupported count.
- **`scripts/vercel-env.sh` documented `NEXT_PUBLIC_APP_TITLE`/
  `NEXT_PUBLIC_APP_COPYRIGHT` but never actually injected either one into
  Vercel** — `vercel_env_inject` only ever called `inject_var` for
  `CRON_SECRET` and the other operational vars, silently leaving the two
  branding vars unset on every Vercel deploy regardless of what a consumer
  put in `.env.production.local`. Both are now injected the same way,
  alongside a note that (like all `NEXT_PUBLIC_` vars) a value change only
  takes effect on the next build. `.env.vercel.production.local.example`
  gained the matching entries. `docs/knowledge/scheduled-task-operations.md`
  gained a correction: an unset `CRON_SECRET` only blocks Vercel Cron's own
  request, it does not gate manual invocation — any authenticated user can
  call the route regardless of `CRON_SECRET`, which the doc previously did
  not call out — plus the GCP-side placement for all three vars (`CRON_SECRET`
  via Secret Manager mirrors `AUTH_SECRET`; the two branding vars need a
  Docker build-arg path that does not exist yet, since `--set-env-vars` at
  deploy time is too late for a `NEXT_PUBLIC_` var already baked into the
  built client bundle).
- Added `docs/knowledge/scheduled-task-operations.md` — the Vercel and GCP
  operational guide for this mechanism (HTTP method, `CRON_SECRET`, cron
  limits, the system-actor account, and how to tell whether a scheduled
  task is actually firing).
- **Fixed a silent output-path collision between polymorphic attachable-bridge actions and a
  standard per-entity CRUD actions file** when `attachment` itself gets an `x-generate` block —
  both writers previously targeted `lib/attachment/actions.ts`, and whichever ran last silently
  clobbered the other's exports. Bridge actions output now lives at `lib/attachment/bridge_actions.ts`.
  No consumer currently sets `x-generate` on `attachment`, so existing output is unaffected other
  than the file rename.
- **Fixed generated approval-flow test helpers never granting synthetic test users membership in
  a membership-scoped FK dependency** (`test_helper.ts.jinja2`) — an approval-flow entity with a
  required/optional FK to e.g. `organization` had its create-form FK autocomplete always return
  zero candidates, so tests `7.1`/`7.2`/`7.4`/`7.6`/`7.7`/`7.8` could never submit or view the
  record. Both helpers now grant the needed membership up front.
- **Fixed a Decimal or date field crashing the write when a user cleared it**, for any
  non-nullable-but-not-required column — an untouched-then-cleared field submitted `''`, which
  Prisma rejected outright. Now falls back to the field's schema default; DataGrid child rows also
  gained their own validation (previously none at all). See
  `docs/knowledge/decimal-and-date-empty-string-clear-crash.md`.
- **Fixed multiple generated UI e2e test gaps** found via a 68-entity real-world schema run:
  non-exact `cy.contains()` row/card lookups could click the wrong element; a DataGrid child FK
  single-select generator ignored `labelField`; a non-nullable `format: uri` field was skipped in
  populate-helper data; a composite `labelField` mixing a searchable and enum segment typed an
  unsearchable token into autocomplete. 14 previously-failing UI e2e specs pass after the fix, no
  new failures elsewhere.
- **Fixed generated UI e2e tests asserting a placeholder string instead of the actual value for
  entities whose list/card primary field is a string or Prisma nativeEnum column** (`string_enum`
  category) — the primary-field priority chain in `spec_context()` had no branch for it, so every
  list/DataGrid-row lookup keyed on it failed. Verified against a real nativeEnum primary: all 13
  desktop + 9 mobile tests pass after the fix.
- **Fixed `lib/_decimal.ts` pulling the Node.js Prisma client into every client-side bundle**,
  surfacing as `TurbopackInternalError` on any consumer schema with a Decimal field. Split the
  module: the Prisma-free `formatDecimalDisplay` moved to a new `lib/_decimal_format.ts`; client
  templates now import from there directly.
- **Fixed two generated-app defects surfaced by UI e2e testing**: read-only Decimal display
  (detail page, edit-mode readonly, list page, DataGrid columns) rendered `Decimal.toString()`
  verbatim instead of the declared scale (`"1"` instead of `"1.00"`); and an optional one-to-one
  selector FK autocomplete returned zero candidates as soon as the user typed, since
  `page_new`/`page_edit` never passed it a `search{Target}Options` prop.
- **Fixed the generated Stripe integration stubs throwing at module top level when a required
  Stripe env var was unset**, failing the production `next build` itself (not just the route at
  request time) for any consumer with `x-payment: true`. Both checks now defer to first use — a
  deploy without `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` configured no longer fails the build,
  only the first real request. See `docs/knowledge/stripe-payment-integration.md`.
- **Fixed the Gantt-chart getter (`x-display.chart`) not serializing a required Decimal column**,
  a `TS2322` at build time; also corrected a doc section that had documented the resulting
  workaround as intended behavior. The getter now stringifies the column like every other Decimal
  crossing the Server-to-Client boundary. See `.claude/commands/update-generator.md` Completion
  gate step 8.
- **Extended the Gantt-chart projection (`x-display.chart`) to a required plain Int/Float scalar
  and a required DateTime column** other than the chart's own start/end pair — both were
  previously either silently dropped from the projection or assigned in a way that failed
  `TS2322` at build time. A required Boolean column is now explicitly excluded; an unrecognized
  required type now fails generation loudly instead of vanishing. See
  `.claude/commands/update-generator.md` Completion gate step 9.
- **Fixed a one-to-one selector's "available options" getter not serializing the target entity's
  Decimal columns**, a `TS2322` at build time for any one-to-one selector whose target carries a
  Decimal column. The getter now wraps its return with `deepStringifyDecimals` when needed,
  matching every other Decimal boundary crossing in the same file. See
  `.claude/commands/update-generator.md` Completion gate step 7.
- **Fixed `split_same_target_fk_deps()` leaving a stale reference after a same-target multi-FK
  split** (e.g. `claim.insured_party_id`/`claim.insurer_party_id` both `-> party`) — an unrelated
  dependency's own nested `fk_deps` entry still pointed at the removed bare-target variable,
  rendering a generated `cypress/support/<entity>/helper.ts` with a `ReferenceError` at test-run
  time. Also fixed a related dependency-ordering bug.
- **Removed the hardcoded Stripe `apiVersion` literal from the `x-payment` stub** — it went stale
  on every SDK bump (including patch bumps) and would eventually break `next build` for any
  consumer declaring `x-payment: true`. The stub now omits the field, which the SDK's own default
  is confirmed behaviorally identical to pinning the current version. See
  `docs/knowledge/stripe-payment-integration.md`.
- **Fixed two generator defects**: a required one-to-one selector FK made the generated
  `page_new.tsx` unbuildable (`Cannot find name` — wrong `init_var` naming for
  `selector_oto_rels` entries); and a parent with no date field of its own but an inline DataGrid
  child with one generated a `dayjs()` call with no import (`has_datetime_props` didn't check
  child-grid content). Neither defect is currently live in this repo's own schema, app-template,
  or app-generator's proj_g schema.
- **Fixed `npm run lint:prj`'s fail-closed condition being too strict**: a consumer whose `prj/`
  holds only non-TypeScript content (e.g. schema/SQL files, no hand-written TS) previously failed
  outright; it now passes with an explicit "measured N files, none .ts/.tsx" message. The three
  genuine "could not measure" cases (sync failure, no `../prj`, zero synced files of any kind)
  still fail exactly as before. See `docs/knowledge/consumer-prj-scoped-lint.md`.
- **Fixed a pending SSL-mode deprecation against Neon connections**: `pg-connection-string`'s
  `sslmode=require`/`prefer`/`verify-ca` will adopt weaker libpq semantics on `pg`'s next major
  version. `lib/db-url.ts`'s new `pinSslModeVerifyFull()`, applied in `lib/prisma.ts` and
  `scripts/seed-tenant.ts`, rewrites those to `verify-full` (currently behaviorally identical, but
  immune to the future change); local/CI URLs with no `sslmode` param are unaffected. See
  `docs/knowledge/pg-connection-string-sslmode-deprecation.md`.

### Security
- **Closed a bypass letting an ordinary user set an `x-approval` field to a value reserved for
  `on_approved`/`on_rejected` `set_fields`**, directly via the form, REST API, or CSV import —
  skipping the approval step entirely. Both the shared validator and the CSV import route now
  reject such a value (a no-op resubmit of the record's own current value is still allowed).
  Coverage depends on which of `on_approved`/`on_rejected` an entity declares `set_fields` for.
  See `docs/knowledge/x-write-locked-values-field-lockdown.md`.

### Added
- **CSV export/import and approve/reject now accept `X-API-Key` as well as a browser session**
  — these five routes previously resolved the caller only via a session, so an external
  API-key client could never call them. Added `resolveActorId()`/`requireDualAuth()` to
  `lib/api-auth.ts` (same dual-auth pattern as `app/api/search/route.ts`). See
  `docs/knowledge/testing-cypress.md`.
- **New API-only regression test**: `test_api_spec.cy.ts.jinja2` gains "4.5 returns 200 for GET
  when the acting user cannot read `<fk target>`", alongside the pre-existing 4.4. See
  `docs/knowledge/fk-read-permission-graceful-degradation.md`.

### Changed
- **Generated API test spec (`test_api_spec.cy.ts.jinja2`) no longer authenticates via
  `cy.login()` except one deliberate case** (per a report from the project owner: `api/approval_flow.cy.ts`
  still drove the browser login screen even after an earlier change added `X-API-Key` support to
  export/import/approve/reject). 15 `cy.login()` call sites classified one by one: 11 in the
  approve/reject block (12.1–15.2) simply predated that dual-auth change and had never been
  updated to use the `api_key` the same test fixtures already expose (`setup.approverUser.api_key`
  etc., the exact pattern the adjacent resubmit tests already used) — switched to `X-API-Key`. 2
  in the export/import permission-denied pair (7.5/7.6) carried a comment claiming the route
  "never reads X-API-Key"; that claim is now false — switched to
  `db:createLimitedApiUser`, the same helper 7.2–7.4 already use, making 7.5/7.6 identical in
  shape to their siblings. 2 more (an export/import happy-path block's `beforeEach`, and a
  search-coverage block) had no route-specific reason to use a session at all — switched to
  `TEST_API_KEY`. The one exception is new: `N14 also authenticates via a NextAuth session
  cookie (dual-auth)`, a single canary proving the session-cookie half of `resolveActorId()`
  still authenticates, kept because eliminating every `cy.login()` would silently stop measuring
  that half of dual-auth's "works via either" guarantee. See
  `docs/knowledge/testing-cypress.md`'s "API test / UI test boundary" section for the policy and
  `code_generator/check_generated.py`'s new `test:unexplained-login` gate rule that now enforces
  it (regenerated output confirmed `cy.login`-free except the one marked canary; full
  `test:e2e:cy:api` run: 248/270 passing across all 16 relevant specs, the 22 failures isolated
  to a single pre-existing, untracked, gitignored orphan spec — `personal_note.cy.ts`, 404s
  because the `personal_note` entity no longer exists in `json_schema.yaml` — unrelated to this
  change and present before it).
- **`fk_read_permission_graceful_degradation.cy.ts` moved from `cypress/e2e/api/` to
  `cypress/e2e/`**: every case in this hand-written spec drives the browser
  (`cy.visit`/`cy.login`/`cy.selectAutocomplete`) and never issues a raw `cy.request` — it was
  never actually `test:e2e:cy:api`-gate coverage despite living under `api/`. It now sits under
  `test:e2e:cy:ui`'s spec glob (`cypress/e2e/*.cy.ts`) instead. (Note: the task instruction that
  prompted this move said "move to `cypress/e2e/ui/`", but no such subdirectory exists in this
  repo — `cypress/e2e/*.cy.ts` is the actual UI-spec convention; moving it into a nonexistent
  `ui/` subdirectory would have dropped it from both gates' spec globs silently.)

### Fixed
- **Server Action errors (permission denied, unique-constraint violations, stale updates, and
  more) showed a "Minified React error #441" screen with no actionable text instead of the
  underlying reason** (design from an earlier proposal): Next.js strips a thrown error's `message`
  at the Server Components render boundary in production, replacing it with the minified error
  text and an opaque digest — this happened for every error thrown by `upsertXxx`/`removeXxx`'s
  service-layer calls, regardless of how actionable the underlying error was. Fixed per
  `docs/knowledge/error-message-framework.md`'s Layer 2 design: added a typed `AppError`/
  `ActionResult` taxonomy (new write-once `lib/_errors.ts`), converted the named throw sites
  (`lib/authz.ts`, `lib/normalize.ts`, `service.ts.jinja2`, `service_validation.ts.jinja2`) to
  throw `AppError`, and had `actions.ts.jinja2`'s `upsertXxx`/`removeXxx` catch it and return an
  `ActionFailure` value instead of letting it propagate — the value survives production
  untouched, since it is data, not an exception crossing the render boundary. The client renders
  the corresponding message via a new `Errors` i18n namespace (`messages/en.json`, translated to
  `messages/ja.json`). `removeXxx` (bulk delete) was extended beyond the original per-file
  checklist, since a permission-denied delete would otherwise still crash — `DataGridClient.tsx`/
  `CardListClient.tsx` now show the failure via `AppAlert` and roll back the optimistic row
  removal instead. Also fixed, found only empirically during implementation (no throw site for it
  existed anywhere): a genuine DB-level `@unique`/`@@unique` violation surfaced as an uncaught
  `Prisma.PrismaClientKnownRequestError` (P2002) — `service.ts.jinja2` now converts it to
  `AppError('CONFLICT', ...)`, reading the violated field name via a new `p2002Field()` helper
  (`lib/_errors.ts`) written against this Prisma version's actual driver-adapter error shape,
  which differs from the classic `meta.target` most Prisma examples show. Org isolation
  violations continue to surface as `NOT_FOUND` (unchanged from earlier behavior) — never as
  "permission denied", which would leak that the record exists in another organization. `error.tsx`
  now shows a static, safe `Errors.pageError` i18n key instead of a hardcoded string; it remains
  the fallback for truly unexpected errors and for permission checks on Server Component pages
  (`assertPermission`, list/detail access), which cannot return a data value the way a Server
  Action can. New hand-written UI e2e coverage,
  `cypress/e2e/error_message_delivery.cy.ts`, exercises all three scenarios end-to-end
  (unique-constraint violation, stale update, permission denied) against a full production build,
  confirming the inline message renders and the page never falls through to `error.tsx`. Full
  mandatory gate green (1238 pytest, 459 vitest, 240 API e2e — 0 skipped in any suite — plus the
  new UI spec, 0 npm audit findings).
- **`get<Entity>ChunkForExport()` silently exported zero rows for an `X-API-Key`-only caller
  with genuine `read` permission** (found while removing `cy.login()` from generated
  export API tests): `getters.ts.jinja2`'s CSV-export getter has two branches for computing
  permissions — the `should_filter_by_org` branch correctly calls
  `getModelPermissions('<entity>', userId)` with the `userId` the export route already resolved
  (via `resolveActorId()`'s dual-auth) and passed in; the other branch called
  `getModelPermissions('<entity>')` with no `userId` at all, which falls back to
  `getSessionUserId()` inside `authz.ts`. Every export API test always authenticated via
  `cy.login()` (a real session cookie), so this was invisible — `getSessionUserId()` happened to
  resolve the same actor. Switching those tests to `X-API-Key` (no session cookie present)
  exposed it: `getSessionUserId()` returns `null`, `getModelPermissions()` returns
  `EMPTY_FLAGS`, and the export's own access-where builder filters out every row — a 200 response
  with an empty CSV body, not an error, for a caller the *route* had already confirmed has read
  access. Fixed by passing `userId` through in both branches. Verified: `dashboard.cy.ts`'s N6/N11/
  N12/N13 (which use `to.include` assertions that fail on empty data, unlike N1/N2/N5's
  `to.not.include`, which pass vacuously either way) went from failing (`expected [''] to include
  'name'`) to passing after the fix, confirmed on a from-scratch server + build.
- **`FormUpsert`'s readonly-field display was type-blind, showing raw FK ids with a nonexistent
  i18n key instead of the relation's label**: the readonly-field loop in
  `form_upsert_context()` rendered every readonly field the same way —
  `String(src.<prop>)` with `tf(to_camel_case(prop))` as the label — regardless of type. For a
  relation, the property name is `<rel>_id`, so this produced an untranslated
  `tf('parentGoodsReceiptLineId')` label and the raw id as the value instead of the relation's
  resolved `labelField`. The same blind loop also affected enum (raw untranslated stored code),
  date/datetime/time, boolean, and image (`format: uri`) readonly fields, though those remained
  legible (unstyled) rather than incorrect. Fixed by extracting `form_view_context()`'s existing
  per-type dispatch (FormView is always read-only, so it already rendered every type correctly)
  into a shared `_readonly_display_field()`, reused by both `form_view_context()` and
  `form_upsert_context()` — the two paths can no longer render the same field differently.
  Also added a fail-closed check: an `x-readonly-fields` entry that doesn't resolve to an actual
  property (e.g. the relation name instead of the FK column) now raises at generation time
  instead of silently leaving the field fully editable. See
  `docs/knowledge/readonly-field-form-rendering.md`.
- **Generated "requestor can re-submit a rejected request" approval test used a page-wide,
  unscoped `[aria-label="Re-submit"]` lookup** (real case: `purchase_per_item.cy.ts`
  7.8, seen as `cy.click() can only be called on a single element. Your subject contained 2
  elements.` in a full 150-spec CI run, passing in isolation): `ApprovalSection.tsx` renders one
  Re-submit `IconButton` per `approval_request` row with `status === 'rejected'`, all sharing the
  same static `aria-label="Re-submit"` — and an entity can legitimately have a second, "ungated"
  `approval_flow` (`requestor_role_id: null`, applying to every requestor) alongside a role-gated
  one (see the adjacent 7.1 test's own comment: "both flows apply → 2 approval_requests"), so once
  more than one of an approvable's requests is rejected, more than one element matches. Two full
  local reproductions matching the exact failing CI commit and exact preceding 23-spec order could
  not force the second row, so the triggering condition from that CI run stays unconfirmed — but
  the selector was unsafe by construction regardless, the same "only one graspable" assumption
  already fixed for `parent1` in an earlier change, the self-referential decoy in another earlier change, and
  `goods_receipt_line` candidate selection. Fixed by scoping the interaction to the specific
  `approval_flow`'s own table row (via its approver-role-name `<td>`, exact-matched with the
  existing `exactRe()` helper, then `.closest('tr')`) instead of a page-wide selector. The
  sibling `[aria-label="Approve"]` / `[aria-label="Reject"]` lookups in the same describe block
  (tests 7.4/7.5/7.6/7.7/7.9) carry the identical latent hazard and were left unscoped — noted for
  a follow-up cmd, out of this task's scope. Verified: `purchase_per_item.cy.ts` 9/9 passing
  individually and in a full 23-spec CI-order run (`approval_flow.cy.ts` through
  `purchase_per_item.cy.ts`, matching the exact failing CI run's spec order) against the exact
  submodule commit that failed in CI; `code_generator` pytest suite 1227 passed, 0 skipped after
  `generate-code`.
- **`helper_context()`'s per-dependency loop variable shadowed the entity-level `title`**
  (`code_generator/generators_test.py`, found verifying the fix above): the multi-FK-to-same-target
  dep-splitting loop (e.g. `inventory_movement`'s `from_inventory_id`/`to_inventory_id`, both
  pointing at `inventory`) reused the bare name `title` for each per-dependency label, permanently
  overwriting the outer `title = to_title_case(parent)` for the rest of the function — so
  `helper_context()`'s returned `title` (used by `test_helper.ts.jinja2` to name every approval-flow
  seed role, e.g. `Test {{ title }} Approver Role`) silently became the *last-processed FK's* label
  (`"To Inventory"`) instead of the entity's own title (`"Inventory Movement"`), while
  `spec_context()` (no such loop) still returned the correct title — a cross-context mismatch
  invisible until a test asserted on the seeded role's display text. The fix above's
  `exactRe('Test {{ title }} Approver Role')` scoping does exactly that, so it surfaced the bug on
  every entity hitting this pattern (`inventory_movement.cy.ts` 7.8 failed:
  `Expected to find content: '/^Test Inventory Movement Approver Role$/' within the selector: 'td'
  but never did`) — the old page-wide `[aria-label="Re-submit"]` selector never looked at role text,
  so the mismatch had no test-visible effect before this task. Renamed the loop-local variable to
  `dep_title`. Verified: instrumented `helper_context()`/`spec_context()` directly for
  `inventory_movement` (`title` now `'Inventory Movement'` from both, previously `'To Inventory'`
  vs `'Inventory Movement'`); `inventory_movement.cy.ts` 14/14 passing standalone after
  `generate-code`; `code_generator` pytest suite unaffected (1227 passed, 0 skipped, same count
  before and after this fix — no fixture relied on the shadowed value).
- **A parent record created with a NULL `organization` (added in an earlier change that made the relationship optional) became permanently
  un-updatable — `upsert<Parent>()`'s pre-permission existence check threw `Error('Not found')`
  even for its own creator**: `generators.py`'s `_actor_and_existing_block()` filtered
  strictly on `organization_id: { in: _orgIds } }`, which never matches `NULL` in SQL, unlike its
  three sibling org-filter sites (`remove<Parent>()` in `actions.ts.jinja2`,
  `get<Parent>Detail()` in `getters.ts.jinja2`, and the CSV import route in
  `api_import_route.ts.jinja2`), which already admitted a NULL-organization row via the same
  `org_relationship_optional` OR-null clause. Wired the same (previously computed but unused)
  context value into the upsert existence check so create/update, delete, and read now treat a
  null organization consistently. Verified against proj_c's `parent1` entity in an isolated
  worktree: the update-existence-check regression case now passes; `code_generator` pytest suite
  1220 passed, 1 skipped (pre-existing, unrelated), 0 failed.
- **Cross-entity global search never surfaced a row whose `organization` relationship was NULL**:
  `search_helpers.ts.jinja2`'s per-entity access clause filtered strictly on
  `{{ org_id_field }} IN (${ associatedOrgIds })`, which never matches `NULL` in SQL. Once an
  org-scoped entity's `organization` relationship becomes optional (per the earlier change noted above), an org-less row
  was invisible to `buildSearchQuery()` for every caller, including its own creator — the one
  remaining call site still using the pre-that-change unconditional-deny shape (every other
  `org_relationship_optional` site — `actions.ts.jinja2`, `getters.ts.jinja2`,
  `api_detail_route.ts.jinja2`, `api_import_route.ts.jinja2` — already had the OR-null admission
  via that same set of earlier changes). Fixed by wiring the same `org_relationship_optional` computation into
  `generate.py`'s search-entity context (search builds its own independent Prisma.sql fragments,
  so it needed its own plumbing rather than reusing the object-filter templates' existing
  context), gated at both org-filter sites in the template (the direct access clause and its
  `parent.`-qualified `no_page_children` sibling). Verified against a real Postgres DB via proj_c's
  `parent1` entity: `api/parent1.cy.ts`'s N10 spec failed with `expected false to equal true`
  before this fix, passed after. See `docs/knowledge/org-optional-entity-support.md` for the full
  design context, including a follow-up gap found but not fixed in this pass (CSV import's
  dotted-FK lookup-target org filter doesn't admit a NULL-organization row on the lookup target
  side either).
- **Generated 3.3 "edits with mixed changes" test for a `user`-FK primary field selected a
  `Test User A` row that was never seeded, failing the `cy.selectAutocomplete` assertion**
  (real case: `shift`/`shift_template`): `spec_context()`'s `is_user_account` primary-FK
  branch builds `edit_update_value` from the letter-suffixed dependency instance (`Test User A`,
  from `_seed_relation_label_value`'s `unique_index=None` fallback) but only routed the edit
  through `populate{Pascal}Dependencies()` (`use_deps_in_3_3`) for the `selectAutocomplete`
  create/fail-edit paths — the `is_user_account` branch of `populate{Pascal}Data`'s own
  per-iteration loop (`test_helper.ts.jinja2`) only ever creates `Test User ${i}`, never a
  letter-suffixed row, so relying on `populate_count_3_3` alone left the target row absent from
  the DB. Fixed by setting `use_deps_in_3_3 = has_deps` for this case too (`generators_test.py`),
  so the 3.3 edit is routed through the dependency populator like the other `is_user_account`
  paths already are. Verified: `shift.cy.ts`/`shift_template.cy.ts` (desktop + mobile) 40/40
  passing in an isolated worktree; full `code_generator` pytest suite 1216 passed, 0 skipped.
- **Generated Cypress test's per-entity `callIndex` counter (an earlier isolation counter,
  `` `Test {Title} ${callIndex}_${i}` ``) persisted for the life of the Cypress plugin process, not
  per test case** ("per-test-case callIndex reset"): a generated spec's own `it()` blocks
  are hardcoded to expect `callIndex=0`, but two `it()` blocks in the same spec calling the same
  `populate*Data`/`populate*FullData` helper gave the second block `callIndex=1`, failing its
  assertions — and separately meant a single `it()` run in isolation could produce different
  generated values than the same `it()` run as part of the full spec (order-dependence). Fixed by
  adding a `_reset{Pascal}CallSeq()` export to the generated test helper, wiring it to a
  `db:reset{Pascal}CallSeq` Cypress task, and calling that task at the top of every generated
  spec's `beforeEach` — desktop, mobile, and API. (The API spec template was missed in the first
  pass — `api_spec_context()` never computed `primary_fk_dep` either, the same gap the desktop/mobile
  contexts had — and added in a follow-up once code review caught it before merge.) Guarded by the
  same condition (`primary_fk_dep` with `extra_required_fields`, not a user-account FK) that decides
  whether the counter exists at all, so entities that never needed the counter get none of the new
  plumbing. Hand-written specs calling the same populate functions are not automatically covered by
  this reset (each has its own `beforeEach`) — see the new rule and worked example in
  `docs/knowledge/cmd614-test-data-uniqueness-design.md` §6.2 for how to keep such specs safe
  (round-trip the actual seeded value, or add the same reset call). Verified end-to-end against
  proj_b's `approval_flow` (its only entity meeting the guard condition): isolated single-`it()`
  runs and full-suite runs produce identical generated values; full mandatory gate (lint / pytest /
  vitest / mention-gate / e2e:build / check:generated / cy:api 236/236 / cy:ui 177/177 / npm audit /
  pip-audit) green.
- **`api_import_route.ts.jinja2`'s composite-labelField FK resolution referenced
  `formatLabelValue()` with no import once a labelField segment needed date/time formatting, breaking
  the TS build**: an earlier fix removed this import as unconditionally-dead lint debt — correct at
  the time (no entity's `import_label_expr` called it yet), but `import_label_expr` is a *string built
  in `build_context.py`* and spliced in via `{{ }}`, so a static read of the `.jinja2` source can never
  see whether it calls `formatLabelValue()`. A later labelField-composition change made composite
  labelFields with date/time segments call it (real case: proj_g `goods_receipt_line`, labelField
  `[product.code, lot_number, expiration_date]` — broke a downstream consumer's build with "Cannot find
  name 'formatLabelValue'"). Fixed by gating the import on `import_uses_format_label_value` (`build_context.py`:
  `any(s.get('has_format') for s in import_fk_specs)`, threaded from `build_label_expression()`'s own
  `has_format` — the same mechanism 7 other templates already use for this same import). Both directions
  verified: a composite labelField with a date segment gets the import (proj_g `goods_receipt_line`,
  reproduced via a real `build_context()` call with a date-typed labelField segment — see
  `TestCompositeLabelFieldImportUsesFormatLabelValue` in `test_build_context.py`), and one without still
  omits it (no regression of the original lint-debt fix). Re-audited the same commit's other two
  dead-binding fixes (`fkData`, `richPerms`) — neither shares this blind spot, both gate usage behind
  the identical static `{% if %}` as their declaration. Also fixed, same file (code review finding on a
  downstream consumer PR): an `eslint-disable-next-line` comment on the auto-create-OTO branch sat two
  lines above the `as any` it was meant to suppress (directly above `await tx.{{ model }}.create({`
  instead of the `data: { ...(action.data as any),` line), silently failing to suppress anything.
  Regression tests (deviation-injection confirmed: revert either fix → new test fails at the same
  spot): `test_format_label_value_imported_when_composite_spec_needs_it` /
  `..._import_absent_when_flag_false_even_with_composite_spec` /
  `test_bridge_create_eslint_disable_immediately_precedes_as_any` in `test_import_template_branches.py`.
  Full `code_generator` pytest suite: 1181 passed, 0 regressions. See
  `docs/knowledge/cmd607-generator-lint-debt-fix.md` (correction note under Root cause 2, item 1).
- **Generated UI test scaffold no longer tries to fill an `x-server-value` field through the
  form.** Two `spec_context()` code paths (create/fail-edit fill commands via
  `req_ua_spec`/`all_ua_spec`, and the "edits with mixed changes" test's `edit_primary_cmd` when
  the field is also the entity's `x-display.table` primary column) generated
  `cy.selectAutocomplete()` against a field that's always excluded from every form input by
  `x-server-value`'s design — the form never renders that autocomplete, so the generated test
  failed outright (`Expected to find element: 'filter', but never found it`). Both paths now skip
  such fields entirely. See `docs/knowledge/x-server-value-actor-delegation.md`.

- **Generated test helper's find-or-create dep block gave `create()` an `include` for
  composite-labelField resolution but not the paired `findFirst()`, a latent TS2551/TS2339 type error
  in every affected `cypress/support/*/helper.ts`**: when a many-to-one relationship's
  `labelField` is composite (e.g. `[purchase_order.po_number, item.sku]`), the generated dep record's
  label expression reads an included relation (`record.purchase_order?.po_number`) that only exists on
  the `create()` branch's inferred type — the `findFirst()`-declared variable's type lacks it, since
  `test_helper.ts.jinja2` only spliced `dep.prisma_include_str` into `create()`. Reproduced in proj_g's
  `goods_receipt_line/helper.ts` (`purchase_order_line`/`asn_line` deps). Currently invisible to every
  gate — `tsconfig.json` excludes `cypress/` from `next build`'s type-check scope, and `cypress run`
  transpiles support files without type-checking — confirmed via an isolated `tsc --noEmit` pass and a
  deviation-injection round-trip (revert → error reappears at the same 2 lines; re-apply → clean).
  Fix: the same conditional `include` now applies to both the `findFirst()` and `create()` call in all
  5 identically-shaped call sites in the template. proj_g's full `test:e2e:build` + `test:e2e:cy:api`
  (30 specs / 616 tests) both pass post-fix, and an isolated `tsc --noEmit` over proj_g's entire
  `cypress/support/**` confirms zero remaining errors of this class across all 5 composite-labelField
  occurrences in its schema. proj_c has one dormant occurrence of the same latent bug class (not
  exercised here — its generator pointer hasn't bumped to include this fix yet). Covered by a new
  regression test (`test_composite_labelfield_helper_findfirst_include.py`, following an established convention: render
  the actual jinja2 template, assert the generated TypeScript). Full `code_generator` pytest suite:
  1130 passed (+2 new), 0 regressions. See
  `docs/knowledge/composite-labelfield-helper-findfirst-include-mismatch.md`.

- **The CSV-import commit-time CREATE path built its Prisma `create()` call entirely from the
  dry-run-computed row data, bypassing the same auto-create-bridge-FK pre-create mechanism
  (`one_to_one_pre_creates` / FK-merge) that the normal `add<Entity>()` service function already
  uses**: any entity with a required internal bridge FK (e.g. `approvable_id` on an
  `x-approval` entity) failed CSV-import row creation at commit time with a Prisma
  `PrismaClientValidationError` for the missing FK, even after an earlier fix correctly let
  `import_can_create` come out `true` for such entities. The dry run (which never touches the DB)
  reported success and issued a `confirmToken`, making the failure visible only on commit — a
  concrete trap for anyone confirming a dry run that "succeeded". Concrete trigger: `goods_receipt_line`
  (an `x-approval` entity) importing a CSV row whose natural key doesn't match an existing row.
  `api_import_route.ts.jinja2`'s commit-time create branch now consumes the same
  `one_to_one_pre_creates` / `one_to_one_fk_data_lines` context vars `service.ts.jinja2` already
  renders — not a new mechanism, not a hand-listed entity name — gated on whether the entity has
  any auto-create one-to-one relations at all, so entities without one render byte-identical output
  to before. `one_to_one_fk_data_lines` is now also exposed standalone in `build_context.py`'s
  returned context dict (previously inlined only into `parent_data_obj`, unavailable to any
  template other than `service.ts.jinja2`). Verified both directions: a non-bridge entity's
  generated import route is unchanged, and a direct DB-level replay of the fixed
  `goods_receipt_line` transaction (against a real Postgres instance) succeeds and correctly
  populates `approvable_id`, while the same data without the fix reproduces the original
  `PrismaClientValidationError`. New/updated pytest coverage in `test_import_template_branches.py`
  and `test_auto_create_oto.py` fails against the pre-fix template (deviation injection). Full
  `code_generator` pytest suite: 1134 passed, 0 skipped. See
  `docs/knowledge/import-create-missing-bridge-fk-fix.md`.

- **An org-scoped entity's `organization` relationship can now be declared optional without
  breaking CREATE or making org-less rows invisible.** Two gaps, both only surfacing once an
  entity's `organization` relationship is removed from `required`: (1) `service.ts.jinja2`'s
  CREATE-path org-membership check called `Array.includes()` on a value that is `string | null`
  once the relationship is optional — a real `next build` compile error, not a lint nit — fixed by
  mirroring the guard the UPDATE path already had; (2) every generated read/write scope filter
  (`organization_id: { in: [...] }`) never matches SQL `NULL`, so an org-less row became invisible
  to every org-scoped actor, including its own creator — confirmed as a real, not theoretical,
  break: a testbed entity's basic generated CRUD tests failed en masse the moment its organization
  relationship became optional and it was added to the standard test-permission infrastructure.
  Fixed with a new `org_relationship_optional` flag that admits `organization_id: null` alongside
  the actor's own organizations, applied everywhere the current model's own org scoping is
  checked (list, detail, delete action, PUT/DELETE existence check, CSV import match-by-key). A
  required-org entity's generated output is unaffected. See
  `docs/knowledge/org-optional-entity-support.md`.

- **CSV import's dotted/composite-label FK lookup left the `organization` lookup target itself
  completely unfiltered** — the existing `('organization', 'user')` exclusion in the org-filter
  discriminant is correct (neither model has an `organization_id` column to filter candidates on),
  but for `organization` specifically it meant no filter applied at all: a CSV row naming *any*
  organization in the system, not just one the actor belongs to, would resolve and get attached.
  Fixed with a new `lookup_entity_filter_by_self_id` flag that filters organization candidates by
  their own `id` being in the actor's associated-org list instead. See the "Follow-up" section of
  `docs/knowledge/csv-import-dotted-fk-org-filter.md`.

- **`approval_flow.preceded_by`/`followed_by` rendered a different label on the View page than on
  the Edit page for the same row**: View rendered `approver_role.name || entity_name`
  (dropping `entity_name` entirely whenever a role was set), Edit rendered
  `entity_name + ' - ' + approver_role.name`. The legacy `secondaryLabelField` mechanism that caused
  this (only honored in one of the several label-rendering call sites) is removed entirely — zero
  remaining references, grep-verified. `labelField` is now the composite list form
  (`[entity_name, approver_role.name]`), rendered identically everywhere via the existing
  `build_label_expression()` helper. Fixed a related crash: `generators_test.py`'s list-children
  spec-label prediction called `.split()` directly on a labelField, assuming it was always a string
  — list-form labelFields now route through the existing `_seed_relation_label_value()` helper.
  Self-referential many-to-many searches (the pattern `preceded_by`/`followed_by` use) now pass the
  record being edited through as `context.formValues`, making the previously-unreachable
  `autocomplete_filter.ts` insertion point usable for this case; every other entity's default `{}`
  stub is unaffected. Added `lib/approval_flow/autocomplete_filter.ts`: narrows
  `preceded_by`/`followed_by` candidates to the same `entity_name` as the record being edited
  (same-`entity_name` approval chains — e.g. a `purchase_order` chain's draft/manager/finance
  stages — are an intentionally supported configuration, not test-data noise). Verified: 1130
  pytest passing (0 skipped), full `test:e2e:cy:api` gate 236/236 passing (0 skipped), plus a new
  hand-written `approval_flow_same_entity_autocomplete_filter.cy.ts` (2/2 passing) proving
  same-entity_name candidates appear, different-entity_name candidates don't, and View/Edit render
  the identical label.
  
- **`_create_feasible` (the CSV CREATE-feasibility gate) never excluded FKs to internal bridge
  models (e.g. `approvable_id`, `x-relationship.type: one-to-one_bridge`), wrongly counting them as
  unfillable required columns and gating off `import_can_create`**: a bridge FK is
  server-managed plumbing the service layer creates and wires at CREATE time — it was already
  correctly excluded from CSV *export*, but nothing then removed it from the required-fields gap
  set, so it stayed a "gap" and `import_can_create` came out `False`. Combined with
  `x-generate.edit: false`, this collapsed the entire generated `import/route.ts` to the
  `ENTITY_IMPORT_NOT_SUPPORTED` 400 stub (`api_import_route.ts.jinja2:24`), not just CREATE — the
  concrete trigger is `goods_receipt_line` (a pending edit:false ruling for that entity from an earlier task).
  A prior earlier test for this exact scenario asserted the buggy value as correct, under the
  mistaken belief the exclusion already happened; that test's assertion and rationale are corrected
  as part of this fix. `_create_feasible` now subtracts `get_internal_bridge_fk_prop_names()` —
  the same shared helper `validate.py` and `generators_test.py` already call — rather than a
  hand-maintained name list. A genuinely unfillable required FK to a real (non-bridge) entity is
  unaffected and remains infeasible as before. Verified both directions via an isolated
  `build_context()` harness (no entity in this repo's own schema combines a required bridge FK with
  edit:false) and updated/new pytest coverage in `test_build_context.py`, including deviation
  injection (assertions fail against the pre-fix code). Full `code_generator` pytest suite: 1131
  passed, 0 skipped. See `docs/knowledge/create-feasible-internal-bridge-fk-fix.md`.

- **Generator-side lint debt invisible to CI**: `npm run generate-code && npm run lint`
  surfaced 83 eslint warnings (0 errors) that CI's `Lint` job — which runs before `generate-code`,
  never after — could never see. Broken down: 48 were a Chai getter-assertion false positive
  (`expect(x).to.be.true`/`.to.exist` read as unused expressions by
  `@typescript-eslint/no-unused-expressions`, which has no notion of Chai's assertion-chain side
  effects), fixed by scoping that rule off for `cypress/e2e/api/**/*.cy.ts` in `eslint.config.mjs`.
  The remaining 30 `no-unused-vars` warnings were three unrelated dead-binding bugs in
  `api_import_route.ts.jinja2` (`formatLabelValue` imported but never referenced; `fkData` declared
  and written even when `import_can_create` is false and nothing reads it) and
  `api_bulk_route.ts.jinja2` (`richPerms` bound even for `x-self-only` entities, which never read it
  — the permission check itself still runs, just unbound), plus two ordinary stale imports in
  hand-written (non-generated) `audit_log` test files, plus 22 warnings whose triggering condition is
  scattered across dozens of independent scenario branches in `test_spec.cy.ts.jinja2` — fixed via two
  new self-healing post-render helpers in `generate.py` (`_strip_unused_exact_re_helper`,
  `_prefix_unused_then_callback_params`) that inspect the actual rendered TypeScript output rather
  than trying to mirror every branch condition in Python. 83 → 5 warnings (the remaining 5 are an
  unrelated, pre-existing `@next/next/no-img-element` suggestion on static `components/_standard/*`
  files, deliberately out of scope). 15 new pytest tests, 0 regressions (1130 → 1145 passed, 0 SKIP).
  See `docs/knowledge/cmd607-generator-lint-debt-fix.md`.

- **x-reservation test-helper generation only ever resolved the pool entity's criteria-field FK,
  silently omitting any OTHER required FK on the pool entity**: when a pool entity (e.g.
  `inventory`) has a required FK beyond the one named in `x-reservation.request.criteria` (e.g.
  `location_id`, added 2026-08-06 alongside `product_id`), three separate generated-test code paths
  built `prisma.<pool>.create()` calls that omitted it, all failing at seed time with a
  missing-required-column Prisma error: `_reservation_base()`
  (`test_reservation_helper.ts.jinja2`'s `seedReservationXxx*` helpers), and `helper_context()`'s
  `reservation_lines_pool_seed`/`reservation_nolines_pool_seed` blocks
  (`test_helper.ts.jinja2`'s `populate{{Pascal}}Dependencies()` pool-seed snippet — the one actually
  responsible for the reported failures: `cypress/support/purchase_order/helper.ts`'s
  `prisma.inventory.create()`, driving 20/27 failures in proj_c's `purchase_order.cy.ts` plus 1 in
  `purchase_order_reservation_gen.cy.ts`, 21 total). All three now reuse
  `resolve_dependencies()`/`get_entity_fk_deps()` (the same machinery `helper_context()` already
  uses for `populateXxxDependencies`) to resolve the pool entity's required FKs beyond the criteria
  field, including transitive chains — reusing an already-resolved dep var where one exists (e.g. a
  datagrid child's own autocomplete FK already pulled the same target in) instead of creating a
  duplicate row. Also fixes a latent, currently-dormant adjacent bug found while tracing this:
  `populate{{Pascal}}Dependencies()` returned `{}` unconditionally whenever `deps` and
  `reservation_nolines_pool_seed` were both empty, without checking `reservation_lines_pool_seed`.
  Entities whose pool has no extra required FK (the common case, e.g. `supply_request`/`supply_pool`)
  render byte-identical output. Covered by 15 new injected-fixture tests (following an established convention: render
  the actual jinja2 template, assert generated TypeScript sets the column) across
  `test_reservation_helper_pool_extra_fk.py` and `test_helper_pool_extra_fk.py`. Verified live in an
  isolated proj_c worktree, both specs isolated (28/28 passing, up from 7/28 before) and as part of
  the full 57-spec `test:e2e:cy:api` suite (976 tests: 936 passing/40 failing/9 red specs, up from
  915/61/11 before the fix — exactly the 21 targeted failures resolved, zero new failures anywhere
  else; SKIP=0 both runs). The 40 failures/9 red specs that remain are pre-existing and out of this
  fix's scope (37 failures across 8 specs are the separate hand-written-helper class fixed by
  an earlier change; 3 failures in 1 spec are an unrelated `x-self-only` 404-vs-403 issue). proj_g has zero
  `x-reservation` consumer entities (feature unused there) — confirmed by mechanically walking its
  schema with the fixed generator's own context builders, N/A for this bug class. Full
  `code_generator` pytest suite: 1127 passed, 0 regressions. See
  `docs/knowledge/x-reservation-pool-entity-extra-fk-fix.md`.

- **A field with a Prisma `@default(...)` but no schema `default:` marker (dynamic defaults like
  `now()`) or with a static default the generator ignored (number/boolean/plain-string) silently
  lost that default on the "new" page whenever the user left it untouched**: for
  `DateTime @default(now())` NOT NULL columns, the "new" page seeded `null`, the browser then
  submitted `''`, and the server turned that into `new Date('')` (Invalid Date) — crashing
  `create()` outright for any consumer entity with such a column (the concrete symptom this fixes:
  `inventory_transaction.occurred_at`-style fields in downstream consumers). Number fields with a
  nonzero default silently became `0`; boolean fields with `@default(true)` always submitted
  `false`; plain (non-enum) string fields with a default always submitted `''` — none of these
  crashed, but all silently discarded the schema's declared default. `_default_value()`
  (`page_new.tsx`'s initial form state) now seeds a writable default for all four field classes —
  `new Date()` for datetime fields excluded from `required:` while remaining DB non-nullable (the
  only surviving signal for a dynamic default, since `schema_deriver` deliberately omits the
  `default:` key for `now()`/`cuid()`/etc.), the schema's literal `default:` value for
  number/boolean/plain-string. `_new_prop_val()` (DataGrid child new-row seeding) already handled
  boolean/number correctly; only its plain-string/plain-string-enum branches needed the same fix.
  Also fixed a related `NumberField` JSX bug where `src.p || undefined` would have silently blanked
  a legitimate `0` default (`0 || undefined` is falsy) — changed to `??`. Verified via isolated
  before/after Cypress UI comparisons in both proj_g (the target crash flips FAIL→PASS, zero
  regressions) and proj_c (the full 86-spec/781-test UI suite is an exact match before/after — zero
  regressions). `test:e2e:cy:api` cannot exercise this class of bug at all (it drives the REST API
  directly, never the browser form's default-seeding JS) — a gate blind spot worth keeping in mind
  for this field-default family specifically. See `docs/knowledge/writable-default-value-fix.md`.
- **`npm run cleanup`'s defaults deleted write-once stubs while leaving true orphans behind, and a
  reordered `generate-code` → `cleanup` run silently deleted the entire just-generated tree**
  (building on an earlier fix that pointed cleanup at the Stage-4 built schema):
  `cleanup` now passes `--prune-orphans --keep-stubs` (the safe default — sweep stale entity
  boilerplate, keep customizable stubs) where it previously passed neither (orphans ignored, stubs
  deleted); `cleanup:all` keeps `--prune-orphans` alone (full clean-slate, stubs deleted too).
  `cleanup.py` also fails fast with an actionable message instead of a raw traceback when its
  schema argument doesn't exist, and now warns (without blocking) when
  `.generated-manifest.json` was written under a minute ago — running `cleanup` immediately after
  `generate-code` deletes every just-generated file, since they all hash-match and therefore all
  read as pristine-deletable; correct order is `cleanup` → `generate-code`, not the reverse.
  Separately, `build_user_schema.py`'s raw/view split silently dropped a bridge-child entity's
  `x-bridge` declaration whenever that entity also carried `x-generate` (neither the resulting raw
  nor view entity retained it), which would have made `generate.py` skip `<Child>BridgeGrid.tsx`
  generation for any Stage-4 schema combining `x-bridge` with `x-generate`; `x-bridge` is now
  carried onto the raw entity like `x-display` and the other entity-level annotations, and
  `generate.py`'s own `BridgeGrid.tsx` emission now reads the raw entity via `_raw_def()` instead
  of the view entity directly. No consumer of this generator currently combines `x-bridge` with
  `x-generate`, so this had not yet surfaced as a build failure. See `docs/knowledge/cleanup.md`
  and `docs/knowledge/schema-restructuring-build-order.md`.

### Added
- **`x-server-value` now supports actor delegation**: `x-server-value: {source: actor,
  override_permission: <Operation>}` lets an actor holding that permission supply an explicit
  value on create instead of always defaulting to their own id (e.g. filing on someone else's
  behalf). The REST create response gains an optional `_server_value_overrides` flag when this
  happens. The plain string form `x-server-value: "actor"` is unchanged. See
  `docs/knowledge/x-server-value-actor-delegation.md`.

### Security
- **CREATE had no read-only field enforcement**: unlike PUT's existing check, a client-submitted
  value for an `x-readonly`/`x-readonly-fields` field flowed straight into the database on create,
  via both the REST route and the server action. Both entry points now reject any client-submitted
  value for such a field on create (`x-server-value` fields are exempted — see Added). See
  `docs/knowledge/x-server-value-actor-delegation.md`.

### Fixed
- **Generated Cypress test fixtures could crash or click the wrong row for entities with a
  self-referential FK**: a self-ref dependency record (e.g. a split-lineage decoy) was
  created via an unconditional `prisma.create()` in `populate{{pascal}}Dependencies()` with no
  find-or-create guard, so calling the populate helper more than once in the same spec (routine —
  once per `it()` block) duplicated the row and could trip any `@@unique` constraint the entity
  declares. The same gap existed in `populate{{pascal}}Data`/`FullData`'s own per-iteration record
  creation. Both now reuse an existing row when the entity's own `@@unique`/`@unique` columns
  resolve to a value already available in scope. Separately, `cy.contains(deps.X.name)` is
  substring-based, so a self-ref decoy sharing a name prefix with the record under test (e.g.
  "Test Sku" vs "Test Sku 2") could make a DataGrid row-lookup click the decoy instead of the new
  record; for entities with a self-referential FK, this now uses an anchored exact-match instead.
  See `docs/knowledge/self-ref-dep-fixture-unique-collision.md`.
- **`x-generate.invalidate` enabled with no handler/module produced code that could not build**
  : `actions.ts.jinja2`'s fallback branch never imported anything (a bare runtime
  `throw`), while `invalidate_action_route.ts.jinja2`'s fallback branch unconditionally imported
  a file `generate.py` never wrote — `next build` failed the moment any entity took this branch.
  This repo's only `invalidate` consumer (`user`) always supplies an explicit handler/module, so
  the branch had never actually been generated before a downstream consumer hit it. `generate.py`
  now writes a write-once stub at `lib/{entity}/invalidate_handler.ts` (same convention as the
  existing `service_after_create.ts`/`service_after_approve.ts` extension-point stubs) that both
  templates now consistently import; the stub throws a clear, actionable error until a human
  implements real invalidate logic, so no default soft-delete behavior is introduced. Also
  generalized `invalidate_action_route.ts.jinja2`'s docstring, which hardcoded `user`-specific PII
  wording. See `docs/knowledge/invalidate-no-handler-write-once-stub.md`.
- **The no-handler/module invalidate stub called `prisma.<model>.update()` unconditionally, even
  when the Prisma model has no `invalidated_at` column** (regressing the fix
  above): a later change to `invalidate_handler_stub.ts.jinja2` replaced the safe `throw` with an
  unconditional default update against an `invalidated_at` column — for any entity whose model
  lacks that column, the write-once stub no longer throws a clear error, it fails to build.
  `generate.py` now reads the entity's actual Prisma column set (via `schema_deriver.
  parse_prisma_schema`, already parsed once per run) and only emits the default update when
  `invalidated_at` is present; otherwise it falls back to the original throw. Fixture coverage
  (`code_generator/tests/fixtures/invalidate_gate`) gained a `cog` entity (no `invalidated_at`
  column) alongside `sprocket` (has the column), and
  `test_invalidate_mechanism_fixture.py` now asserts on stub file *content* for both branches —
  the earlier fixture test only checked file existence and import statements, which is why this
  regression wasn't caught.
- **Item-master entity naming was silently hardcoded to `product`/`product_id` throughout the
  ledger/split generator**: any consumer naming its item-master entity or its
  pool entity's location/lot/expiration columns differently got no error — three independent
  breaks, all traced to literal-name comparisons instead of schema-derived resolution.
  1. `helper_context()`'s `needs_second` compared a reference name (the `x-display.table` key,
     e.g. `product`) against an entity name (e.g. `item`) on mismatched axes (snake_case vs
     camelCase on top of the name mismatch), so `primary: true` silently stopped working for any
     FK primary display field whose reference name differed from its target entity name, or was
     multi-word.
  2. `generate.py`'s item-field detector compared a relation's target entity literally against
     `'product'`, always returning `None` for any other name (e.g. `item`) — this disabled the
     split-route lot/product-mismatch check with no error, and the auto-allocate WHERE clause
     silently rendered a literal `.None` (an always-undefined property access Prisma treats as
     "no item filter"), reproduced and fixed with test coverage.
  3. `generators.py`'s ledger-transaction reservation code, `split_action_route.ts.jinja2`, and
     the three `ledger_*_stub.ts.jinja2` once-stub templates hardcoded the pool entity's own
     item/location/lot/expiration column names as literal `product_id`/`location`/`location_id`/
     `lot_number`/`expiration_date`.
  All three now resolve through `x-ledger-entities.<domain>`, extended with four new **required**
  keys (no defaults — a domain missing any of them fails loudly, naming the domain and the
  missing key): `itemField`, `locationField`, `lotField`, `expirationField`. This is a breaking
  schema-config change for any existing consumer already declaring `x-ledger-entities` — it must
  add these four keys (matching its current column names) before its next `generate-code` run, or
  generation fails immediately with a named error; no generated-code content changes as a result
  of adding them alone. See `docs/knowledge/appendix/inventory-reservation-split.md` §7–8.
- **Ledger row's location column is now an id-FK, not a denormalized display string**
  (superseding an earlier design, PR #269, before either shipped in a release): that earlier design taught the
  ledger row's location write to render the pool entity's declared `x-relationship.labelField`
  into a display-string snapshot (instead of hardcoding `.name`), plus a *reverse*
  `findFirst({ where: { <labelField>: <string> } })` lookup everywhere that string needed to be
  turned back into a location row. Decided instead to hold location by id on the ledger entity too
  (matching how the item-master FK already worked) — every write is now a plain id copy
  (`ledger.location_id = pool.location_id`), and no reverse lookup exists at all, in
  `ledger_adjust_stub.ts.jinja2`, `ledger_move_stub.ts.jinja2` (×2), `ledger_write_stub.ts.jinja2`
  (forward + `afterReject` re-identification), `split_action_route.ts.jinja2` (×3), and
  `generators.py`'s reserve-phase allocation code. `resolve_ledger_domain()` no longer resolves or
  returns `location_relation`/`location_label_field`/`location_label_target` — it no longer
  inspects the pool entity's `x-relationship` declaration at all for this purpose. The FK is
  `onDelete: Restrict` (a referenced location cannot be deleted, reproduced against a real
  database); renaming a location remains possible, with `x-audit: true` (an existing,
  entity-agnostic mechanism, not new) recording who renamed it and when. See
  `docs/knowledge/appendix/inventory-reservation-split.md` §7.1–7.2 and
  `docs/knowledge/appendix/cmd562-location-id-fk-consumer-migration.md` for the consumer migration.

### Security
- **Server Action approval endpoints could bypass multi-stage `preceded_by` ordering** — only the
  REST route enforced it via `assertApprovalOrder()`; the Server Action reachable from any
  authenticated client did not (a later-stage approval could succeed while an earlier stage was
  still pending). Both entry points now call the same check. See
  `docs/knowledge/appendix/approval-flow.md` §16.6.1.

### Fixed
- **`npm run cleanup` could wipe every translated `messages/ja.json` entry**:
  `cleanup.py` deleted every Fields/EntityLabel/Nav key belonging to any entity in the
  passed schema from `messages/*.json` — including entries for entities still in
  production use, not just genuinely removed ones. Since `npm run cleanup` always
  rebuilds its schema argument from whatever `json_schema.yaml` currently says, running
  it while a temp fixture entity was still present in the schema (a normal
  fixture-testing workflow — remove the fixture's generated files before reverting the
  schema file) wiped every real entity's translated keys too; a subsequent
  `generate-code` then refilled them with the English schema default, since
  `generators_i18n.py`'s own `_update_json` only fills genuinely missing keys.
  `cleanup.py` no longer touches `messages/*.json` at all. `generate-code` also now
  prints a `WARNING: untranslated keys added` line in the build log naming any key
  freshly added to a non-English locale file, so a partial translation gap is visible
  instead of silently looking like a fully-translated run. See
  `docs/knowledge/i18n-locale-routing.md` "`messages/*.json` are append-only, never
  generator-truncated".

- **Re-submitting a rejected approval request never notified the approver**:
  `resubmitApprovalRequest()` (both the server action in
  `lib/approval_request/actions_core.ts` and the REST route
  `app/api/approval_request/[id]/resubmit/route.ts`) transitions status back to `pending` by
  re-using the existing `approval_request` row rather than creating a new one, so
  `notifyApprovalRequestCreated()` — wired only into the creation path — never re-fired for a
  resubmission; approver-role holders were never told a rejected request needed their attention
  again. Both paths now call it again after the status flip. A related payload bug was fixed
  alongside it: the rejection notification's `status` field was hard-coded to `'rejected'` even
  for a `terminal_rejected` outcome (the notification itself always fired; only the payload was
  wrong). See `docs/knowledge/appendix/approval-flow.md` §16.6 and
  `docs/knowledge/notification-triggers.md`.
- **Fixed `migrate:deploy` running through Neon's pooled connection instead of a direct one** —
  Prisma's migration engine needs a session-scoped advisory lock that a transaction-mode pooler
  doesn't guarantee routes to the same backend connection. `prisma.config.ts` now prefers a new
  `DIRECT_URL` env var, falling back to `DATABASE_URL` where it isn't set; **on Vercel
  specifically, config loading now throws if `DIRECT_URL` is unset** (fail-closed against
  silently regressing to the pooled path). GCP Cloud Run and local/CI are unaffected. See
  `docs/knowledge/prisma-direct-vs-pooled-connection.md`.
- **Fixed two generated Cypress scaffold bugs**: a form with 2+ DataGrid children intermittently
  failed with "can only scroll 1 element, you tried to scroll 2 elements" (unscoped
  scroll-into-view selectors matched every grid on the page); and DataGrid-child
  date/date-time/time edit cells rejected every typed value (the generated test scaffold reused
  the top-level form's human-readable date format against the browser's native strict-ISO
  `datetime-local` input). Any project could hit either with a future date-typed DataGrid-child
  field.
- **Fixed generated test helpers' `populate*Data`/`populate*FullData` silently sharing one
  FK-dependency row across repeated calls in the same test** (no `db:reset` in between),
  entangling logically independent test scenarios. Both find-or-creates in `test_helper.ts.jinja2`
  are now unconditional `create()`s, with a per-entity `callIndex` counter keeping generated loop
  values collision-free. Generated fixtures are unaffected in form; the isolation matters for
  hand-written specs that call the same populate function more than once. See
  `docs/knowledge/cmd614-test-data-uniqueness-design.md` §4.4.
- **Generated test-helper dependency records now use a letter-indexed name suffix
  (`'Test {Title} A'`/`'Test {Title} B'`) instead of `'Test {Title}'`/`'Test {Title} 2'`** — the
  old naming collided byte-for-byte with `populate*Data(n)`'s own loop rows once a loop reached
  `i=2`, causing find-or-create to resolve both to the same DB row. See
  `docs/knowledge/cmd614-test-data-uniqueness-design.md` §3.
- **Fixed `exactRe()`'s exact-match Cypress helper being gated to only 2 self-referential
  entities** even though the `cy.contains()` substring-collision problem it guards against isn't
  specific to self-referential deps — widened to all entities, and scoped every call site to
  `.MuiDataGrid-cell` to avoid matching the header nav's own logged-in-user badge. Also
  re-anchored two post-render cleanup helpers on code structure instead of comment prose (both had
  silently stopped firing after an earlier edit) and widened one's `.then(` pattern match to
  tolerate `async`/typed callbacks.
- **Fixed 4 Completion gate docs (`update-generator`, `generate-schema`, `update-code`,
  `add-component`) running `npm run lint` after `generate-code`**, linting ~230 more generated
  files than CI's own `Lint` job ever checks and producing a mismatched warning count. `npm run
  lint` is now the first Completion gate step in all four. See
  `docs/knowledge/lint-gate-must-match-ci-precondition.md`.

### Removed
- **Removed the `x-relationships.<rel>.sameEntityField` schema key** and its generated
  `validateSameEntityRefs()` — a coincidental business rule (self-ref `preceded_by`/`followed_by`
  same-`entity_name` matching for `approval_flow`) had been generalized into the schema layer.
  Replaced with a purely structural socket: every entity now gets an unconditional write-once
  `service_validation_custom.ts` stub, and `approval_flow`'s own same-entity rule is now entirely
  hand-written. See `docs/knowledge/same-entity-validation-socket.md` (replaces
  `docs/knowledge/same-entity-field-mechanism.md`).

### Added
- **New `check:generated` gate rule, `test:unexplained-login`**: scans every generated
  `cypress/e2e/api/<entity>.cy.ts` for a `cy.login(` call with no `dual-auth-session-canary`
  marker comment above it, so a future template edit that reintroduces screen-operation coupling
  fails the gate instead of silently landing. See `docs/knowledge/testing-cypress.md`'s "API test
  / UI test boundary" section.
- **FK autocomplete search now derives from `labelField`; `x-relationship.searchField` is
  removed.** The two used to be independent declarations that could silently drift apart.
  **Breaking for schema authors**: `validate.py` now rejects any schema still declaring
  `searchField`. See `docs/knowledge/schema-yaml-configuration.md` §5.
- **CSV import now supports composite/dotted `labelField` FK columns** (previously export-only)
  — a CSV cell is matched against the full rendered label text. An ambiguous match is rejected
  at row granularity (`MULTI_MATCH`). See `docs/knowledge/csv-import-composite-labelfield.md`.
- **`x-self-only`: new entity-level flag for permission-independent, per-creator data
  isolation (Stage 1).** No permission grant (including `general.read`) can widen it; a
  non-owner's row reads as `404 Not Found`. `x-self-only: { admin_bypass: true }` allows
  privileged read, with a mandatory (fail-closed) audit write. The account **Settings** page now
  uses this (other users' settings are no longer reachable via any permission grant). Row-Level
  Security (Stage 2) is not implemented. See `docs/knowledge/self-only-entity.md`.
- **Post-login redirect-back with open-redirect protection** — signing in now returns to the
  originally-requested page (`?redirect=`) instead of always landing on `/`.
  `safeRedirectPath()` rejects off-site/protocol-relative/backslash-trick values, falling back
  to `/`. See `docs/knowledge/unauthenticated-page-redirect.md`.
- **`@mention` support, server and client.** New `MentionInput`/`MentionText` components and a
  `searchMentionUserOptions()` server action; wires into any entity's `x-mention: true` field
  and comment threads. Fires a new `'mentioned_in_comment'` notification. See
  `docs/knowledge/mention-system.md`.
- **Generated permission-denial and cross-org isolation API tests (batch A)**: every generated
  `cypress/e2e/api/<entity>.cy.ts` now includes PUT/DELETE/export/import permission-denial
  tests and, for org-scoped entities, cross-organization isolation tests. Adds the
  `db:createCrossOrgScenario` test-fixture task. See `docs/knowledge/permission-e2e-test-design.md`.
- **Graceful degradation for foreign-key read-permission gaps** — a role that can create/edit
  an entity but lacks read on one of its FK targets used to crash the create/edit page entirely;
  the affected field now renders disabled instead (read-only + blocks `/new` if required,
  clearable if optional). No Prisma/migration change. See
  `docs/knowledge/fk-read-permission-graceful-degradation.md`.
- **Terms of Service / Privacy Policy pages** (`/[locale]/legal/terms`,
  `/[locale]/legal/privacy`), linked from registration. Per-locale plain Markdown under
  `content/legal/`; both are explicitly labeled templates requiring legal review before real
  use. See `docs/knowledge/legal-documents.md`.

### Fixed
- **Mention-collection loops read the wrong field off the comment relation**
  : `getters.ts.jinja2` and `api_detail_route.ts.jinja2` read
  `c.creator_id` in both places that collect comment authors for
  `mentionUserContext`, but the comment type only ever declares
  `creator?: { id, name, image }` — a TypeScript compile error on any
  schema whose `comment_has_mention` branch actually renders (this repo's
  own schema never does, which is why the mandatory gate never caught
  it). Both loops now read `c.creator?.id`, matching the type; verified
  safe because `build_context.py` unconditionally includes the `creator`
  relation on every comment fetch that can reach these loops. See
  `docs/knowledge/mention-system.md`.
- **`searchMentionUserOptions()`'s permission-denied flag never reached the client**:
  the function returned an array with an ad-hoc `permissionDenied` property
  (`Object.assign([], { permissionDenied: true })`). Next.js Server Actions serialize return
  values through the RSC "flight" protocol, which — like `JSON.stringify` — only preserves an
  array's indexed elements, so the flag was silently dropped in transit and the picker's
  "suggestions unavailable" message never rendered even though the server correctly computed the
  denial. A component-level unit test couldn't catch this, since it calls the function in-process
  with no serialization boundary to cross. Contract changed to a plain
  `{ options, permissionDenied }` object. The identical pattern in `getters.ts.jinja2`'s
  `searchXxxOptions()` is presumed to share this bug and was **not** fixed here —
  flagged for a follow-up cmd. Also fixed: `generators_test.py`'s `comment_has_mention`
  test-generation gate missed the commentable one-to-one bridge form, so any entity using that
  (recommended) pattern silently got zero generated mention-UI test coverage; and `lib/prisma.ts`'s
  dynamic `import('@prisma/adapter-pg')` — which made client init depend on a top-level `await` —
  broke any Cypress Node task that transitively imports it, since Cypress's esbuild CJS bundling
  rejects top-level await outright. Switched to a static import (already the established pattern in
  `cypress/support/db-helpers.ts`). See `docs/knowledge/mention-system.md`.
- **Multi-stage approval chains never notified the next approver when their
  turn arrived**: a `preceded_by` chain creates every flow's
  `approval_request` up front, and every flow's approver role is notified
  once at that point — but a follow-on flow isn't actually actionable until
  its preceding flow(s) are approved, and nothing told those approvers when
  that moment came; they only found out by checking back themselves.
  `approveApprovalRequest()` (both independent implementations — the server
  action and the REST route) now sends a new
  `approval_order_reached` notification, distinct from the creation-time
  one, to any follow-on flow's approvers once its ordering constraint is
  satisfied. See `docs/knowledge/notification-triggers.md` "Approval
  order-reached notification".

### Security
- **MFA could be bypassed via Google OAuth sign-in**: `mfa_enabled` was only checked in the
  credentials sign-in path, so an SSO-provisioned user with MFA enabled reached a fully
  authenticated session via Google without a TOTP/recovery-code prompt. The `jwt()` callback now
  blocks every protected route behind a new `/mfa-challenge` page until MFA clears; a new
  `user.mfa_token_version` column also revokes an already-active session when MFA is enabled. See
  `docs/knowledge/authentication.md` "MFA on the OAuth path".

### Fixed
- **CSV import dotted-FK org filter gap** (security): a dotted `x-import-key` lookup
  (e.g. `role.name`) on an organization-scoped entity's CSV import route was not itself
  organization-filtered — a same-named row owned by a different organization could resolve and
  get linked to the importing actor's record. The dotted-FK lookup is now org-filtered whenever
  its *target* entity has `organization_id`, independently of the parent entity's own scoping;
  system-global lookup targets (e.g. `role`, no `organization_id`) are correctly left unfiltered.
  Covers both CREATE and UPDATE (shared resolution path); export was already correctly scoped.
  Template-layer change only, no Prisma schema change — regenerate to pick it up, no migration
  needed. See `docs/knowledge/csv-import-dotted-fk-org-filter.md`.
- **CSV import silently dropped screen-editable FK columns not declared in `x-import-key`**
  : an FK relation editable on screen (e.g. `approval_flow.requestor_role`) but absent
  from `x-import-key` had no CSV-import write path at all — the route answered `200 succeeded`
  while discarding the column, on both CREATE and UPDATE. Separately, even a *declared* dotted
  `x-import-key` FK was never rewritten on UPDATE (only merged into CREATE data via `keyWhere`).
  `import_fk_specs` now covers every screen-editable FK relation with a simple (non-composite)
  labelField — resolved via the same lookup-by-label mechanism as a dotted key, written to both
  CREATE and UPDATE. A required FK newly made resolvable this way can also flip
  `import_can_create` from infeasible to feasible for entities like `approval_flow` whose
  required FK wasn't previously part of the key. Exported FK columns that still have no write
  path (composite labelField, or read-only) now reject the import with a new
  `UNIMPORTABLE_COLUMN` error instead of silently succeeding. Template + generator-context
  change only, no Prisma schema change. A KEY-field null→value transition still creates a
  phantom duplicate row rather than updating in place — a separate, deeper natural-key-matching
  limitation, deliberately left unfixed; see the doc's "Known gap" section. See
  `docs/knowledge/csv-import-non-key-fk-write-path.md`.
- **Fixed a HIGH-severity transitive CVE (fast-uri, GHSA-7p8r-x3mc-p8w7) blocking the Dependency Audit gate**,
  plus 6 moderate advisories, via narrow non-breaking `overrides` (no forced major bump, no
  `@google-cloud/storage` downgrade). `npm audit --omit=dev --audit-level=high` now reports 0
  vulnerabilities.
- **Fixed `x-approval.set_fields` documentation contradicting the implementation** (showed a
  list-of-`{field, value}` form; only a mapping form is actually accepted) — a schema author
  following the wrong doc form hit an uninformative `AttributeError`. Corrected the doc and added
  a `validate_schema()` check that now rejects a non-mapping `set_fields` before generation runs,
  naming the entity and offending key.
- **`npm run lint` now enforces a warning ceiling** (`--max-warnings 20`) after 216
  unused-vars/expressions warnings — one a genuine dead branch — had silently accumulated behind a
  config gap. The ceiling only ever ratchets down. See `docs/knowledge/lint-warning-ceiling-ratchet.md`.
- **Fixed generated-test Decimal values being a fixed literal that overflowed narrow
  `@db.Decimal(p, s)` columns** (e.g. `Decimal(5, 4)` rejecting `'10.00'` with a Postgres numeric
  field overflow, discovered via a real schema with 36 tests failing this way) — test values are
  now derived from the column's own `x-decimal-scale`/`x-decimal-precision`, including the
  all-fractional edge case.

## [3.0.0] - 2026-07-30

> Consolidates the feature areas added since 2.0.0: GCP Cloud Run deployment,
> an audit log viewer, GDPR/data-protection tooling, attachment display
> opt-out, a round of performance hardening, an inventory ledger with
> receiving/reservation workflows and split actions, CSV import/export,
> extended search and FK autocomplete/auto-inference, notification
> persistence, the single-file entity schema format, `nativeEnum` type
> safety, and organization-isolation enforcement. Released as a major bump
> because the performance, data-protection, audit-log, notification-
> persistence, enum-type-safety, and organization-isolation work include
> breaking changes.
> Full upgrade steps: [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md).

### BREAKING
- **`statement_timeout` now enforced by default (soft breaking)** — the direct
  (PrismaPg) Prisma connection path (`lib/prisma.ts`) now applies a 30-second
  `statement_timeout` by default. Queries that previously ran unbounded (large
  exports, complex reports) will now fail with a timeout error if they exceed
  30 seconds. Configurable via the `STATEMENT_TIMEOUT_MS` env var; set it to a
  higher value or `0` to disable. Applies only to the direct-connection path —
  the Accelerate path (Vercel's `PRISMA_DATABASE_URL`) does not forward
  `statement_timeout` and is unaffected.
- **`pageSize > 200` now returns `400 Bad Request` (API contract breaking)** —
  generated REST API routes (`code_generator/templates/api_route.ts.jinja2`)
  previously truncated an over-limit `pageSize` query parameter to 200
  silently. They now reject it with `400 Bad Request`. Existing API clients
  that send `pageSize` above `MAX_PAGE_SIZE` (200) must cap the value
  client-side before upgrading.
- **`user.anonymized_at` column now required (soft breaking)** — the new
  `anonymizeUser()` GDPR-erasure function (`lib/compliance/anonymize_user.ts`)
  reads/writes `anonymized_at` on the `user` model. 3.0 adds the column as
  nullable. Pre-3.0 databases must add it: `prisma db push` or
  `prisma migrate deploy`. New nullable column — no backfill required (see
  [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md)).
- **`audit_log.actor_user_id` now enforces a foreign key to `user.id` (schema
  breaking)** — `prisma/schema.prisma`'s `audit_log.actor_user` relation
  (`onDelete: Restrict`) and the matching `user.audit_logs` back-relation were
  added in `ec2cbb8` ("fix: Show audit log page", 2026-06-26), after the
  2.0.0 cut (`git log`/`git blame` confirm both fields are absent at the
  `v2.0.0` tag). Pre-3.0 schemas have no such constraint. `prisma db push` /
  `prisma migrate deploy` will fail if any existing `audit_log.actor_user_id`
  value references a `user` row that no longer exists — possible because the
  pre-3.0 schema let a `user` be deleted without touching their audit history.
  Clean up orphaned rows first, e.g.
  `UPDATE audit_log SET actor_user_id = NULL WHERE actor_user_id IS NOT NULL
  AND actor_user_id NOT IN (SELECT id FROM "user");`. Going forward, deleting
  a `user` with existing `audit_log` rows is rejected instead of silently
  orphaning them.
- **`nativeEnum` promotion for 6 previously-`Int` enum fields** — if any
  generated application read or wrote these columns using raw integer values
  rather than the generated enum constants, those values may fail Prisma's
  enum validation after upgrade. Affected fields: `approval_request.status`,
  `reaction.type`, `attachment.type`, `dashboard_widget.chart_type`,
  `dashboard_widget.stack_mode`, `dashboard_widget.group_by_bucket`. `prisma
  db push` or `prisma migrate deploy` required.
- **Notification persistence requires the new `notification` table** — the
  in-memory SSE notification store was replaced with a Prisma-backed
  `notification` table. Until the table is created, `GET
  /api/notifications` and `POST /api/notifications/mark-read` throw and
  return `500` to every logged-in user (the bell icon is on the shared
  header); notification writes fail silently instead. `prisma db push` or
  `prisma migrate deploy` required.
- **Organization-scoped mutation paths now deny cross-org access** —
  generated API routes and server actions for org-scoped entities previously
  authorized update/delete/CSV-import-update purely via
  `creator_id`/`assignee_id`, without checking organization membership,
  allowing a user with `general.update`/`general.delete`/`general.import` to
  act on another organization's record by ID. Cross-organization requests
  now resolve to a deny (`404` on API routes, silent no-op on session
  actions). No schema change; only bites a deployment whose client or test
  code depended on the old (permissive) cross-org behavior.
- **nativeEnum member names normalized to lowercase snake_case** —
  `ApprovalRequestStatus` (`Pending`/`Approved`/`Rejected`/`TerminalRejected`
  → `pending`/`approved`/`rejected`/`terminal_rejected`) and `ReactionType`
  (`Like`/`Love`/`Laugh`/`Surprised`/`Sad` → lowercase) are the only two
  PascalCase nativeEnum types app-generator itself ships; an inventory
  across the full default schema + the app-template consumer schema found
  lowercase snake_case already the established majority (16/20 nativeEnum
  types, 61/80 members). `code_generator/validate.py` now rejects any
  nativeEnum member that isn't lowercase snake_case at generation time.
  Existing consumer data must be migrated — see
  [docs/knowledge/enum-member-naming.md](docs/knowledge/enum-member-naming.md)
  for the naming rule, rationale, consumer-impact list, and the exact
  migration SQL (verified against an isolated test database seeded with
  pre-migration rows).
- **`db:seed-tenant` now requires `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
  under `NODE_ENV=production`** — `scripts/seed-tenant.ts`
  previously seeded the bootstrap admin as `admin@example.com` /
  `password123` with a fixed `api_key` literal unconditionally; since
  app-generator is a public repo, any production deployment provisioned
  without a separate manual rotation shipped with a publicly known admin
  login. Every production-equivalent entry point (`vercel-build`,
  `build:full`, GCP's `gcp-seed.sh`) now fails fast unless both env vars are
  set, and always mints a fresh random `api_key` instead of the literal.
  `test`/`development` are unaffected — the fixed defaults are unchanged, so
  existing Cypress/vitest fixtures pinned to them keep working. See
  [docs/knowledge/seed-baseline-credential-hardening.md](docs/knowledge/seed-baseline-credential-hardening.md)
  for the required env vars and the remediation runbook for a deployment
  already seeded with the old defaults.

### Added
- **GCP Cloud Run deployment** (`x-cloud` annotation, opt-in — disabled unless
  `enabled: true` and `provider: gcp` are both set explicitly) — **Vercel
  remains the default deployment target when `x-cloud` is unset**; this adds
  GCP Cloud Run as a second, opt-in target, alongside:
  multi-stage/non-root/`HEALTHCHECK` `Dockerfile`, `.dockerignore`,
  `next.config.ts` `output: 'standalone'`, a GCS Signed URL upload route
  (overrides the default Vercel Blob route), a V4 Signed URL proxy route, and
  `proxy.ts` header rewriting so Cloud Run's internal `:8080` port never leaks
  into a redirect `Location` header. Idempotent environment automation scripts
  (`scripts/gcp-env.sh`, `gcp-setup.sh`, `gcp-deploy.sh`, `gcp-seed.sh`,
  `gcp-teardown.sh`) provision Cloud SQL/service account/Upstash/Secret
  Manager/GCS and drive build+migrate+deploy. See
  [docs/knowledge/gcp-automation-design.md](docs/knowledge/gcp-automation-design.md).
  Pure opt-in — zero impact on existing (Vercel-default) apps.
- **Audit log viewer** — `app/[locale]/audit_log/page.tsx`, a schema-agnostic
  read-only viewer over the `audit_log` model. `lib/audit_log/getters.ts`
  resolves the actor user via FK join, restricts the raw `metadata` JSON to the
  admin-only detail page, and paginates via `CardListPagination`. The
  `audit_log` model's core columns (id/actor_user_id/action/target_table/
  target_id/metadata/created_at) predate 2.0.0, but the `actor_user` relation
  it's joined through is new in 3.0 — see BREAKING above.
- **Data protection / GDPR compliance** — `x-pii` annotation (`direct` /
  `sensitive` / `indirect` classification), `anonymizeUser()` scrub function
  (irreversible, transactional, preserves referential integrity), `x-gdpr-mode`
  (model/field-level `internal` / `consumer` / `both` data-subject-scope
  classification — validated by `code_generator/validate.py` but not yet read
  by any codegen template, so it has no effect on generated code in 3.0),
  AES-256-GCM at-rest attachment filename encryption
  (`lib/compliance/attachment_name_crypto.ts`), and `x-mention` user-mention
  parsing in comments.
- **Attachment display opt-out** — `AttachmentSection` (`components/_standard/`)
  gains `showImages` / `showFiles` props (both default `true`) so image/file
  previews can be hidden per entity independently.
- **Performance hardening** — automatic FK index coverage
  (`scripts/add_required_indexes.py`, generator demo schema grew from 18 to 36
  indexes), a generated pg_trgm GIN index script
  (`scripts/create-gin-indexes.sql`, kept outside `prisma/schema.prisma` to
  avoid a `prisma migrate dev` drift loop), and a `SearchOpts.count: false`
  opt-out that skips both `COUNT(*)` queries in cross-entity search
  (returns `total: -1`).
- **Inventory ledger with `x-ledger-source`** — `inventory_transaction`
  ledger entity and `transactionable` bridge generated when a ledger
  top-level declaration is present in `json_schema.yaml`. Annotate a
  receiving-receipt line or billing-detail entity with `x-ledger-source`
  to emit write / adjust / move stub templates (`ledger_write_stub.ts`,
  `ledger_adjust_stub.ts`, `ledger_move_stub.ts`).
- **Receiving workflow** — top-level `ledger` / `transactionable` / `pool`
  entity declarations and `receiving_confirm_route.ts` generated for
  receiving-receipt schemas. Replaces the `x-receiving` mechanism removed
  earlier in the 3.0 development cycle.
- **Reservation ledger-transaction migration** — `x-reservation`'s internal
  state tracking migrated from slot-based to ledger-transaction strategy;
  each reservation records an `inventory_transaction` row for audit
  fidelity. `x-reservation` is scoped to exactly two roles: inventory
  allocation (`count` mode) and specific-resource reservation (`item`
  mode, e.g. a hotel room). Lifecycle transitions (approve/reject) for the
  entity that owns the reservation go through the generic Approval Flow
  System (`x-approval`) instead of a bespoke reservation-lifecycle
  mechanism — see **Removed** below for the `x-reservation.actions`
  sub-feature this supersedes.
- **Terminal rejection with `x-readonly-fields`** — annotate fields with
  `x-readonly-fields` to prevent edits after an entity reaches a terminal
  rejected state. `on_rejected_dispatch.ts` and `service_after_reject_stub.ts`
  are generated as once-stubs for custom post-rejection logic (not overwritten
  on `generate-code` re-runs). `rejection_reason` is wired into the reject
  route automatically.
- **Rejection event dispatch** (`on_rejected_dispatch`) — the `reject` API
  route fires `on_rejected_dispatch.ts` after a terminal rejection, enabling
  downstream logic such as notifications or inventory adjustments. Paired with
  `service_after_reject_stub.ts` for application-level customization.
- **Split action (`x-splittable`)** — annotate an entity with `x-splittable`
  to generate `SplitActionSection` (UI component) and `split_action_route.ts`
  (API). Enables lot-level split operations from the list or edit page without
  requiring a custom route.
- **CSV Export** — per-entity export route (`api_export_route.ts.jinja2`)
  generated when `x-generate.export: true` (default `true`). Exported columns
  match the entity's view-page field set; individual fields opt out via
  `x-generate.export: false` on the field declaration.
- **CSV Import** — user CSV import route (`api_import_route.ts.jinja2`) and
  `ImportModal.tsx` component generated when `x-generate.import: true`.
  Batch-processes rows server-side; access controlled via the `permission.import`
  grant per entity.
- **Search — child entities without a dedicated page** — entities with
  `x-page: false` now appear in global search results; hits resolve to the
  parent entity's edit page (method②). Previously only top-level entities
  appeared in search results.
- **FK Autocomplete custom filter hook** — `autocomplete_filter_stub.ts.jinja2`
  generated per entity for narrowing autocomplete and list results beyond the
  built-in permission filter. Wired into `SplitActionSection`'s FK context
  automatically.
- **FK scalar auto-inference** — FK scalar columns (e.g. `organization_id`)
  no longer need to be declared explicitly in `json_schema.yaml`; the generator
  derives them from Prisma relation properties, reducing per-entity schema
  verbosity.
- **`x-approval-lines` helpers** — annotate an approvable entity with
  `x-approval-lines` to generate pre-create / post-create helper functions that
  wire approval-line entities to inventory ledger operations.
- **Notification persistence** (DB-backed, cursor-based polling) — in-memory
  SSE notification store replaced with a Prisma-backed `notification` table.
  Cursor-based DB polling delivers unread notifications reliably across server
  restarts. See BREAKING above — the new table requires `prisma db push` on
  existing databases.
- **Single-file entity format** (`_detail` suffix retired) —
  `json_schema.yaml` entity declarations no longer require a paired `*_detail`
  block; the generator derives field types directly from the Prisma schema.
  `build_user_schema.py`'s Prisma-derivation pipeline updated accordingly.
- **enum type safety — `nativeEnum` promotion** — 6 previously-`Int` enum
  fields promoted to Prisma `nativeEnum`; generated code gains compile-time type
  checks. See BREAKING above for the affected fields and migration steps.
- **Organization isolation enforcement** — generated API routes for org-scoped
  entities deny create / update / delete across organization boundaries. A
  session-lookup miss in an org-filtered query now returns an explicit deny
  rather than a silent miss. See BREAKING above — a client or test relying on
  the old cross-org behavior will now be denied.

> **Backward compatibility**: GCP deployment and attachment display opt-out
> are non-breaking (pure opt-in / default-preserving). FK index coverage
> (`scripts/add_required_indexes.py`), the pg_trgm GIN index script
> (`scripts/create-gin-indexes.sql`), and the `SearchOpts.count: false`
> COUNT(*) opt-out are additive only and backward-compatible. The audit log
> viewer page itself adds no required input, but it surfaces data through a
> relation that is a breaking schema change — see BREAKING above. All eight
> items in **BREAKING** above require action before upgrading a pre-3.0
> deployment — see [docs/UPGRADE-3.0.md](docs/UPGRADE-3.0.md).

### Fixed
- **Non-idempotent Cypress spec generation for enum labels** — `generate-code`
  used to feed `messages/en.json`'s existing content straight into the
  Cypress spec label lookup. A first run against a project with an
  incomplete/missing translation section produced specs with raw enum
  values (e.g. `'pie'`) baked in, while the same schema on a later run (once
  the file had been filled in) produced humanized labels (e.g. `'Pie'`) —
  and the raw-value run's specs no longer matched what the app actually
  renders, failing with `Expected to find content: 'pie' ... but never
  did`. `generate()` now always computes the schema-derived label defaults
  first and overlays any existing file values on top (file wins), so both
  runs agree and a consumer's custom translation is still honored. See
  `docs/knowledge/generate-code-idempotency.md`.

### Removed
- **`x-reservation.actions` sub-feature (2026-07-30 ruling)** — the declarative
  `ship` / `release` / `cancel` lifecycle-action mechanism under `x-reservation`
  (`reservation_actions.ts` generation, per-action
  `app/api/{parent}/[id]/actions/{ship,release,cancel}/route.ts` handlers, and the
  `ReservationActionButtons` UI component) has been removed. `x-reservation` is
  retained, scoped to exactly two roles: (1) inventory allocation (`count` mode) and
  (2) specific-resource reservation (`item` mode, e.g. a hotel `room`). Approval/
  rejection lifecycle for the owning entity goes through the generic Approval Flow
  System's `approve` / (terminal) `reject` instead (`x-approval`). No entity in the
  default schema or any known consumer schema ever declared an `actions` block, so
  this closes zero generated-output diff for existing apps — confirmed by comparing
  `generate-code` output before/after this change (identical). `code_generator/
  validate.py` now hard-rejects any schema that still declares `x-reservation.actions`.
  See [docs/knowledge/appendix/inventory-reservation-split.md](docs/knowledge/appendix/inventory-reservation-split.md)
  §1.1.

## [2.0.0] - 2026-06-25

> Consolidates the unreleased 1.5 feature set and corrects two breaking changes
> that shipped silently in 1.4 (comment reactions) and 1.5-dev (approval
> dispatch). Released as a major bump rather than patches because 1.5 was never
> announced. Full upgrade steps: [docs/UPGRADE-2.0.md](docs/UPGRADE-2.0.md).

### BREAKING
- **`reaction` model now required** (comment reactions, static since 1.4) — the
  comment-reaction code (`app/api/comment/[commentId]/reactions/toggle/route.ts`,
  `lib/db_table/actions.ts`, `CommentReactionBar.tsx`) calls `prisma.reaction.*`
  unconditionally, but the generator did not emit the model, so 1.3-era schemas
  failed to build. 1.4 adds `reaction` (+ `user`/`comment` relations,
  `@@unique([comment_id, user_id, type])`, indexes). Pre-1.4 databases must add
  the table: `prisma db push`, or `docs/sql/2.0-reaction.sql`. New empty table —
  no backfill.
- **`approvable.approved_at` column now required** (approval dispatch) —
  `approve/route.ts` and `lib/approval_request/actions.ts` read/write
  `approved_at` unconditionally as the fire-once idempotency flag, but the
  generator did not emit the column. 2.0 adds the nullable column. Pre-2.0
  databases must add it (`prisma db push`) and run the already-approved backfill
  so historical items are not re-dispatched: `docs/sql/2.0-approved_at-backfill.sql`.
- Both are additive (new table / new nullable column / new indexes), so
  `prisma db push` applies them without data loss. Verified non-breaking back to
  1.0 once present.

### Added
- **Cross-entity full-text search** (`x-generate.search: true`) via PostgreSQL FTS + pg_trgm + pg_bigm:
  - `GET /api/search` REST endpoint generated when searchable entities exist; UNION ALL query across all opted-in entities with tenant and permission filters applied per entity
  - `app/[locale]/search/page.tsx` global search UI (mobile-responsive client component) with search box, entity-type chip per result, snippet, and "View details" link
  - Facets — per-entity hit counts returned in `facets` field; rendered as filter chips above results
  - Snippet highlight — `ts_headline` output with XSS-safe `<<<`/`>>>` markers converted to `<mark>` tags in the UI
  - `text_fields` auto-derivation from entity properties: excludes PKs, FKs (`*_id`), enum fields, CUID-pattern strings, date/URI formats, and `x-search: false` opt-outs; entities left with no text fields are skipped from UNION
  - Authorization reuse: search WHERE clauses use the same `build<Entity>AccessWhere` / `RichPermissions` logic as list pages — no separate permission configuration needed
  - `x-audit: true` entities default to `search: false` (audit-safe by default); opt in with `x-generate.search: true`
  - `x-search.org_id_field` hint for entities where the organization key is not `organization_id` (e.g., `organization_detail.id`)
  - Global header search icon linking to `/search` (authenticated users only); i18n keys `Header.search` / `Header.searchAriaLabel`
- **Approval event dispatch** (DP-1~4) — post-approval hooks fired on `approve`:
  - `approvable.approved_at` DB timestamp flag for fire-once idempotency (prevents re-firing on re-approval)
  - `x-approval.on_approved.set_fields` — arbitrary field updates performed at approval time; integer/enum target fields receive the correct integer index (not a label string)
  - `x-approval.on_approved.emit_hook` — generated `service_after_approve.ts` once-stub for custom post-approval logic (not overwritten by `generate-code` re-runs)
  - `on_approved_dispatch.ts` generated per approvable entity; wired into both the API key (`approve/route.ts`) and server-action (`actions.ts`) approval paths

### Changed
- **`x-ui.rows`** — textarea row count is now schema-driven for any string field via `x-ui.rows: N` in the schema; previously only `description` fields had a hardcoded 4-row default
- **`x-ui.width`** — control form-field width on desktop; integer = 1–12 grid columns, string = literal CSS; mobile always 100%
- **Mobile header** — Setting link and Sign Out button hidden on mobile (`md:hidden`) to prevent header overflow; a mobile-only account section (Setting + Sign Out) added to the sidebar drawer with an `<hr>` separator

### Fixed
- Approval flow: the code generator updated to generate service_after_create.ts stub with approval requests for entities using approval flow

> **Backward compatibility**: Cross-entity search is opt-in per entity (`x-generate.search: true`). Approval event dispatch requires `x-approval.on_approved` in the schema to activate. **Correction:** the pre-release 1.5 note claimed "no breaking changes" — that was wrong. Upgrading a pre-2.0 database requires the additive schema changes listed in the **BREAKING** section above; see [docs/UPGRADE-2.0.md](docs/UPGRADE-2.0.md).

## [1.4.0] - 2026-06-18

### Added
- **Comment reactions** — reaction buttons on comment threads:
  - Integer-enum reaction kinds backed by named constants (`reaction_constants.ts`)
  - Per-comment toggle endpoint generated (`/api/comment/{commentId}/reactions/toggle`)
  - Batched reaction aggregation (single grouped query) and parent-owner read authorization
  - `CommentReactionBar` rendered inline within comment threads
- **Generalized bridge pattern** — the bridge mechanism previously dedicated to comments and attachments is now a reusable, schema-level relationship capability:
  - Real one-to-one relations via an internal through-table (`<model>able`) — no extra FK columns on the parent, and parent autocomplete is preserved
  - Internal bridge tables are omitted from the JSON schema output
  - Parent-label resolution (`labelField` → `x-display` primary → fallback), parent-context-only child creation, read-only parent fields on child forms, and child `DataGrid` lists on parent edit pages

### Changed
- **Wrapper components (round 2)** — auto-generated code no longer depends on MUI directly. Generated components import shared `App*` wrappers from `components/ui/` instead of `@mui/*`:
  - Hybrid wrapper API; `sx` confined to wrapper internals; icons referenced by name; public prop types defined independently of MUI
  - Outcome: MUI imports eliminated from generated output (provider setup excepted)
- **UI improvements** — consumer-grade default styling for generated apps: refreshed theme tokens (header / sidebar / footer), MUI palette and typography (Inter / Noto Sans JP), rounded surfaces, and responsive list/card layouts

> **Backward compatibility**: ~~Non-breaking from v1.3. Existing schemas work unchanged; comment reactions and the generalized bridge are opt-in. No breaking changes.~~ Comment reactions feature turned out to be breaking. See changelog for 2.0.0.

## [1.3.0] - 2026-06-10

### Added
- **Dashboard charts** — full chart rendering is now generated for entities with `x-display.dashboard: true`:
  - Chart types: `column`, `bar`, `line`, `pie` (string discriminator in schema via `chart_type`)
  - Stacking modes: `grouped`, `stacked`, `standardized` with `series_field` support
  - Timestamp bucketing and typed multi-condition filters (number / datetime)
  - CSV and Excel export per chart widget
  - REST aggregate endpoint (`/api/{entity}/aggregate`) generated alongside CRUD endpoints
  - Audit FK columns (`creator_id` / `updater_id`) added to dashboard catalog
- **Inventory reservation** (`x-reservation`) — schema-level opt-in for capacity and inventory management:
  - `mode: count` — conditional `UPDATE` on a numeric counter column (e.g., purchase order quantity reservation)
  - `mode: item` — row-level lock via a per-entity `inventory_allocation` bridge table
  - Schema validation enforced at `validate.py` with pytest coverage
  - E2E Cypress test generator templates for reservation flows
- **Integer enums** — `type: integer` fields with `enum` (string label array, values correspond to array indices) emit integer `Int` columns in Prisma (e.g., `status Int @default(0)`); dashboard fields (`chart_type`, `stack_mode`, `group_by_bucket`) migrated to integer enum
- **Wrapper component architecture** — per-entity generated components now use shared wrappers from `components/_standard/` (statically provided; not overwritten by `generate-code` re-runs):
  - Phase 1: `page_list` wrapper + `components/ui` scaffold
  - Phase 2: `FormUpsert` / `FormView` field wrappers
  - Phase 3: relation and accordion wrappers
  - Phase 4: `FormView` detail shell

### Fixed
- Optional primary FK now correctly included in `populateData` and POST body generation
- Read-only list correctly rendered for one-to-many with independent children and mandatory FK from child to parent
- E2E test regression introduced by integer enum migration resolved
- `Prisma.raw` removed from dashboard aggregation; native Prisma query builder used throughout
- `generate-code` now respects schema-defined default for integer enum fields in child-grid `createNew`

> **Backward compatibility**: Non-destructive from v1.2. Old schema is still usable as it is.
> `x-reservation`: New notation is necessary only if new features are used
> No Breaking Changes

## [1.2.0] - 2026-06-04

<!-- Security tracking: upstream-pending vulnerabilities -->
<!-- D1: prisma -> @hono/node-server (CVSS 5.3) - awaiting upstream fix -->
<!-- D3: cypress -> qs DoS (CVSS 5.3) - awaiting upstream fix in cypress -->

### Added
- Virtual display columns: fields that do not exist in `properties` under `x-display.table` can now be declared as display-only columns (virtual columns).
  Value supply is handled by a per-entity async bulk resolver in `lib/{entity}/virtual_resolvers.ts` (`resolveVirtualColumns(rows)`), and generate-code does not overwrite existing files.
  When custom logic is absent, the default is an empty string.
- Virtual resolver guide: recorded the spec of the async/bulk/per-entity single-file resolver in `docs/knowledge/virtual-resolver-guide.md`

### Fixed
- Deep labelField Prisma include merge: fixed the issue that relations with nested `label_field` are not merged correctly (commit 7aab3c9).

## [1.1.0]

### Added
- Default-deny authorization: new users start with zero permissions; Administrators
  must explicitly grant entity-level permissions via the Permission management UI
  or `db:grantAllPermissions` script. Role-based access control is enforced at the
  API layer (`lib/authz.ts`).
- Multi-factor authentication (MFA) via TOTP:
  - Time-based one-time password (TOTP) support
  - AES-256-GCM encrypted secret storage
  - 8 recovery codes generated at enrollment, stored as bcrypt hashes
  - Self-service enrollment UI at Settings → Security (`/setting/mfa`)
