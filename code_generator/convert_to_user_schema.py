#!/usr/bin/env python3
"""Automated converter: legacy `json_schema.yaml` -> Stage 3 `user_schema.yaml`.

cmd_395 design doc Sec.4/Sec.12 Stage 3: this is the "automated schema
converter" mandated instead of hand-rewriting the ~94-entity legacy file
(hand rewriting is exactly the kind of mechanical transcription that drops
annotations silently -- this tool exists so that never happens).

It performs the mirror-image transform of `build_user_schema.py`:

  legacy json_schema.yaml + prisma/schema.prisma  --[this tool]-->  user_schema.yaml
  user_schema.yaml + prisma/schema.prisma  --[build_user_schema.py]-->  intermediate schema

For every entity, Category A (Sec.3) content -- the raw entity's
`type`/`required`/full `properties` -- is dropped (it is exactly what
`build_user_schema.py` re-derives from Prisma). Only Category B fields
that diverge from the Prisma-derived default (Sec.7 DP-R4-1: a
`labelField` other than `name`) and Category C/D annotations are kept,
under the same `fields:` / entity-level shape `build_user_schema.py`
expects.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ruamel.yaml import YAML

from schema_deriver import parse_prisma_schema

_YAML_INDENT = {"mapping": 2, "sequence": 4, "offset": 2}

_CUID_PATTERN = "^c[a-z0-9]{24,}$"

_VIEW_LEVEL_CONFIG_KEYS = (
    "x-generate",
    "x-audit",
    "x-relationships",
    "x-search",
    "x-custom-components",
)

# Category C entity-level keys that legacy format placed on the RAW entity
# and Stage 3 moves onto the paired view / standalone entry (Sec.7 R4).
_ENTITY_LEVEL_DATA_KEYS = (
    "x-import-key",
    "x-display",
    "x-readonly-fields",
    "x-internal",
    "x-approval",
    "x-approval-lines",
    "x-ledger-source",
    "x-splittable",
    "x-reservation",
    "x-gdpr-mode",
)


def _make_yaml() -> YAML:
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.width = 4096
    yaml.indent(**_YAML_INDENT)
    return yaml


def _convert_field_property(prop: dict, prisma_model, field_name: str) -> dict:
    """Strip Category A/derivable-B content from one legacy property dict,
    returning only what Stage 3's `fields:` override must still carry.
    """
    out: dict = {}
    pf = prisma_model.fields.get(field_name) if prisma_model else None
    fk_target = prisma_model.fk_target(field_name) if prisma_model else None

    if "nullable" in prop and prop.get("nullable") is True and isinstance(prop.get("type"), str):
        # Legacy single-type + `nullable: true` style (vs. the more common
        # `type: [T, null]` array form) -- both are Category A/derivable
        # from Prisma nullability, but the *representation* differs, so
        # tell the builder which style to reproduce.
        out["_legacy_nullable_style"] = True

    prop_type = prop.get("type")
    is_type_nullable = isinstance(prop_type, list) and "null" in prop_type
    is_legacy_nullable = prop.get("nullable") is True
    if pf is not None and pf.nullable and not is_type_nullable and not is_legacy_nullable:
        # Prisma allows null, but the legacy schema never did for this
        # field (e.g. room_type.capacity is `Int?` in Prisma yet always
        # required non-null here) -- a pre-existing exception, preserved
        # verbatim rather than "corrected" by the derivation.
        out["_non_nullable_override"] = True

    if fk_target is not None and "pattern" not in prop:
        # Prisma says this column is an FK (so the CUID pattern would
        # normally be re-derived), but the legacy schema omits `pattern`
        # for this one -- keep that omission.
        out["_no_fk_pattern"] = True

    for key, value in prop.items():
        if key in ("type", "nullable"):
            continue  # Category A: nullable/scalar type, re-derived from Prisma
        if key == "pattern" and value == _CUID_PATTERN and fk_target is not None:
            continue  # Category A: FK CUID pattern, re-derived
        if key == "format" and value == "date-time":
            continue  # Category A: DateTime -> date-time, re-derived
        if key == "default":
            # Category C: kept verbatim -- the legacy schema does not
            # always mirror Prisma's @default even when Prisma has one
            # (e.g. attachment.type), so this is never auto-dropped.
            out[key] = value
            continue
        if key == "x-relationship":
            rel_out = {}
            rel_type = value.get("type")
            if rel_type is not None and rel_type != "many-to-one":
                # A handful of FK columns carry a semantic variant Prisma
                # has no concept of (e.g. "one-to-one_bridge") -- genuine
                # Category C content, kept as an explicit override.
                rel_out["type"] = rel_type
            label_field = value.get("labelField")
            if label_field is not None and label_field != "name":
                rel_out["labelField"] = label_field  # DP-R4-1: only non-default kept
            for k2, v2 in value.items():
                if k2 in ("type", "target", "labelField"):
                    continue
                rel_out[k2] = v2
            out[key] = rel_out  # present (even if {}) => "this is a relation field"
            continue
        out[key] = value
    return out


def _convert_raw_properties_to_fields(raw_entity: dict, prisma_model) -> dict:
    fields: dict = {}
    required = set(raw_entity.get("required") or [])
    for field_name, prop in (raw_entity.get("properties") or {}).items():
        if field_name == "id":
            continue
        converted = _convert_field_property(prop or {}, prisma_model, field_name)
        if field_name in required and prisma_model is not None:
            pf = prisma_model.fields.get(field_name)
            # Mechanical rule (schema_deriver.derive_raw_entity): required
            # iff non-nullable and no Prisma default. When the legacy
            # schema marks a field required *despite* a Prisma default
            # (e.g. attachment.type), that's a real exception -- pin it
            # down explicitly instead of silently losing it.
            if pf is not None and (pf.nullable or pf.has_default):
                converted["_required"] = True
        fields[field_name] = converted
    return fields


def _convert_paired(view_entry: dict, raw_entity: dict, prisma_model) -> dict:
    new_entry: dict = {}
    for key in _VIEW_LEVEL_CONFIG_KEYS:
        if key in view_entry:
            new_entry[key] = view_entry[key]
    for key in _ENTITY_LEVEL_DATA_KEYS:
        if key in raw_entity:
            new_entry[key] = raw_entity[key]

    fields = _convert_raw_properties_to_fields(raw_entity, prisma_model)
    if fields:
        new_entry["fields"] = fields

    allof = view_entry.get("allOf") or []
    if len(allof) > 1:
        second = allof[1] or {}
        if "required" in second:
            new_entry["required"] = second["required"]
        if "properties" in second:
            new_entry["properties"] = second["properties"]
    return new_entry


def _convert_standalone(entry: dict, prisma_model) -> dict:
    new_entry: dict = {}
    for key, value in entry.items():
        if key in ("type", "required", "properties"):
            continue
        new_entry[key] = value
    fields = _convert_raw_properties_to_fields(entry, prisma_model)
    if fields:
        new_entry["fields"] = fields
    return new_entry


def convert_to_user_schema(legacy_data: dict, prisma_models: dict) -> dict:
    legacy_definitions = legacy_data.get("definitions") or {}

    paired_raw_names = {
        key[: -len("_detail")]
        for key in legacy_definitions
        if key.endswith("_detail") and key[: -len("_detail")] in legacy_definitions
    }

    new_definitions: dict = {}
    for key, entry in legacy_definitions.items():
        entry = entry or {}
        if key in paired_raw_names:
            continue  # folded into its `{key}_detail` companion below
        if key.endswith("_detail") and key[: -len("_detail")] in paired_raw_names:
            base_name = key[: -len("_detail")]
            raw_entity = legacy_definitions[base_name]
            prisma_model = prisma_models.get(base_name)
            new_definitions[key] = _convert_paired(entry, raw_entity, prisma_model)
        elif entry.get("type") == "object" and "properties" in entry:
            prisma_model = prisma_models.get(key)
            new_definitions[key] = _convert_standalone(entry, prisma_model)
        else:
            new_definitions[key] = entry  # pass-through (e.g. `setting`)

    out: dict = {}
    for top_key, top_value in legacy_data.items():
        if top_key != "definitions":
            out[top_key] = top_value
    out["definitions"] = new_definitions
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convert a legacy json_schema.yaml to the Stage 3 simplified user_schema.yaml format."
    )
    parser.add_argument("legacy_schema", type=Path, help="Path to the current json_schema.yaml")
    parser.add_argument("prisma_schema", type=Path, help="Path to prisma/schema.prisma")
    parser.add_argument("--out", type=Path, required=True, help="Output path for user_schema.yaml")
    args = parser.parse_args(argv)

    if not args.legacy_schema.is_file():
        print(f"error: legacy schema not found: {args.legacy_schema}", file=sys.stderr)
        return 1
    if not args.prisma_schema.is_file():
        print(f"error: Prisma schema not found: {args.prisma_schema}", file=sys.stderr)
        return 1

    yaml = _make_yaml()
    with args.legacy_schema.open("r", encoding="utf-8") as f:
        legacy_data = yaml.load(f)

    prisma_models = parse_prisma_schema(args.prisma_schema)
    new_data = convert_to_user_schema(legacy_data, prisma_models)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        yaml.dump(new_data, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
