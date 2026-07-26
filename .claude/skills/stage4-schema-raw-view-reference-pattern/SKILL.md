---
name: stage4-schema-raw-view-reference-pattern
description: |
  In Stage-4 `json_schema.yaml`, each entity has a "raw" definition
  (`__<model>`, holding the actual `properties`, `x-bridge`, `x-display`, etc.)
  and a "view" definition (`<model>`, a thin wrapper with no properties of its
  own — its fields are reached only via `allOf[0].$ref` to the raw entity).
  Code that looks up `schema['definitions'].get(model, {})` directly (the view
  entity) instead of resolving to the raw entity will silently get an empty or
  incomplete dict, missing `properties`/`x-bridge`/`x-display`. Use `_raw_def()`
  (defined identically in context.py, generators.py, generators_i18n.py, and
  cleanup.py) when you need the raw dict itself (e.g. for `x-bridge` detection
  or field-key collection); use `get_entity_properties()` /
  `_get_flatten_target_props()` (schema_helpers.py) when you need a merged
  "does entity E have field F" answer for a bare model name from a cross-file
  caller. Trigger when writing or reviewing any new `code_generator/*.py` code
  that does `schema['definitions'].get(<entity>, {})` directly, when a Stage-4
  migration causes a generator feature (i18n keys, bridge detection, field
  collection) to silently under-collect for legacy or converted entities, or
  when auditing generator code for the raw-vs-view lookup bug pattern.
  Do NOT use for: non-Stage-4 (legacy `_detail`-suffix) schema entity lookups,
  which use a different resolution path entirely.
---

# stage4-schema-raw-view-reference-pattern

## North Star

Stage-4 `json_schema.yaml` splits each entity into two definitions:

- **Raw** (`__<model>`): holds the actual `properties`, `x-bridge`,
  `x-display`, `required`, etc. — the entity's real content.
- **View** (`<model>`): a thin wrapper carrying no properties of its own;
  its fields exist only by reference, via `allOf[0].$ref` back to the raw
  definition (plus optional view-specific extension properties merged on
  top).

Any generator code that reads `schema['definitions'].get(model, {})` and then
inspects `.get('properties')`, `.get('x-bridge')`, `.get('x-display')` etc.
directly on that result is reading the **view** entity, which typically has
none of those keys populated. This does not raise an error — it silently
returns an empty dict/list, so the bug manifests as under-collection (missing
i18n keys, undetected bridges, incomplete field lists) rather than a crash,
and can pass existing E2E suites that don't happen to exercise the gap.

## Two correct lookup helpers — pick based on what you need

### 1. `_raw_def(entity_name, schema)` — when you need the raw dict itself

Defined identically in `context.py`, `generators.py`, `generators_i18n.py`,
and `cleanup.py`:

```python
def _raw_def(entity_name: str, schema: dict) -> dict:
    defs = schema.get('definitions', {})
    return defs.get(f'__{entity_name}', {}) or defs.get(entity_name, {})
```

It tries the raw key (`__<entity_name>`) first, falling back to the bare
name for legacy (pre-Stage-4) schemas where no `__` prefix exists — making it
a safe drop-in replacement for `schema['definitions'].get(model, {})` in
either schema generation. Use this whenever you need `x-bridge`,
`x-display`, unmerged `properties`, or any other raw-entity-only key, and the
raw dict itself (not a merged/flattened view) is what your logic operates on.

### 2. `get_entity_properties(entity, schema)` — when you need a merged "has field F" answer

In `code_generator/helpers/schema_helpers.py`:

```python
def get_entity_properties(entity: str, schema: dict) -> dict:
    """Public merged-properties lookup for any entity key (raw `__x` or view `x`).
    ... a view entity (`role`) carries no properties of its own; its fields
    live on the raw entity (`__role`) referenced via allOf[0].$ref.
    """
    return _get_flatten_target_props(entity, schema)
```

Use this (not `_raw_def`) when a cross-file caller (e.g. `validate.py`) just
needs "does entity E have field F", since it correctly merges view-level
extension properties with the raw entity's properties via `allOf`. `_raw_def`
alone would miss any properties declared only on the view side.

## Known instances of the raw-vs-view bug (same shape, found independently 3×)

- `generators_i18n.py`'s `_collect_field_keys()` originally used
  `schema['definitions'].get(model, {})` directly — fixed by switching both
  call sites (parent and child) to `_raw_def(model, schema)` /
  `_raw_def(child['name'], schema)`.
- `cleanup.py:198` had the identical unfixed copy of the same
  `_collect_field_keys()` logic — found and fixed independently.
- `generate.py:660-662` (`get_new_form_bridge(schema['definitions'].get(model,
  {}))`, `.get('x-display')`, `.get('properties', {})`) referenced the view
  entity for new-form bridge detection — a same-shaped latent bug: existing
  E2E suites passed only because they hadn't yet hit a case where the
  bridge/properties data was view-only-empty; it would misbehave once a
  Stage-4 entity's new-form bridge was exercised. Fixed by switching to
  `_raw_def()`, matching the same pattern.

## Do NOT

- Do not write new generator code that does `schema['definitions'].get(model,
  {})` (or `.get(child_name, {})`, etc.) directly when the result will be
  probed for `properties`/`x-bridge`/`x-display` — always resolve through
  `_raw_def()` first.
- Do not assume existing green E2E proves a raw/view lookup bug is absent —
  the bug is a silent under-collection, not a crash, and may not be exercised
  by current test data.
- Do not reinvent `_raw_def()` locally in a new file — reuse the existing
  identical implementation from `context.py`/`generators.py` to keep the
  fallback-to-legacy behavior consistent everywhere.
