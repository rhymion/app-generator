# labelField Drives Both Display and Search — `id` Is Never a Valid Choice

## The observation this confirms

`labelField: id` on an `x-relationship` compiles without error and appears, superficially, like a
valid (if unhelpful) choice — "worst case, the label just shows a UUID." In practice it is worse
than that: the relation is silently dropped from autocomplete search entirely. Typing any part of
the UUID into a search box, or typing nothing useful because the UI just renders a raw id, never
surfaces a match. This is not a rendering nuance — it is a hole in the FK relation's search
coverage that stays invisible until someone tries to search by it.

## Why: `id` never survives `derive_searchable_relation_fields()`

`code_generator/helpers/schema_helpers.py`'s `derive_searchable_relation_fields()` is what decides
which FK relations get cross-relation substring search wired into the generated
`searchXxxOptions()` getter (the one-hop Prisma nested `where` that lets a picker match by, e.g.,
an inventory row's product name). For each element of a relation's `labelField` (single string or
composite list), it does:

```python
final_prop = target_props.get(path)
if not isinstance(final_prop, dict):
    continue
```

`target_props` is the target entity's `properties` dict, as declared in `json_schema.yaml`. `id`
is a Prisma-managed system field (`_SYSTEM_FIELDS` in this same module) — it is never declared as
an entry in `properties`, because there is nothing to configure about it. `target_props.get('id')`
therefore returns `None`, `isinstance(None, dict)` is `False`, and the `continue` fires
unconditionally. No `{relation, field}` entry is ever appended for a `labelField: id` relation,
regardless of anything else about the schema. This holds for every entity, every relation, every
time — it is not a bug that got missed, it is what the function is designed to do to any path
that doesn't resolve to a real, configurable property.

The same disqualification would apply a second time even if `id` were hypothetically added to
`properties`: `derive_text_fields()` (the sibling function that derives an entity's *own* directly
searchable text fields, used by both the full-text search context and this same autocomplete
path) has an explicit `if field_name == 'id': continue`. Two independent layers agree that `id` is
never a search-eligible field.

## Why this used to be less visible: the `searchField` era (retired)

Before this retirement, search eligibility for a relation was controlled by a separate `searchField`
attribute, declared independently of `labelField`. That let a schema author set `labelField: id`
(accepting a UUID as the display label) while still setting `searchField: name` to keep the
relation searchable by name — the display problem and the search problem were decoupled, so a
`labelField: id` schema could still "work" for search even though it looked wrong on screen.

`searchField` was retired because nothing enforced that it stayed in sync with `labelField`: a
relation could show one field on screen while actually being searched by a different, unrelated
field, and the two would silently drift apart as the schema was edited by hand over time.
`derive_searchable_relation_fields()` now reads `labelField` directly — the *same* source
`build_label_expression()` uses for the on-screen label and for the CSV-import full-label-text
match (`csv-import-composite-labelfield.md`). A schema still declaring `searchField` is a
validation error (see `validate.py`). The consequence of this consolidation: **whatever
`labelField` is set to now controls both what's displayed AND what's searchable, with no
independent escape hatch** — so `labelField: id` is not just a cosmetic UUID-on-screen choice
anymore, it is also an unconditional search bypass. There is no longer a `searchField` fallback
to compensate.

## What actually gets selected as searchable

`derive_searchable_relation_fields()` walks each path in the relation's `labelField` (a single
string is treated as a one-element list) and keeps a path only if **all** of the following hold:

- **Not a dotted path** (`approver_role.name`) — resolving a second hop (the target's own FK to
  yet another entity) would need a second nested `where`, which `getters.ts.jinja2` does not
  render. One-hop only; no schema case has needed a second hop so far.
- **Resolves to a real property** on the target entity (`target_props.get(path)` returns a dict)
  — this is the check that excludes `id`, per above.
- **Is a string-typed property** (`is_string_prop`) — `contains` is a string-only Prisma operator.
- **Not an enum** — an enum's on-screen label is translated (i18n) while its stored value is not,
  so a raw substring match against the stored value would rarely hit what the user typed.
- **Not a date/date-time/time/uri format field** — not meaningfully substring-searchable.
- **Not a CUID-pattern id-shaped string** (`^c[a-z0-9]` pattern) — same reasoning as excluding
  `id` itself, applied to any other field that is structurally an opaque identifier.

Each qualifying path in a composite `labelField` contributes its own independent
`{relation, field}` entry — a composite `labelField` can be partially searchable (some elements
qualify, others don't) without that being an error; it just means search coverage on that relation
is narrower than its display label.

## Practical takeaway for schema authors

If a relation's target entity has no single natural human-readable field, prefer a composite
`labelField` (a list of paths resolving to real, string-typed, non-enum, non-date/uri properties
on the target — see `csv-import-composite-labelfield.md` for the CSV-import side of composite
labels) over falling back to `id`. A composite label built from real fields is both a meaningful
on-screen label and, for every element that qualifies under the rules above, a search hit.
`labelField: id` gives up on both.
