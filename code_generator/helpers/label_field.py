"""
Helpers for resolving and rendering `labelField` values.

A labelField in `x-relationship` / `x-relationships` describes how to render
the autocomplete / list-view / read-only-form label for a related entity. It
may be:

  * a single field name on the target ........... `name`
  * a single dotted path through the target's
    own m2o / o2o relations ..................... `approver_role.name`
  * a list of either of the above ............... `[entity_name, approver_role.name]`

Paths are always rooted at the **target** entity. Each segment must be either
a property of the current entity or an outbound m2o / one-to-one relation
(in which case the segment matches the relation name — i.e. the FK property
with `_id` stripped — and the next segment is resolved on the relation's
target entity).

Multi-path arrays are concatenated with a single space at render time.

Two products this module exposes to the rest of the generator:

  resolve_label_paths(label_field, target, schema)
      → list[ {path, segments, format} ]
      Walks each path, raises ValueError on an unknown segment.

  build_label_expression(item_var, label_field, target, schema)
      → {expression, prisma_include, has_format}
      Returns the TS expression that renders the label given an `item_var`
      pointing to a target row, plus the Prisma `include` chain needed for
      Prisma queries to populate the nested data.
"""
from __future__ import annotations

from typing import Iterable

_DATE_FORMATS = frozenset({'date', 'date-time', 'time'})


def _string_enum_labels(enum_values) -> list[str] | None:
    """Return string labels from an integer/number field's enum, or None.

    String labels are non-digit strings like ["free","premium","vip"].
    Pure numeric enums like [0,1,2] return None — those have no display labels.
    """
    if not isinstance(enum_values, list) or not enum_values:
        return None
    labels = [v for v in enum_values if isinstance(v, str) and not str(v).lstrip('-').isdigit()]
    return labels if labels else None


def _entity_props(entity: str, schema: dict) -> dict:
    """Return the `properties` of an entity, resolving allOf in *_detail."""
    defn = schema.get('definitions', {}).get(entity, {})
    if 'properties' in defn:
        return defn.get('properties', {}) or {}
    for sub in defn.get('allOf', []) or []:
        ref = sub.get('$ref') if isinstance(sub, dict) else None
        if ref:
            ref_name = ref.split('/')[-1]
            ref_def = schema.get('definitions', {}).get(ref_name, {})
            if 'properties' in ref_def:
                return ref_def.get('properties', {}) or {}
    return {}


def _outbound_relations(entity: str, schema: dict) -> dict:
    """Return {relation_name: target_entity} for each m2o / o2o on `entity`.

    `relation_name` is the FK property name with the trailing `_id` stripped,
    matching the relation key in Prisma `include` clauses.
    """
    rels: dict[str, str] = {}
    for prop_name, prop in _entity_props(entity, schema).items():
        if not isinstance(prop, dict):
            continue
        rel = prop.get('x-relationship') or {}
        if rel.get('type') in ('many-to-one', 'one-to-one', 'one-to-one_bridge'):
            target = rel.get('target')
            if target:
                rels[prop_name.removesuffix('_id') if prop_name.endswith('_id') else prop_name] = target
    return rels


def _normalize_paths(label_field) -> list[str]:
    """Normalize labelField (str | list[str] | None) into a list of paths.

    None / '' / [] returns an empty list — the caller decides on a fallback.
    """
    if label_field is None:
        return []
    if isinstance(label_field, str):
        return [label_field] if label_field else []
    if isinstance(label_field, list):
        return [str(p) for p in label_field if p]
    raise ValueError(f"labelField must be string or list of strings, got {type(label_field).__name__}")


def resolve_label_paths(label_field, target: str, schema: dict) -> list[dict]:
    """Walk every path in `label_field`, returning resolved metadata.

    Each result entry: {
        'path': original string,
        'segments': [str, ...],                      # split on '.'
        'final_field': str,                          # last segment
        'final_format': str | None,                  # format of the final field, if any
        'relation_chain': [str, ...],                # leading segments that are relations (excludes final_field)
    }

    Raises ValueError with a clear message when a segment doesn't exist.
    """
    paths = _normalize_paths(label_field)
    out = []
    for path in paths:
        segments = path.split('.')
        cursor_entity = target
        relation_chain: list[str] = []
        final_format = None
        final_is_number = False
        final_enum_labels = None

        for i, seg in enumerate(segments):
            cursor_props = _entity_props(cursor_entity, schema)
            cursor_rels  = _outbound_relations(cursor_entity, schema)
            is_last = (i == len(segments) - 1)

            if is_last:
                if seg not in cursor_props:
                    raise ValueError(
                        f"labelField path '{path}' on target '{target}': "
                        f"segment '{seg}' is not a property of '{cursor_entity}'. "
                        f"Available properties: {sorted(cursor_props.keys()) or '(none)'}"
                    )
                final_prop = cursor_props[seg]
                final_format = final_prop.get('format') if final_prop.get('format') in _DATE_FORMATS else None
                _ftype = final_prop.get('type')
                if isinstance(_ftype, list):
                    _ftype = next((t for t in _ftype if t != 'null'), None)
                final_is_number = _ftype in ('integer', 'number') and final_format is None
                final_enum_labels = _string_enum_labels(final_prop.get('enum')) if final_is_number else None
            else:
                if seg not in cursor_rels:
                    avail = sorted(cursor_rels.keys())
                    raise ValueError(
                        f"labelField path '{path}' on target '{target}': "
                        f"intermediate segment '{seg}' is not a m2o/one-to-one relation on '{cursor_entity}'. "
                        f"Available relations: {avail or '(none)'}"
                    )
                relation_chain.append(seg)
                cursor_entity = cursor_rels[seg]

        out.append({
            'path': path,
            'segments': segments,
            'final_field': segments[-1],
            'final_format': final_format,
            'final_is_number': final_is_number,
            'final_enum_labels': final_enum_labels,
            'relation_chain': relation_chain,
        })
    return out


def _path_expression(
    item_var: str,
    segments: list[str],
    final_format: str | None,
    final_is_number: bool = False,
    enum_labels: list[str] | None = None,
) -> str:
    """Build a TS expression for a single resolved path.

    The first connector after `item_var` is `?.` whenever `item_var` itself
    looks like a property access (contains a `.`) — e.g. `item.requestor_role`
    is a nullable relation, and `item.requestor_role.name` would crash if the
    relation isn't included. Bare row roots (`item`, `src`) start with `.`.
    Subsequent connectors are always `?.` so any nullable hop short-circuits.
    """
    first_connector = '?.' if '.' in item_var else '.'
    if len(segments) == 1:
        access = f"{item_var}{first_connector}{segments[0]}"
    else:
        # Walk through intermediate segments with `?.`, then the final
        # property — also `?.` for safety.
        path = first_connector + '?.'.join(segments)
        access = f"{item_var}{path}"

    if final_format in _DATE_FORMATS:
        # Wrap with the shared formatter (lib/_format.ts → formatLabelValue).
        # The formatter handles null/undefined/'' itself, so no extra ternary
        # is needed.
        return f"formatLabelValue({access}, '{final_format}')"

    if final_is_number:
        if enum_labels:
            # Integer enum with string labels: use index-lookup so 0→'free', 1→'premium'.
            # Array access on undefined/null gives undefined → ?? '' gives empty string.
            labels_literal = ', '.join(f"'{v}'" for v in enum_labels)
            return f"([{labels_literal}][{access}] ?? '')"
        # Plain integer/number: String() converts, but guard null/undefined first
        # because String(null)='null' and String(undefined)='undefined'.
        return f"({access} != null ? String({access}) : '')"

    # Non-date string — fall back to '' on null/undefined so concat doesn't
    # produce 'undefined'.
    return f"({access} ?? '')"


def build_label_expression(
    item_var: str,
    label_field,
    target: str,
    schema: dict,
    *,
    fallback_field: str = 'name',
    join_separator: str = ' ',
) -> dict:
    """Build the TS expression that produces the label string for `item_var`.

    Returns: {
        'expression':   TS expression (string).
        'has_format':   True if any path resolves a date/time field — caller
                        must add `import { formatLabelValue } from '@/lib/_format';`.
        'prisma_include': Nested dict suitable for Prisma `include` (or the
                        empty dict when no relation chains are involved). e.g.
                        for `patient_rel.patient.name` →
                        `{'patient_rel': {'include': {'patient': True}}}`.
        'paths':        Resolved path metadata (see resolve_label_paths).
    }

    When `label_field` is empty, falls back to `<fallback_field>` on target.
    """
    if not _normalize_paths(label_field):
        label_field = fallback_field

    resolved = resolve_label_paths(label_field, target, schema)
    parts = [
        _path_expression(
            item_var,
            r['segments'],
            r['final_format'],
            r.get('final_is_number', False),
            r.get('final_enum_labels'),
        )
        for r in resolved
    ]
    if len(parts) == 1:
        expression = parts[0]
    else:
        # Join with `${}` template-literal so empty entries don't introduce a
        # leading/trailing separator gap that's hard to read.
        joined = f'`{join_separator}`'.join(f'${{{p}}}' for p in parts)
        # The expression above produces ${expr1}` `${expr2}; wrap as a
        # template literal.
        inner = join_separator.join(f'${{{p}}}' for p in parts)
        expression = f'`{inner}`'

    has_format = any(r['final_format'] for r in resolved)

    # Build a merged Prisma include dict from the relation chains.
    include: dict = {}
    for r in resolved:
        chain = r['relation_chain']
        if not chain:
            continue
        cursor = include
        for i, seg in enumerate(chain):
            existing = cursor.get(seg)
            is_last = (i == len(chain) - 1)
            if is_last:
                # If there are still siblings, leave True; merge_dict handles it.
                cursor.setdefault(seg, True)
            else:
                if existing is True or existing is None:
                    nested: dict = {}
                    cursor[seg] = {'include': nested}
                    cursor = nested
                elif isinstance(existing, dict) and 'include' in existing:
                    cursor = existing['include']
                else:
                    nested: dict = {}
                    cursor[seg] = {'include': nested}
                    cursor = nested

    return {
        'expression':     expression,
        'has_format':     has_format,
        'prisma_include': include,
        'paths':          resolved,
    }


def render_prisma_include(include: dict) -> str:
    """Render a nested Prisma include dict to its TS source form.

    {'patient_rel': {'include': {'patient': True}}}
        → "patient_rel: { include: { patient: true } }"
    """
    if not include:
        return ''
    parts = []
    for key, val in include.items():
        if val is True:
            parts.append(f"{key}: true")
        elif isinstance(val, dict):
            inner = val.get('include', {})
            parts.append(f"{key}: {{ include: {{ {render_prisma_include(inner)} }} }}")
        else:
            parts.append(f"{key}: true")
    return ', '.join(parts)


def first_label_format(label_field, target: str, schema: dict) -> str | None:
    """Return the format ('date' | 'time' | 'date-time') of the first resolvable
    path's final field, or None. Used by legacy code that only cares whether
    *any* part of the label needs date formatting (e.g. test helpers).
    """
    try:
        resolved = resolve_label_paths(label_field, target, schema)
    except ValueError:
        return None
    for r in resolved:
        if r['final_format']:
            return r['final_format']
    return None


def first_label_path(label_field) -> str:
    """Return the first path string in `label_field`, or '' if none.

    Used by sites that pre-existed array-form labelField support and need a
    single string (typically to derive a Prisma `select`).
    """
    paths = _normalize_paths(label_field)
    return paths[0] if paths else ''
