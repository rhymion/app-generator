"""`x-version-of`: identity + version entities with approval-backed history.

Declared on the *version* entity (an ordinary `x-approval` entity):

    product_version:
      x-approval: { ... }
      x-version-of:
        identity: product      # identity entity; the FK on the version is `product_id`
        number: version_no     # integer field assigned at approval

The generator reads `prisma/schema.prisma` and does not emit models, so the
columns this key relies on are declared by the app and checked here:

- version model: `<identity>_id` FK, nullable `<number>` Int, and
  `@@unique([<identity>_id, <number>])`;
- identity model: nullable `current_version_id` with a relation to the version.
"""
from __future__ import annotations

import re
from pathlib import Path

from keys import x_version_of as version_of_key

KEY = version_of_key.KEY
_SUB_KEYS = frozenset({'identity', 'number'})
_NAME = re.compile(r'^[a-z][a-z0-9_]*$')
# `Int?` after the field name, ignoring attributes that follow.
_NULLABLE_INT = r'^\s*{col}\s+Int\?(\s|$)'
_NULLABLE_STRING = r'^\s*current_version_id\s+String\?(\s|$)'


def _raw(name: str, defs: dict) -> dict:
    return defs.get(f'__{name}') or defs.get(name) or {}


def _declared(schema: dict) -> list[tuple[str, object]]:
    """(version entity name, raw `x-version-of` value) for every declaration."""
    defs = schema.get('definitions') or {}
    out = []
    for key in defs:
        if key.startswith('__'):
            continue
        raw = _raw(key, defs)
        if isinstance(raw, dict) and version_of_key.has(raw):
            out.append((key, version_of_key.get(raw)))
    return out


def version_of_entities(schema: dict) -> list[dict]:
    """Resolved declarations (only meaningful after `version_of_errors` is empty)."""
    out = []
    for version, cfg in _declared(schema):
        if not isinstance(cfg, dict):
            continue
        out.append({
            'version': version,
            'identity': cfg.get('identity'),
            'number': cfg.get('number'),
            'identity_fk': f"{cfg.get('identity')}_id",
        })
    return out


def version_of_for(entity: str, schema: dict) -> dict | None:
    return next((v for v in version_of_entities(schema) if v['version'] == entity), None)


def version_of_children(version: str, schema: dict) -> tuple[list[dict], list[str]]:
    """Owned child tables of a version: [{'model', 'fk'}] plus problems.

    Only one-to-many children (DataGrid or list) are owned; many-to-many
    associations and comments are not. Each owned child needs exactly one
    structural FK to the version, which is what a draft copy and a draft
    delete are keyed on."""
    from build_context import _raw_def, _extract_children_of
    from helpers.schema_helpers import resolve_parent_fk_props
    defs = schema.get('definitions') or {}
    owned, problems = [], []
    for entry in _extract_children_of(_raw(version, defs), schema):
        rel = entry.get('relationship') or {}
        if rel.get('type') == 'many-to-many' or entry.get('output_type') == 'comments':
            continue
        fks = sorted(resolve_parent_fk_props(entry, _raw_def(entry['name'], schema), version))
        if len(fks) != 1:
            problems.append(
                f"Entity '{version}': {KEY}: owned child '{entry['name']}' must have exactly one "
                f"structural FK to '{version}', found {fks or 'none'}."
            )
            continue
        owned.append({'model': entry['name'], 'fk': fks[0]})
    return owned, problems


def version_of_errors(schema: dict) -> list[str]:
    """Structural errors; the key is rejected, never ignored."""
    defs = schema.get('definitions') or {}
    declared = _declared(schema)
    errors: list[str] = []
    identities: dict[str, str] = {}
    versions = {name for name, _ in declared}
    for version, cfg in declared:
        where = f"Entity '{version}': {KEY}"
        if not isinstance(cfg, dict):
            errors.append(f"{where} must be a mapping with 'identity' and 'number'.")
            continue
        unknown = sorted(set(cfg) - _SUB_KEYS)
        if unknown:
            errors.append(f"{where} has unknown sub-key(s) {unknown}; allowed: {sorted(_SUB_KEYS)}.")
        identity, number = cfg.get('identity'), cfg.get('number')
        for sub, val in (('identity', identity), ('number', number)):
            if not isinstance(val, str) or not _NAME.match(val):
                errors.append(f"{where}.{sub} is required and must be a snake_case name, got {val!r}.")
        if not isinstance(identity, str) or not isinstance(number, str):
            continue
        raw = _raw(version, defs)
        if not raw.get('x-approval'):
            errors.append(
                f"{where} requires '{version}' to declare x-approval: a version is an ordinary "
                f"approvable entity and the key adds no approval behavior of its own."
            )
        elif not (raw['x-approval'].get('on_approved') or {}):
            errors.append(
                f"{where} requires x-approval.on_approved on '{version}': the version number and "
                f"the identity's current_version_id are set in its approval dispatch."
            )
        if identity == version:
            errors.append(f"{where}.identity must not be the version entity itself.")
        elif identity not in defs and f'__{identity}' not in defs:
            errors.append(f"{where}.identity names unknown entity '{identity}'.")
        elif identity in versions:
            errors.append(f"{where}.identity '{identity}' is itself a version entity; chains are not supported.")
        if identity in identities and identities[identity] != version:
            errors.append(
                f"{where}.identity '{identity}' is already the identity of "
                f"'{identities[identity]}'; one version entity per identity."
            )
        identities.setdefault(identity, version)
        prop = (raw.get('properties') or {}).get(number)
        if prop is None:
            errors.append(f"{where}.number '{number}' is not a property of '{version}'.")
        else:
            types = prop.get('type') if isinstance(prop, dict) else None
            types = types if isinstance(types, list) else [types]
            if 'integer' not in types:
                errors.append(f"{where}.number '{number}' must be an integer field, got type {prop.get('type')!r}.")
            if number in (raw.get('required') or ()):
                errors.append(
                    f"{where}.number '{number}' must not be required: a draft has no number "
                    f"until it is approved."
                )
    for version, cfg in declared:
        if isinstance(cfg, dict) and not any(e.startswith(f"Entity '{version}': {KEY}") for e in errors):
            errors.extend(version_of_children(version, schema)[1])
    return errors


def validate_version_of_prisma(schema: dict, prisma_schema_path: str | Path, error_cls=ValueError) -> None:
    """Fail closed when the Prisma columns the key depends on are missing."""
    declared = version_of_entities(schema)
    if not declared:
        return
    from validate import _iter_model_blocks, _model_has_column  # local: avoid a cycle at import
    path = Path(prisma_schema_path)
    if not path.exists():
        raise error_cls(f"Prisma schema not found at {path} — required for {KEY} validation.")
    bodies = dict(_iter_model_blocks(path.read_text()))
    errors: list[str] = []
    for d in declared:
        v, i, n, fk = d['version'], d['identity'], d['number'], d['identity_fk']
        where = f"Entity '{v}': {KEY}"
        vbody, ibody = bodies.get(v), bodies.get(i)
        if vbody is None:
            errors.append(f"{where}: Prisma model '{v}' not found in schema.prisma.")
            continue
        if ibody is None:
            errors.append(f"{where}: identity Prisma model '{i}' not found in schema.prisma.")
            continue
        if not _model_has_column(vbody, fk):
            errors.append(f"{where}: model '{v}' needs the identity FK column '{fk}' (a relation to '{i}').")
        if not re.search(_NULLABLE_INT.format(col=re.escape(n)), vbody, re.MULTILINE):
            errors.append(
                f"{where}: model '{v}' needs '{n}  Int?' (nullable: it is assigned at approval, "
                f"so a draft has none)."
            )
        uniq = re.findall(r'@@unique\(\s*\[([^\]]+)\]', vbody)
        if not any({c.strip() for c in u.split(',')} == {fk, n} for u in uniq):
            errors.append(f"{where}: model '{v}' needs @@unique([{fk}, {n}]).")
        if not re.search(_NULLABLE_STRING, ibody, re.MULTILINE):
            errors.append(
                f"{where}: identity model '{i}' needs 'current_version_id  String?' with a "
                f"relation to '{v}'."
            )
        elif not re.search(r'fields:\s*\[\s*current_version_id\s*\]', ibody):
            errors.append(
                f"{where}: identity model '{i}' needs a @relation(fields: [current_version_id], "
                f"references: [id]) to '{v}'."
            )
    if errors:
        bullet_list = '\n'.join(f"  • {e}" for e in errors)
        raise error_cls(f"{KEY} validation failed — {len(errors)} problem(s):\n\n{bullet_list}\n")
