#!/usr/bin/env python3
"""One-time migration: user schema `fields:` -> `properties:`, `allOf` proxy -> `x-view-of`.

Old user schema format (entity level):

    user:
      fields:   {name: {...}, email: {...}}        # Prisma scalar columns
      properties: {roles: {$ref: ...}}             # relation embeds

    setting:                                       # proxy view of `user`
      allOf:
        - $ref: "#/definitions/user"
        - type: object
          required: [roles]
          properties: {roles: {...}}

New format:

    user:
      properties: {name: {...}, email: {...}, roles: {$ref: ...}}

    setting:
      x-view-of: user
      required: [roles]
      properties: {roles: {...}}

The `fields:` entries move to the front of `properties:` in their original
order, followed by the entity's existing `properties:` entries. Only the
entity-level keys are touched: same-named keys nested elsewhere
(`x-generate.fields`, `x-search.text_fields`, ...) are never visited.

The tool runs in two stages. By default it only inspects the input and prints
a report (dry run) listing what the old format silently ignored and what the
new format will reject; it writes a file only when `--in-place` or `--out` is
given, and never writes when any entity is blocked.

Usage:
  migrate_fields_into_properties.py SCHEMA.yaml --prisma schema.prisma
  migrate_fields_into_properties.py SCHEMA.yaml --prisma schema.prisma --in-place
  migrate_fields_into_properties.py SCHEMA.yaml --prisma schema.prisma --out NEW.yaml
  migrate_fields_into_properties.py --generator-root REPO   # dry run of the generator's own inputs

`--prisma` may be repeated (files are concatenated, as a fixture's
`schema_additions.prisma` is appended to the default schema) and
`--relations JSON` injects the back-relation lines of a composed fixture.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

from build_user_schema import _make_yaml
from schema_deriver import parse_prisma_schema

_DEFINITIONS_PREFIX = "#/definitions/"
_ALLOF_SECOND_BRANCH_KEYS = ("type", "required", "properties")

# Finding codes. Codes in _BLOCKING stop the write; the others are reported only.
FIELD_ABSENT_FROM_PRISMA = "FIELD_ABSENT_FROM_PRISMA"
FIELD_IS_RELATION = "FIELD_IS_RELATION"
PROPERTY_ABSENT_FROM_PRISMA = "PROPERTY_ABSENT_FROM_PRISMA"
PROPERTY_IS_SCALAR = "PROPERTY_IS_SCALAR"
ORPHAN_ENTITY = "ORPHAN_ENTITY"
PROXY_SCALAR_PROPERTY = "PROXY_SCALAR_PROPERTY"
PROXY_TARGET_NOT_MODEL = "PROXY_TARGET_NOT_MODEL"
ALLOF_ON_MODEL = "ALLOF_ON_MODEL"
ALLOF_UNSUPPORTED_SHAPE = "ALLOF_UNSUPPORTED_SHAPE"
FIELDS_PROPERTIES_COLLISION = "FIELDS_PROPERTIES_COLLISION"
VIEW_OF_AND_ALLOF = "VIEW_OF_AND_ALLOF"

_BLOCKING = frozenset(
    {
        ALLOF_ON_MODEL,
        ALLOF_UNSUPPORTED_SHAPE,
        FIELDS_PROPERTIES_COLLISION,
        VIEW_OF_AND_ALLOF,
    }
)

_DESCRIPTIONS = {
    FIELD_ABSENT_FROM_PRISMA: "fields: names a column Prisma does not have (rejected before and after)",
    FIELD_IS_RELATION: "fields: names a Prisma relation field (rejected before and after)",
    PROPERTY_ABSENT_FROM_PRISMA: "properties: names something Prisma does not have (silently passed through before, rejected after)",
    PROPERTY_IS_SCALAR: "properties: names a Prisma scalar column (merged as a plain property before, becomes an allow-listed column after)",
    ORPHAN_ENTITY: "entity is neither a Prisma model nor a proxy (silently dropped before, rejected after)",
    PROXY_SCALAR_PROPERTY: "proxy properties: names a scalar column of its target (not rejected before, rejected after)",
    PROXY_TARGET_NOT_MODEL: "allOf proxy points at something that is not a Prisma model",
    ALLOF_ON_MODEL: "allOf on an entity named like a Prisma model (rejected before; not migrated)",
    ALLOF_UNSUPPORTED_SHAPE: "allOf is not exactly [$ref, {type, required, properties}] (not migrated)",
    FIELDS_PROPERTIES_COLLISION: "the same name appears under fields: and properties: (not migrated)",
    VIEW_OF_AND_ALLOF: "entity has both x-view-of and allOf (not migrated)",
}


@dataclass(frozen=True)
class Finding:
    code: str
    entity: str
    name: str = ""
    detail: str = ""

    @property
    def blocking(self) -> bool:
        return self.code in _BLOCKING


# ---------------------------------------------------------------------------
# Prisma helpers
# ---------------------------------------------------------------------------


def _is_relation(model, prisma_models: dict, field_name: str) -> bool:
    """Relation object, or a back-relation list (typed as another model)."""
    pf = model.fields[field_name]
    return pf.is_relation_object or pf.prisma_type in prisma_models


def load_prisma_models(
    prisma_paths: list[Path], relations_json: Path | None = None
) -> dict:
    """Parse one or more concatenated Prisma files, with optional back-relation injection."""
    text = "\n".join(p.read_text(encoding="utf-8") for p in prisma_paths)
    if relations_json is not None:
        relations = json.loads(relations_json.read_text(encoding="utf-8"))
        for model, lines in relations.items():
            match = re.search(rf"^model {re.escape(model)} \{{\n.*?^\}}\n", text, re.S | re.M)
            if not match:
                raise SystemExit(f"Prisma input has no model {model} to inject relations into")
            block = match.group(0)
            text = text.replace(block, block[:-2] + "".join(f"  {ln}\n" for ln in lines) + "}\n", 1)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "schema.prisma"
        path.write_text(text, encoding="utf-8")
        return parse_prisma_schema(path)


# ---------------------------------------------------------------------------
# Inspection (dry run)
# ---------------------------------------------------------------------------


def _allof_target(entity) -> str | None:
    allof = entity.get("allOf")
    if isinstance(allof, list) and allof and isinstance(allof[0], dict):
        ref = allof[0].get("$ref")
        if isinstance(ref, str) and ref.startswith(_DEFINITIONS_PREFIX):
            return ref[len(_DEFINITIONS_PREFIX):]
    return None


def _allof_shape_problem(entity) -> str | None:
    """Why `entity`'s allOf cannot be rewritten losslessly, or None if it can."""
    allof = entity.get("allOf")
    if not isinstance(allof, list) or not allof:
        return "allOf is not a non-empty list"
    first = allof[0]
    if not isinstance(first, dict) or set(first) != {"$ref"} or _allof_target(entity) is None:
        return "first branch is not a bare $ref to #/definitions/<name>"
    if len(allof) > 2:
        return f"allOf has {len(allof)} branches"
    if len(allof) == 2:
        second = allof[1]
        if not isinstance(second, dict):
            return "second branch is not a mapping"
        extra = [k for k in second if k not in _ALLOF_SECOND_BRANCH_KEYS]
        if extra:
            return f"second branch carries other keys: {extra}"
        if second.get("type", "object") != "object":
            return f"second branch type is {second.get('type')!r}"
        for key in ("required", "properties"):
            if key in entity and key in second:
                return f"entity has its own top-level {key} as well"
    return None


def inspect_schema(schema, prisma_models: dict) -> list[Finding]:
    """List what the old format ignored and what the new format will reject."""
    findings: list[Finding] = []
    for key, entity in ((schema or {}).get("definitions") or {}).items():
        if not isinstance(entity, dict) or key.startswith("__"):
            continue
        fields = entity.get("fields") or {}
        props = entity.get("properties") or {}
        has_allof = "allOf" in entity
        in_prisma = key in prisma_models

        if has_allof and "x-view-of" in entity:
            findings.append(Finding(VIEW_OF_AND_ALLOF, key))
        if in_prisma and has_allof:
            findings.append(Finding(ALLOF_ON_MODEL, key))
        if has_allof and not in_prisma:
            problem = _allof_shape_problem(entity)
            if problem:
                findings.append(Finding(ALLOF_UNSUPPORTED_SHAPE, key, detail=problem))
        for name in fields:
            if name in props:
                findings.append(Finding(FIELDS_PROPERTIES_COLLISION, key, name))

        if in_prisma:
            model = prisma_models[key]
            for name in fields:
                if name not in model.fields:
                    findings.append(Finding(FIELD_ABSENT_FROM_PRISMA, key, name))
                elif _is_relation(model, prisma_models, name):
                    findings.append(Finding(FIELD_IS_RELATION, key, name))
            for name in props:
                if name not in model.fields:
                    findings.append(Finding(PROPERTY_ABSENT_FROM_PRISMA, key, name))
                elif not _is_relation(model, prisma_models, name):
                    findings.append(Finding(PROPERTY_IS_SCALAR, key, name))
            continue

        target = entity.get("x-view-of") or _allof_target(entity)
        if target is None:
            if not has_allof:
                findings.append(Finding(ORPHAN_ENTITY, key))
            continue
        if target not in prisma_models:
            findings.append(Finding(PROXY_TARGET_NOT_MODEL, key, target))
            continue
        model = prisma_models[target]
        second = entity["allOf"][1] if has_allof and len(entity["allOf"]) == 2 else {}
        proxy_names = list(fields) + list(props)
        if isinstance(second, dict):
            proxy_names += list(second.get("properties") or {})
        for name in proxy_names:
            if name not in model.fields:
                findings.append(Finding(PROPERTY_ABSENT_FROM_PRISMA, key, name, f"proxy of {target}"))
            elif not _is_relation(model, prisma_models, name):
                findings.append(Finding(PROXY_SCALAR_PROPERTY, key, name, f"proxy of {target}"))
    return findings


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------


def _as_map(value) -> CommentedMap:
    return value if isinstance(value, CommentedMap) else CommentedMap(value or {})


def _merged_properties(first: CommentedMap, second: CommentedMap) -> CommentedMap:
    """`first` entries then `second` entries, carrying per-entry comments over."""
    merged = CommentedMap()
    for source in (first, second):
        for name, value in source.items():
            merged[name] = value
            if name in source.ca.items:
                merged.ca.items[name] = source.ca.items[name]
    leading = first.ca.comment or second.ca.comment
    if leading:
        merged.ca.comment = leading
    return merged


def _insert_at(entity: CommentedMap, position: int, items: list[tuple[str, object]]) -> None:
    for offset, (key, value) in enumerate(items):
        entity.insert(position + offset, key, value)


def _rewrite_allof(entity: CommentedMap) -> None:
    allof = entity["allOf"]
    target = _allof_target(entity)
    second = allof[1] if len(allof) == 2 else {}
    position = list(entity.keys()).index("allOf")
    del entity["allOf"]
    items: list[tuple[str, object]] = [("x-view-of", target)]
    for key in ("required", "properties"):
        if key in second:
            items.append((key, second[key]))
    _insert_at(entity, position, items)


def _rewrite_fields(entity: CommentedMap) -> None:
    keys = list(entity.keys())
    positions = [keys.index(k) for k in ("fields", "properties") if k in entity]
    position = min(positions)
    merged = _merged_properties(_as_map(entity.get("fields")), _as_map(entity.get("properties")))
    for key in ("fields", "properties"):
        if key in entity:
            del entity[key]
    _insert_at(entity, position, [("properties", merged)])


def migrate_schema(schema, prisma_models: dict) -> list[Finding]:
    """Rewrite `schema` in place and return the findings of the inspection.

    Entities with a blocking finding are left exactly as they were.
    """
    findings = inspect_schema(schema, prisma_models)
    blocked = {f.entity for f in findings if f.blocking}
    for key, entity in ((schema or {}).get("definitions") or {}).items():
        if not isinstance(entity, CommentedMap) or key.startswith("__") or key in blocked:
            continue
        if "allOf" in entity and key not in prisma_models:
            _rewrite_allof(entity)
        if "fields" in entity:
            _rewrite_fields(entity)
    return findings


# ---------------------------------------------------------------------------
# Reporting and CLI
# ---------------------------------------------------------------------------


def format_report(label: str, findings: list[Finding], counts: dict[str, int]) -> str:
    lines = [f"== {label} =="]
    lines.append(
        "   entities: {entities}, with fields: {fields} ({field_entries} entries), "
        "allOf proxies: {proxies}".format(**counts)
    )
    if not findings:
        lines.append("   no findings")
    by_code: dict[str, list[Finding]] = {}
    for finding in findings:
        by_code.setdefault(finding.code, []).append(finding)
    for code, group in by_code.items():
        marker = "BLOCKING" if code in _BLOCKING else "note"
        lines.append(f"   [{marker}] {code}: {_DESCRIPTIONS[code]} ({len(group)})")
        for f in group:
            where = f"{f.entity}.{f.name}" if f.name else f.entity
            lines.append(f"       - {where}" + (f"  ({f.detail})" if f.detail else ""))
    return "\n".join(lines)


def count_schema(schema) -> dict[str, int]:
    defs = (schema or {}).get("definitions") or {}
    entities = [e for e in defs.values() if isinstance(e, dict)]
    with_fields = [e for e in entities if "fields" in e]
    return {
        "entities": len(entities),
        "fields": len(with_fields),
        "field_entries": sum(len(e.get("fields") or {}) for e in with_fields),
        "proxies": sum(1 for e in entities if "allOf" in e),
    }


def _load(yaml: YAML, path: Path):
    with path.open("r", encoding="utf-8") as f:
        return yaml.load(f)


def _generator_inputs(root: Path):
    """Yield (label, schema path, prisma paths, relations json) for the generator's own inputs."""
    default_prisma = root / "prisma" / "schema.prisma"
    cg = root / "code_generator"
    yield "default", cg / "json_schema.yaml", [default_prisma], None
    yield "internal", cg / "json_schema_internal.yaml", [default_prisma], None
    for schema_path in sorted((cg / "tests" / "fixtures").glob("*/json_schema.yaml")):
        fixture = schema_path.parent
        own_prisma = fixture / "schema.prisma"
        if own_prisma.is_file():
            yield f"fixture:{fixture.name}", schema_path, [own_prisma], None
        else:
            relations = fixture / "schema_relations.json"
            yield (
                f"fixture:{fixture.name}",
                schema_path,
                [default_prisma, fixture / "schema_additions.prisma"],
                relations if relations.is_file() else None,
            )


def _run_generator_root(root: Path) -> int:
    yaml = _make_yaml()
    blocking = 0
    for label, schema_path, prisma_paths, relations in _generator_inputs(root):
        schema = _load(yaml, schema_path)
        models = load_prisma_models(prisma_paths, relations)
        findings = inspect_schema(schema, models)
        blocking += sum(f.blocking for f in findings)
        print(format_report(label, findings, count_schema(schema)))
    return 1 if blocking else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("schema", type=Path, nargs="?", help="user schema YAML to migrate")
    parser.add_argument("--prisma", type=Path, action="append", help="Prisma schema (repeatable)")
    parser.add_argument("--relations", type=Path, help="schema_relations.json of a composed fixture")
    parser.add_argument("--generator-root", type=Path, help="dry-run every generator-side input under REPO")
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--in-place", action="store_true", help="rewrite SCHEMA in place")
    target.add_argument("--out", type=Path, help="write the migrated schema here")
    args = parser.parse_args(argv)

    if args.generator_root:
        if args.schema or args.in_place or args.out:
            parser.error("--generator-root is a dry run and takes no schema or output")
        return _run_generator_root(args.generator_root)
    if not args.schema or not args.prisma:
        parser.error("SCHEMA and at least one --prisma are required")

    yaml = _make_yaml()
    schema = _load(yaml, args.schema)
    models = load_prisma_models(args.prisma, args.relations)
    counts = count_schema(schema)
    writing = args.in_place or args.out is not None

    findings = migrate_schema(schema, models) if writing else inspect_schema(schema, models)
    print(format_report(str(args.schema), findings, counts))
    blocked = [f for f in findings if f.blocking]
    if not writing:
        return 1 if blocked else 0
    if blocked:
        print("refusing to write: resolve the BLOCKING findings above first", file=sys.stderr)
        return 1

    destination = args.schema if args.in_place else args.out
    with destination.open("w", encoding="utf-8") as f:
        yaml.dump(schema, f)
    print(f"wrote {destination}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
