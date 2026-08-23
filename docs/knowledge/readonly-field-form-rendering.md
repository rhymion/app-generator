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
