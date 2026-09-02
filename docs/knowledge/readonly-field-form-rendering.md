# Readonly field rendering in FormUpsert

## Symptom

An entity with an editable relation and a readonly FK (`x-readonly` on the FK
property, or the property named in an entity-level `x-readonly-fields` list)
rendered the FK's readonly display in `FormUpsert.tsx` as a raw value with a
broken translation key:

```tsx
<AppFieldText
  label={tf('parentGoodsReceiptLineId')}   // no such i18n key — untranslated key shown verbatim
  value={String(src.parent_goods_receipt_line_id)}  // raw id, not the relation's labelField value
  readOnly
/>
```

`FormView.tsx` (always fully read-only) rendered the same FK correctly —
`<AppFieldRelation>` resolving the relation's `labelField`, with a working
`tf('parentGoodsReceiptLine')` key and a link to the target row.

## Root cause

`generators.py`'s `form_upsert_context()` had its own, independent readonly-field
render loop that dispatched on **nothing but `String(src.<prop>)`** — no type
check at all. Every readonly field, regardless of type, was rendered the same
way. For a relation this produces the bug above (wrong key, wrong value); the
same blind loop also affected date/datetime/time (unformatted ISO string),
boolean (`"true"`/`"false"` literal), image (`uri` format shown as raw text
instead of `<ImageDisplay>`), and both enum flavors (int-enum and nativeEnum
string — raw stored code shown, untranslated).

## Fix

Extracted the type-dispatch logic that `form_view_context()` already had
(relation → `<AppFieldRelation>` with `labelField` resolution; date/datetime/
time → `<DateTimeWrapper readOnly>`; image (`format: uri`) → `<ImageDisplay>`;
boolean → `<AppFieldBoolean readOnly>`; int-enum / nativeEnum → `<AppFieldText
readOnly>` with the field's own options array for label lookup; fallback →
`<AppFieldText readOnly>`) into a single shared function,
`_readonly_display_field()` (`generators.py`). Both `form_view_context()` and
`form_upsert_context()`'s readonly-field loop now call it — the two paths
can no longer drift apart.

Enum options built for the readonly display (`const <field>Options = [...]`,
needed for label lookup) do land in `enum_opt_setups` even when the field is
readonly-only; this is intentional (the label needs the array), not a
regression — a readonly enum never gets an editable `AppFieldSelect`/state
variable for it (see `test_readonly_field_not_in_normal_enum_jsx` in
`code_generator/tests/test_readonly_fields.py`).

`form_upsert.tsx.jinja2` needed one addition: a conditional `ImageDisplay`
import gated on a new `uses_image_display` flag (same text-search pattern as
`uses_app_field_text`/`uses_app_field_relation`) — a readonly-only
image field has no other path that would pull the import in.

**Later fix:** `_readonly_display_field()`'s `format: uri` branch was
unconditional — it rendered `ImageDisplay` for any uri field regardless of
`x-uri-kind`, so an `x-uri-kind: link` field marked readonly (either via
`x-readonly-fields` here, or as a plain non-editable field on `FormView`)
rendered an `<img>` tag pointed at an arbitrary URL instead of a clickable
link. Fixed by branching on `get_uri_kind(prop)`: `link` renders
`AppFieldExternalLink`, everything else keeps `ImageDisplay`. See
`code_generator/tests/test_form_upsert.py`'s
`TestUriKindLinkFieldReadonlyInFormUpsert`.

## Fail-closed validation: `x-readonly-fields` must resolve to a real property

`build_context.py` collects `x-readonly-fields` (entity-level) and unions it
with field-level `x-readonly` into `readonly_fields`. Before this fix, every
downstream consumer — the API-route `readonly_fields_api` filter and
FormUpsert's render loop — silently dropped any entry that didn't match an
actual property name. A misspelled entry (most commonly: the relation name,
e.g. `parent_goods_receipt_line`, instead of the actual FK column,
`parent_goods_receipt_line_id`) had **no effect at all** — the field stayed
fully editable, with no warning anywhere.

`build_context.py` now raises `ValueError` at generation time if any
`x-readonly-fields` entry doesn't resolve to a property in `filtered_props`.
See `test_unresolved_entity_level_readonly_field_fails_closed` and
`test_relation_name_instead_of_fk_column_fails_closed` in
`test_readonly_fields.py`.

**Naming convention**: `x-readonly-fields` entries must be the exact property
name (the FK column, e.g. `parent_goods_receipt_line_id`, not the relation
name `parent_goods_receipt_line`) — consistent with every other entry in the
list (plain scalar properties) and with `readonly_fields_api`/
`readonly_fields_create_reject`, which are used directly as API column names.
No alias/dual-form acceptance was added (kept the check simple, one valid
spelling). This point (accept `_id`-suffixed only, vs. also accepting the bare
relation name) is flagged in the task report as a decision the schema author
should confirm — the fail-closed check itself does not depend on which
spelling is chosen, only on it resolving unambiguously.

## Type-scope note

Only relation and enum readonly fields had a *user-visible correctness* bug
(wrong value / untranslated key). Date/boolean/image readonly fields were
previously legible but unstyled (raw ISO string, raw `"true"`/`"false"`, raw
URL text) — now rendered with the same components `FormView` uses.

## `x-readonly` vs `x-readonly-fields`: two different scopes

These two annotations both feed into `readonly_fields` and render the same
way, but they are **not** interchangeable — they differ in scope, and that
difference is load-bearing for anyone using a proxy/secondary view.

- **`x-readonly` (per-property, under `fields:`)** is **model/raw-wide**.
  Properties themselves always live on the raw entity (`build_user_schema.py`
  derives them from Prisma; they are never duplicated per view), so a
  per-property flag necessarily applies to every view built on that model.
  There is no way to scope it to a single view, by design.
- **`x-readonly-fields` (entity-level list)** is **view-scoped**. It lives
  on whichever view entity declares it and applies only to that view.

The two annotations entered the codebase for different features at
different times, which is why their scopes were never unified until the
fix below made the distinction explicit and intentional rather than
incidental.

### Fixed: `x-readonly-fields` used to leak across views of the same model

`build_user_schema.py`'s `_ENTITY_LEVEL_DATA_KEYS` allowlist used to copy a
view's `x-readonly-fields` declaration onto the shared **raw** entity
(alongside genuinely raw-scoped keys like `x-import-key`/`x-display`), and
`build_context.py` read it back from that same raw entity (`model_def`).
Since every view of a Prisma model resolves to the same raw entity, one
view's declaration silently applied to every other view sharing that
model — a proxy view (e.g. a `setting` page that is really just another
view of `user`, per `docs/knowledge/schema-restructuring-build-order.md`'s
pass-through description) could not declare a readonly field without also
locking it down on the model's other view(s).

Fix: `x-readonly-fields` moved to `_VIEW_LEVEL_CONFIG_KEYS`
(`build_user_schema.py`) so it stays on the view entity, and
`build_context.py`'s `_ro_from_entity` now reads
`schema['definitions'][definition_key]` (the view entity itself) instead
of `model_def` (the shared raw entity). Verified against the real schema:
declaring `x-readonly-fields: [name]` on `setting` (a proxy view of
`user`) rendered `name` readonly in `setting`'s generated `FormUpsert.tsx`
while `user`'s own `FormUpsert.tsx` kept `name` fully editable — and the
reconstructed raw entity (`__user`) never carried the key at all. Test
coverage: `code_generator/tests/test_scheduled_task_templates.py`'s
`TestXReadonlyFieldsScope` (builder side) and
`code_generator/tests/test_readonly_fields.py`'s
`TestReadonlyFieldsCrossViewIsolation` (read side).

`x-readonly` (per-property) was deliberately left unchanged — see the
scope list above.

## `x-display.form` is NOT view-scoped (unlike `x-readonly-fields`)

`x-display.form` and `x-readonly-fields` look similar — both are declared on
a view entity to control what a Proxy View's edit form shows — but they
resolve from **different scopes**. This difference matters in practice.

**`x-display.form`** is **not** view-scoped. The form/view-order helpers in
`build_context.py`/`generators.py` resolve `x-display.form` from the shared
raw model backing the Proxy View, not from the Proxy View entity's own
definition. Declaring `x-display.form: [status]` on a Proxy View entity does
**not** limit the generated `FormUpsert.tsx` to render only the `status`
field — the form will still render all raw-model fields as interactive
inputs. This was verified against an actual generated `FormUpsert.tsx` for a
Proxy View entity that declared `x-display.form: [status]`: it rendered
every field of the underlying raw model (relations, quantities, text
fields, status) despite the narrowed `x-display.form` declaration.

**`x-readonly-fields`** is view-scoped (as the section above documents). It
is read from the Proxy View entity's own definition, not from the raw
model. This is what actually locks the non-`status` fields in a Proxy
View's edit form.

**`x-display` never received the view-scoped fix that `x-readonly-fields`
got.** The two diverged: `x-readonly-fields` moved to
`_VIEW_LEVEL_CONFIG_KEYS` in `build_user_schema.py` so it stays per-view;
`x-display` remained tied to the raw model. Until `x-display` gets a
similar view-scope fix, the only reliable way to restrict a Proxy View's
edit form to specific fields is `x-readonly-fields` (which hides other
fields as read-only), not `x-display.form`.

_Provenance: originally recorded as a schema comment in a consumer
project's Proxy View entity, documenting a gap found while building that
entity. Moved here when that entity was later retired, so the generator's
behavior is documented independent of any particular consumer entity._

## DataGrid child support

Both `x-readonly` and `x-readonly-fields` also reach a DataGrid child (an
editable one-to-many child grid embedded in the parent's form) when
declared on the child entity itself — not just the parent's own
form/list rendering (verified above). A readonly-declared child field
renders with `editable: false` in the generated grid, and the write path
protects it too: an existing row's value can't be overwritten through the
child's `update` path, even by a direct API request that bypasses the UI.

- **Resolution**: `build_context.py`'s per-child loop resolves the
  readonly field set for each child — the union of the child entity's own
  `x-readonly-fields` (read from its own definitions entry, mirroring the
  parent's view-scoped read above) and any per-property `x-readonly` on
  the child's own properties. Fails closed on an `x-readonly-fields` entry
  that doesn't match a real child property, the same as the parent-level
  check above.
- **UI side**: `generators.py`'s child-grid column builder forces
  `editable: false` for a readonly column, the same pattern the `order`
  column already used.
- **API/service side — create vs. update asymmetry**: a child row's
  create-time field mapping (used for both a standalone create and a new
  row added during an update) substitutes a schema-derived default
  literal for a readonly field instead of the client-submitted value,
  because a brand-new row has no prior value to preserve. A separate
  update-time field mapping (used only for an *existing* row's `update`
  branch) omits the field from the write payload entirely, so Prisma
  leaves the persisted value untouched — an omitted key is a no-op for
  that column, so no "re-read and resend the current value" plumbing is
  needed.
- **Verification**: confirmed against the live generated output of the
  one true-editable DataGrid child in the base schema (`dashboard_widget`,
  under `dashboard`) — declaring `x-readonly-fields: [name]` on it
  produced `editable: false` for the `name` column in the generated
  `column_def.tsx`, `name: ''` (no schema default, so the empty-string
  fallback) in the generated create bodies, and no `name:` key at all in
  the generated update branch's write payload. Reverting the declaration
  and regenerating round-tripped the output back to a clean `git status`.
