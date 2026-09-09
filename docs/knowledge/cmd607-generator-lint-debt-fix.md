# Generator-side lint debt (post generate-code, invisible to CI)

## The problem it solves

`npm run lint` (`eslint --max-warnings 20`) is clean at HEAD (generated files are gitignored — see
`.gitignore`'s `cypress/e2e/*.cy.ts`/`app/api/*/` entries — so CI's `Lint` job, which runs `npm ci &&
npm run lint` with **no** `generate-code` step (fixed order confirmed by an earlier investigation), only ever lints
hand-written source). But `npm run generate-code && npm run lint` — the order the local mandatory
gate actually uses — surfaced 83 warnings (0 errors) as of 2026-08-07/08 (that investigation aside; re-measured
today after a couple of follow-up fixes landed on `develop`, still 83). Nobody had ever counted them because nothing
in CI or the local gate's `--max-warnings 20` failed on them (they're spread thin enough per rule that
no single file crossed the CLI's own per-run cap in isolation, and the CLI counts total warnings
across the whole run, so pre-existing headroom absorbed them).

Breaking the 83 down by rule (not by the single "unused argument" cause originally guessed) found
**three independent root causes**, only one of which was actually about unused arguments:

| Rule | Count | Root cause |
|---|---:|---|
| `@typescript-eslint/no-unused-expressions` | 48 | Chai getter-assertion false positive (see below) |
| `@typescript-eslint/no-unused-vars` | 30 | Dead imports/consts across several unrelated template branches |
| `@next/next/no-img-element` | 5 | Pre-existing, unrelated to generate-code, **left untouched** (see Scope) |

After this fix: **5** (only the `no-img-element` warnings remain — see Scope). All 78 `no-unused-*`
warnings are gone.

## Root cause 1 (58% of the debt): Chai getter assertions, not real unused expressions

`cypress/e2e/api/*.cy.ts` (rendered by `test_api_spec.cy.ts.jinja2`) emits assertions like
`expect(res.body.results[0].success).to.be.true;` and `expect(res.body.id).to.exist;`. Chai's `.true`
and `.exist` are **property getters** with the assertion as a side effect, not function calls —
`@typescript-eslint/no-unused-expressions` has no notion of Chai's assertion-chain semantics, so it
flags every one of these as a dead expression statement. This is a well-known false positive in the
eslint+chai/cypress ecosystem (the standard fix elsewhere is `eslint-plugin-chai-friendly`); the
assertions themselves are correct and load-bearing.

**Fix**: `eslint.config.mjs` gets a new override disabling `@typescript-eslint/no-unused-expressions`
for `cypress/e2e/api/**/*.cy.ts` only (the only files where this pattern occurs — confirmed by
grepping the full warning list, not assumed). Config-level, not a template change — the eslint config
ships with app-generator like any other repo file.

## Root cause 2: dead imports/consts across three unrelated template branches

None of these three share a mechanism; each is its own narrow, targeted fix in the `.jinja2` template
(or, for the last one, in `generate.py`'s render pipeline) — resist the urge to unify them, they aren't
the same bug wearing different clothes:

1. **`formatLabelValue` unconditionally imported, never referenced** — `api_import_route.ts.jinja2`
   imported it unconditionally in every entity's generated import route, but composite/dotted FK
   label matching in this template uses `import_label_expr` (built in `build_context.py`) inline, not
   this helper. Genuinely dead in all 5 entities that had an import route (confirmed: import count
   equals reference count, both 1, in every one). Removed the import line — no conditional needed,
   it was never used anywhere in the file.
   >
   > **Correction (a later fix, 2026-08-09)**: this judgment was correct for the template snapshot at
   > the time, but wrong in general — `import_label_expr` is a *string built in Python*
   > (`build_context.py`, via `build_label_expression()`) and spliced into the template through
   > `{{ spec.import_label_expr }}`. A static read of the `.jinja2` source can never see whether that
   > string calls `formatLabelValue()`; it depends entirely on the target entity's labelField shape at
   > generation time. A later change (labelField composition, landed after this fix) made composite
   > labelFields able to include date/time-formatted segments, and `import_label_expr` started
   > calling `formatLabelValue()` for such entities (real case: proj_g `goods_receipt_line`,
   > labelField `[product.code, lot_number, expiration_date]` — broke PR#16's TS build with "Cannot
   > find name 'formatLabelValue'"). The unconditional removal above was itself the same class of
   > "looks dead by static text, isn't dead once `{{ }}` is accounted for" mistake this doc is about —
   > just on the *deleting* side rather than the *leaving-in* side. Fixed by restoring the import,
   > gated the same way `column_def.tsx.jinja2` / `form_view.tsx.jinja2` / `form_upsert.tsx.jinja2` /
   > `page_list.tsx.jinja2` / `getters.ts.jinja2` / `split_action_section.tsx.jinja2` /
   > `test_helper.ts.jinja2` already gate this same import elsewhere: a boolean
   > (`import_uses_format_label_value`) computed from `build_label_expression()`'s own `has_format`
   > return value, not from any pattern-match over the rendered template text.
   > `import_uses_format_label_value = any(s.get('has_format') for s in import_fk_specs)` in
   > `build_context.py`; `has_format` threaded onto each composite `import_fk_specs` entry from the
   > candidate-rooted `_xrl_import_built` label expression (the same helper call the export-side
   > `export_uses_format_label_value` already used — see `x_relationships_list['import_has_format']`).
   > Regression coverage: `test_format_label_value_imported_when_composite_spec_needs_it` /
   > `..._import_absent_when_flag_false_even_with_composite_spec` in
   > `test_import_template_branches.py` (template-level), and
   > `TestCompositeLabelFieldImportUsesFormatLabelValue` in `test_build_context.py` (Python-level,
   > exercises the real `build_context()` path end to end with a date-typed labelField segment).
   > The other two dead-binding fixes in this section (`fkData`, `richPerms` below) were re-audited
   > and are **not** vulnerable to this same blind spot — both gate their usage behind the identical
   > static `{% if %}` condition as their declaration (`import_can_create`, `is_self_only`
   > respectively), so declaration and usage can never desync the way a Python-computed string can.

2. **`fkData` declared/written unconditionally, but only read by the CREATE branch** — same
   template's `const fkData: Record<string, unknown> = {}` and its two `fkData.<col> = _<col>;`
   write-sites ran regardless of `import_can_create`, but the only consumer (`...fkData` spread into
   the create payload) is inside the `{% if import_can_create %}` block. Entities with
   `import_can_create: false` and at least one non-key FK spec (e.g. `user`) got a dead `const fkData`
   with no references. The resolved `_<col>` value itself is still computed unconditionally —
   `updateData` needs it regardless of create support — only the `fkData` object's declaration and
   two write-sites are now gated by `{% if import_can_create %}`. Covered by
   `test_import_can_create_false_omits_dead_fkdata_const_and_writes` /
   `..._for_composite_spec` / `..._true_still_declares_and_writes_fkdata` in
   `test_import_template_branches.py`.

3. **`richPerms` bound unconditionally in `api_bulk_route.ts.jinja2`'s PUT/DELETE, but only read in
   the non-self-only branch** — `x-self-only` entities (e.g. `setting`) gate purely on
   `existing.creator_id === actorId` and never reference `richPerms.general/creator/assignee`; only
   the non-self-only branch does. The `requireApiPermission(...)` call must still run unconditionally
   (it's the actual authorization gate — throws on denial), so the fix binds it to a name only in the
   `{% else %}` (non-self-only) branch and calls it unbound (`await requireApiPermission(...)`,
   no `const`) when `is_self_only`. Covered by `test_bulk_route_self_only_richperms.py`.

4. **Two hand-written files with ordinary stale imports** — `cypress/e2e/audit_log.cy.ts` and
   `cypress/support/audit_log/helper.ts` both declare themselves "Handwritten test spec/helper — not
   auto-generated" in their own header comments (`audit_log` has no schema entity, confirmed in an
   earlier pair of investigations — the SoT-vs-generated-output skill's grep-generate.py test applies: neither
   file's path is written by `generate.py`). `getDataGridRowCount` (spec) and `ALL_ENTITIES` (helper)
   were imported but never used. These are **not** generator/template debt — ordinary dead-import
   cleanup, edited directly, safe from being clobbered by `generate-code`.

## Root cause 3 (2 warnings): scenario-dependent unused bindings, fixed by post-render dead-code elimination instead of Jinja conditionals

Two more warnings didn't fit the "add one `{% if %}`" pattern used above, because the condition under
which the binding is actually used is scattered across many independent, unrelated Jinja branches
within a single ~1300-line template (`test_spec.cy.ts.jinja2`):

- **`exactRe()` helper** (an earlier task's self-ref-dep exact-match anchor) is *defined* whenever an entity
  has self-ref deps (`has_self_ref_deps`), but it's only *called* under several independent
  per-relation conditions (`after_create_id_is_expr`, non-empty `flatten_test_rels`, specific
  datagrid-FK-child relation loops, etc.) that don't all coincide for every entity with self-ref deps.
  `approval_flow` has `has_self_ref_deps=True` but none of the call-site conditions fire for it today
  — the helper renders as a dead function.

- **`.then((records) => {...})` / `.then((deps) => {...})` callback params** — these dependency-
  fixture `.then()` blocks appear over a hundred times across `test_spec.cy.ts.jinja2`,
  `test_spec_mobile.cy.ts.jinja2`, and `test_api_spec.cy.ts.jinja2`. Whether the body actually reads
  the param (vs. just sequencing the task before navigating by a hardcoded seed label, e.g.
  `cy.contains('Organization 1')`) depends on which of dozens of independent per-scenario branches
  rendered for that entity. 20 of the 30 `no-unused-vars` warnings were this shape, spread across 6
  entities (`approval_flow`, `dashboard`, `organization`, `permission`, `role`, `user`).

Replicating every one of these call-site conditions in Python to gate the definition/param name
precisely would be roughly as much surface area as the template branches themselves, and — critically
— would silently drift out of sync the next time a scenario is added to the template (a new call site
added without updating the Python mirror would either reintroduce the warning or, worse, reference an
undefined variable).

**Fix**: two small post-render helpers in `generate.py` operate on the fully rendered TypeScript
text, not the template source:

- `_strip_unused_exact_re_helper(content)` — if the `exactRe` function block appears in the rendered
  file but `exactRe(` doesn't appear anywhere else, strips the function (and its leading comment)
  entirely. Applied to `test_spec.cy.ts.jinja2`'s render only (the only template that emits it).
- `_prefix_unused_then_callback_params(content)` — brace-matches (skipping string/template-literal/
  comment content, so a template-literal interpolation doesn't desync the depth counter) every
  `.then((name) => { ... })` block; if `name` isn't referenced as a whole word inside its own body,
  renames the param to `_name` (this repo's established `no-unused-vars` opt-out convention, see
  `eslint.config.mjs`). Recurses into nested `.then()` bodies. Excludes a same-named nested
  declaration's own header text from the outer usage check (so a same-named nested callback can't
  mask an outer one being genuinely dead) — but this is not fully scope-aware: a genuine reference
  inside a same-named nested block will still read as "used" for the outer param too, so in that
  specific shadowing shape the outer binding is conservatively left unrenamed rather than risk a wrong
  rename. This shadowing shape has not been observed in the actual generated specs (0 such warnings
  remain after the fix). Applied to all three cypress-spec template renders.

Both are self-healing: as call-site conditions change in the templates, no Python mirror needs
updating — the next `generate-code` run just re-measures the actual rendered output. Covered by
`test_generated_dead_code_postprocess.py` (both helpers exercised directly as pure functions, no
Jinja render needed).

## Scope: `@next/next/no-img-element` (5 warnings) — deliberately left untouched

All 5 are `<img>` tags in `components/_standard/*.tsx` — statically-provided component library files,
not per-entity `.jinja2` output (confirmed unchanged by every `generate-code` run in this
investigation). This is a different rule (Next.js image-optimization suggestion, not an unused
binding), pre-existing, and outside the scope of the debt this cmd was chartered to close. Converting
these to `next/image` is a real behavior change (different loading/sizing semantics) that deserves its
own decision, not a drive-by inside a lint-debt cleanup. Left as-is; flagged here for a future cmd if
desired.

## Verification

- `npm run generate-code && npx eslint .` (full repo, no `--max-warnings` cap, to see every warning):
  83 → 5 warnings, 0 errors, both before and after.
- Full `code_generator` pytest suite: 1130 → 1145 passed (15 new tests), 0 SKIP, 0 regressions.
- `npx tsc --noEmit -p tsconfig.json` (app code, after `npx prisma generate`): 0 errors.
- `npx tsc --noEmit -p cypress/tsconfig.json`: 5 pre-existing errors in `approval_test_helpers.ts` /
  `commands.ts` — confirmed via `git diff --stat` that neither file is touched by this change; not
  introduced by this fix.
- CI's `Lint` job (checkout + `npm ci && npm run lint`, no `generate-code`) — see the PR's Lint run
  for the actual green result; this cmd's diff to tracked files is `eslint.config.mjs` (a config
  addition inert against any currently-tracked file, since the files it targets are gitignored) plus
  the two hand-written `audit_log` files (both now with fewer warnings than before, since they were
  already linted by CI regardless of `generate-code`).

## 2026-09-09 follow-up: warnings only a real consumer schema exercises

A later measurement inside a consumer's own generated output (its
`json_schema.yaml` declares x-approval on several entities, plus
commentable/mention/many-to-one-in-datagrid features this repo's own
dogfood schema has none of) found 35 warnings — the ceiling this repo's
own gate never sees, for the same structural reason as every fix above:
none of the branches involved are exercised by this repo's own schema, so
`npm run generate-code && npm run lint` here reports 0 for all of them.
Root-caused and fixed each one, following the exact same method as the
rest of this doc (find every real call site of the flagged identifier,
compare against the condition guarding its import/declaration, narrow the
guard to match):

- **`actions.ts.jinja2`**: `getAssociatedOrganizations` was imported
  whenever `should_filter_by_org && (can_create || can_update ||
  can_delete)`, but its only call site is inside the `can_delete` branch.
  An org-scoped entity that is create/update-able but not delete-able (the
  common x-approval shape — approvable records are typically undeletable)
  got an unused import. `getSessionUserIdOrThrow`/`requirePermission` had
  the opposite problem: imported unconditionally, but only referenced
  inside the upsert body (`can_create`/`can_update`), the invalidate
  action (`can_invalidate`), or the comment-reaction action
  (`has_commentable`) — an entity with none of those (e.g. a
  create/update/delete-only settings-shaped entity) got both unused.

- **`service.ts` utility imports (`generators.py`)**: `normalizeChildRefs`
  was imported whenever the entity has embedded children
  (`has_non_comment_ch`), but its only reference
  (`snapshot_child_mappings`, inside `normalizeSnapshot()`) is itself
  entirely gated on `can_update`. An entity with embedded children that
  mutates only through a non-update path (e.g. an `x-splittable` entity's
  split action) got an unused import.

- **`search_helpers.ts.jinja2`**: `buildSearchQuery` always computed
  `associatedOrgs`/`associatedOrgIds` via `getAssociatedOrganizations`, but
  every reference to `associatedOrgIds` is inside an
  `{% if entity.should_filter_by_org %}` branch (both the top-level
  entity loop and the `no_page_children` loop). When no search entity is
  org-scoped, both variables and the import went unused. A new
  `has_org_filtered_search_entity` flag (computed once in `generate.py`
  from `search_entities`) now gates all three.

- **`chart_getters.ts.jinja2`**: `getModelPermissions()` destructured
  `userId` alongside `permissions`, but the chart query has no per-user
  branch at all — `userId` was dead in every chart getter,
  unconditionally. Dropped it from the destructure.

- **`column_def.tsx.jinja2`**: `DateTimeWrapper` was imported whenever a
  date/time column exists, but this template's own date/time column
  renders via a plain `type: 'dateTime'` + `dayjs` `valueFormatter` — it
  never uses `<DateTimeWrapper>` (that component is used by
  `form_view`/`form_upsert`/`getters`, entirely different templates with
  their own, correct gating). Removed the import.
  `GridRenderEditCellParams` was similarly over-gated on
  `needs_datetime_imports || needs_entity_autocomplete_cell`, but its only
  use (the many-to-one FK column's `renderEditCell`) is
  entity-autocomplete-only; narrowed to `needs_entity_autocomplete_cell`.

- **`form_upsert.tsx.jinja2`**: `MentionInput` was imported whenever
  `has_mention_fields || comment_has_mention`, but the comment-mention path
  only ever passes `searchUsers`/`renderMessage` props into
  `CommentListWrapper` (which uses `MentionInput` internally, in its own
  component file) — this template's own generated code only ever renders
  a literal `<MentionInput>` for the `has_mention_fields` (the entity's
  own field-level mention) case. Since `comment_has_mention` is
  schema-wide (derived from the single shared `comment` entity, not
  per-consuming-entity), any commentable entity without its own
  mentionable field got an unused `MentionInput` import. Split the import:
  `MentionInput` on `has_mention_fields` alone, `searchMentionUserOptions`
  unchanged (genuinely needed by both paths).

- **`form_view.tsx.jinja2`**: several imports were declared unconditionally
  (`useRouter`) or over-broadly (comment-action imports, the reaction
  type, `permissions`) relative to what the page's own JSX actually
  reads — the view page renders `<CommentListWrapper>` read-only (no
  handlers, no reaction-toggle UI), so the comment-action imports
  (`add{Parent}Comment` etc.), the reaction type constant, and its type
  import are dead there even though the equivalent edit-page template
  genuinely needs them. `useRouter`'s only declaration site
  (`is_splittable && split_config`) is narrower than its old import
  condition (which also fired on `has_comment_children`, never a real use
  of the router). `permissions` itself is dead whenever neither
  `can_update` nor any `entity_view_components` entry needs it — the only
  two real reads of that prop.
  ⚠️ A first pass at this fix wrongly treated `CommentListWrapper` and
  `MentionText` as dead too, because a grep of the static template text
  for those identifiers found only the import lines and no direct JSX —
  missing that their real usage comes through an opaque
  `{{ child_view_grids }}` placeholder, a Python-rendered string built by
  a *different* function than the one that assembles the page's own
  static field JSX. A real consumer's generated output caught the mistake
  immediately as two `react/jsx-no-undef` ESLint errors (undefined
  components) — this repo's own mention-gate fixture did not catch it,
  because its `tsc` scope is limited to `getters.ts` and the API route,
  not `FormView.tsx`. **Lesson**: when a template inserts content via an
  opaque `{{ some_variable }}` placeholder (rather than static Jinja
  markup), grepping the `.jinja2` file's own text for a suspected-dead
  identifier is not sufficient proof of dead code — trace every Python
  function that populates that placeholder's value, or generate the real
  output and check for compile errors, before removing an import.

- **`getters.ts.jinja2`**: the `has_attachable` branch's attachment-decrypt
  block destructured `name_iv` without the `_` prefix its own sibling
  branch (`direct_attachment_rels`, a few lines down) already uses
  correctly (`name_iv: _name_iv`) for the exact same encrypted-column-
  stripping pattern — a plain copy/paste inconsistency between two nearly
  identical blocks.

- **Three `service_after_*_stub.ts.jinja2` write-once stubs**
  (`approve`/`reject`/`withdraw`): these stubs' default (uncustomized)
  bodies are `TODO` comments that don't reference their parameters,
  unlike every sibling stub (`after_create`/`after_delete`/`after_submit`/
  `after_update`, `before_approve`/`before_reject`/`before_withdraw`),
  which already use this repo's `_`-prefix convention for intentionally-
  unused bindings. Brought all three in line with their siblings. Since
  these are "generated once" files, this only affects newly-generated
  stubs — a consumer's already-materialized stub is untouched, and
  customizing a newly-generated one just means dropping the leading `_`
  from whichever parameters the implementation actually reads.

- **Generated cypress test code** (`test_api_spec.cy.ts.jinja2`,
  `test_spec_mobile.cy.ts.jinja2`, `test_spec.cy.ts.jinja2`,
  `test_reservation_helper.ts.jinja2`): the same "import/declaration
  condition broader than the real call site" shape recurs in
  test-generation templates too, not just app templates —
  `TEST_CREDENTIALS`'s one call site (the dual-auth session-cookie test on
  the `/export` route) needs `can_list && can_export`, not an
  unconditional import; the mobile spec's `exactRe()` helper is only
  called from the `can_list`-gated "Card list" describe block, not
  defined unconditionally at module scope; the datagrid-helpers import
  (`fillDataGridRow`/`selectDataGridSingleSelect`/`assertDataGridEmpty`/
  `getDataGridTotalRowCount`) was gated only on
  `has_datagrid_children`/`has_datagrid_fk_children`/`seed_count`,
  ignoring whether the entity can even reach the describe blocks
  (Create/Edit for the first two, Display-list/Delete for the last two)
  that call them at all; and the pool-reservation test helper's
  `createPool()`/`createTestPool{Target}()` functions declare an
  `extraDeps` parameter whenever the pool entity needs *any* extra
  dependency records, but only read it when that specific dependency (or
  the pool row itself) has an FK column referencing it — named `_extraDeps`
  in the cases where it doesn't.

**Verification for this round**: generating against the same consumer
schema, full ESLint went from 48 problems (0 errors, 48 warnings) to 2
warnings (0 errors) — the 2 remaining are in hand-written files under that
consumer's own custom test directory, not generator template output, so
out of this doc's scope. A manifest sha256 diff against the pre-fix
baseline in that same worktree showed 0 files added, 0 removed, and
exactly the entity-scoped files these fixes target changed — no unrelated
entity's generated output moved. This repo's own full pytest suite, all
its fixture/unit gates, and a full `tsc --noEmit` against both this
repo's own generated output and the consumer's (0 errors on both, aside
from two pre-existing errors in the consumer's `split_action_route.ts`
output that predate this round and are untouched by it) all pass.

**On the one-warning increment this round also explained**: an earlier
measurement recorded 34 warnings in the same consumer environment; a
later one recorded 35. The delta traces to a fix landed in between that
added a `canEdit = false` branch to `form_view.tsx.jinja2` for
`can_update: false` entities, replacing what had been an unconditional
`permissions?.update ?? true` — before that fix, `permissions` was always
referenced by `canEdit` regardless of `can_update`, so it could never go
unused via that path; after it, an entity with `can_update: false` and no
`entity_view_components` lost its only reference to `permissions`. That
is exactly the `form_view.tsx.jinja2` `permissions` fix described above —
the increment and one of this round's root causes are the same bug,
confirmed by the affected entities matching (the consumer's
`inventory_transaction`/`setting2`/`setting6`, all `can_update: false`
with no `entity_view_components`).
