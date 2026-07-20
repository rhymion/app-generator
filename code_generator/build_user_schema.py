#!/usr/bin/env python3
"""Build the intermediate generator schema from a user-authored schema.

Stage 3 (cmd_395 design doc, planning/cmd395-schema-restructuring-design.md
Sec.12 "Stage 3" / Sec.5 R2 / Sec.7 R4): `user_schema.yaml` is now in the
simplified format -- raw entity boilerplate (`type`/`required`/full
`properties`) is gone; only non-derivable (Category C/D, Sec.3) annotations
remain, keyed by entity and, for field-level annotations, nested under a
`fields:` map.

This module reconstructs the *exact* legacy-shape intermediate schema
(same shape `code_generator/json_schema.yaml` had through Stage 2) so
`generate.py` -- unmodified -- keeps working:

  - For every user schema entity named `{model}_detail` where `{model}` is
    a Prisma model name (a "paired" entity, e.g. `role_detail` -> `role`):
    the raw entity `{model}` is synthesized from Prisma
    (`schema_deriver.derive_raw_entity`), Category C entity-level
    annotations (`x-import-key`, `x-display`, etc.) move from the user
    schema entry back onto it, and the view entity `{model}_detail` is
    reconstructed with an `allOf: [{$ref: model}, {...}]` wrapper.  The
    view's embed declarations (`required:`/`properties:` for many-to-many
    /  many-to-one relations) are *not* re-derived -- Sec.7's own R4 table
    only classifies `x-relationships` (the relation existence + target)
    as data; the embed *shape* around it (`x-outputType`, which
    `required` entries apply, one-off structural exceptions like
    `commentable_detail`'s plain Prisma back-relation with no
    `x-relationships` entry at all) is copied through verbatim from the
    user schema's own `required:`/`properties:` keys. This keeps the
    only-really-derivable part (Category A: the raw entity) the only part
    this module actually derives, which is what Sec.4's ~1,400-line/43%
    estimate is about in the first place.

  - For every user schema entity whose name IS a Prisma model with no
    `_detail` counterpart ("standalone raw", e.g. `comment`, `reaction`):
    the entity is fully reconstructed the same way, with entity-level
    Category C annotations merged directly onto it (no separate view to
    move them to).

  - Anything else (e.g. `setting`, a second view of the `user` model that
    is not itself a Prisma model and does not end in `_detail` over one)
    is a pass-through: copied verbatim, since it never had raw
    boilerplate of its own to eliminate.

Top-level file keys (`$schema`, `format-version`, `x-generator`, and the
annotation-type documentation blocks `x-pii`/`x-retention`/`x-mention`/
`x-gdpr-mode`/`x-import-key`) are generator meta-config, not per-entity
data -- they never duplicated anything in Prisma and are copied through
unchanged.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ruamel.yaml import YAML

from schema_deriver import SchemaDivergenceError, derive_raw_entity, parse_prisma_schema

# Matches the indent style already used throughout json_schema.yaml: a
# block sequence's `-` markers sit two spaces further in than their parent
# key (mapping=2, sequence=4, offset=2), not ruamel's default
# (mapping=2, sequence=2, offset=0).
_YAML_INDENT = {"mapping": 2, "sequence": 4, "offset": 2}

# Category C entity-level annotations that legacy format placed on the RAW
# entity, but Stage 3's user schema now carries on the paired _detail /
# standalone entry (Sec.7 R4 table). The builder copies these back onto
# the reconstructed raw entity so the intermediate schema is unchanged.
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

# Category D: unchanged location, stay on the view/_detail entity as before.
_VIEW_LEVEL_CONFIG_KEYS = (
    "x-generate",
    "x-audit",
    "x-relationships",
    "x-search",
    "x-custom-components",
)


def _make_yaml() -> YAML:
    yaml = YAML()
    yaml.preserve_quotes = True
    # Long lines (e.g. long `description:` blocks) must not be reflowed.
    yaml.width = 4096
    yaml.indent(**_YAML_INDENT)
    return yaml


def _base_model_for_view(entity_key: str, prisma_models: dict) -> str | None:
    """If `entity_key` is a paired `{model}_detail` view, return `{model}`."""
    suffix = "_detail"
    if entity_key.endswith(suffix):
        candidate = entity_key[: -len(suffix)]
        if candidate in prisma_models:
            return candidate
    return None


def _build_raw_and_view(entity_key: str, base_model_name: str, entry: dict, prisma_models: dict):
    fields_spec = entry.get("fields") or {}
    raw = derive_raw_entity(prisma_models[base_model_name], fields_spec)

    for key in _ENTITY_LEVEL_DATA_KEYS:
        if key in entry:
            raw[key] = entry[key]

    view: dict = {}
    for key in _VIEW_LEVEL_CONFIG_KEYS:
        if key in entry:
            view[key] = entry[key]

    allof: list = [{"$ref": f"#/definitions/{base_model_name}"}]
    if "required" in entry or "properties" in entry:
        allof_second: dict = {"type": "object"}
        if "required" in entry:
            allof_second["required"] = entry["required"]
        if "properties" in entry:
            allof_second["properties"] = entry["properties"]
        allof.append(allof_second)
    view["allOf"] = allof

    return raw, view


def _build_standalone_raw(entity_key: str, entry: dict, prisma_models: dict) -> dict:
    fields_spec = entry.get("fields") or {}
    raw = derive_raw_entity(prisma_models[entity_key], fields_spec)
    for key, value in entry.items():
        if key == "fields":
            continue
        raw[key] = value
    return raw


def build_intermediate_schema(user_schema: dict, prisma_models: dict) -> dict:
    """Reconstruct the legacy-shape intermediate schema dict (Sec.5 R2)."""
    out: dict = {}
    for top_key, top_value in user_schema.items():
        if top_key != "definitions":
            out[top_key] = top_value

    out["definitions"] = {}
    user_definitions = user_schema.get("definitions") or {}

    for entity_key, raw_entry in user_definitions.items():
        entry = raw_entry or {}
        base_model_name = _base_model_for_view(entity_key, prisma_models)
        try:
            if base_model_name is not None:
                raw, view = _build_raw_and_view(entity_key, base_model_name, entry, prisma_models)
                out["definitions"][base_model_name] = raw
                out["definitions"][entity_key] = view
            elif entity_key in prisma_models:
                out["definitions"][entity_key] = _build_standalone_raw(
                    entity_key, entry, prisma_models
                )
            else:
                # Pass-through: e.g. `setting`, a second view of `user`
                # that has no raw entity of its own to eliminate.
                out["definitions"][entity_key] = entry
        except SchemaDivergenceError as exc:
            raise SchemaDivergenceError(f"entity '{entity_key}': {exc}") from exc

    return out


def build_user_schema(
    user_schema_path: Path, prisma_schema_path: Path, out_path: Path
) -> None:
    """Write `out_path` from `user_schema_path` (Stage 3: Prisma-driven derivation).

    Raises FileNotFoundError if either input path does not exist.
    Raises SchemaDivergenceError (R5) if the user schema asserts a fact
    (e.g. an `x-relationship.target`) that contradicts what Prisma says.
    """
    if not user_schema_path.is_file():
        raise FileNotFoundError(f"user schema not found: {user_schema_path}")
    if not prisma_schema_path.is_file():
        raise FileNotFoundError(f"Prisma schema not found: {prisma_schema_path}")

    yaml = _make_yaml()
    with user_schema_path.open("r", encoding="utf-8") as f:
        user_schema = yaml.load(f)

    prisma_models = parse_prisma_schema(prisma_schema_path)
    intermediate = build_intermediate_schema(user_schema, prisma_models)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        yaml.dump(intermediate, f)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Build the intermediate generator schema "
            "(.generated/json_schema.yaml) from a user-authored schema."
        )
    )
    parser.add_argument("user_schema", type=Path, help="Path to user_schema.yaml")
    parser.add_argument(
        "prisma_schema", type=Path, help="Path to prisma/schema.prisma"
    )
    parser.add_argument(
        "--out", type=Path, required=True, help="Output path for the intermediate schema"
    )
    args = parser.parse_args(argv)

    try:
        build_user_schema(args.user_schema, args.prisma_schema, args.out)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except SchemaDivergenceError as exc:
        print(f"error: schema divergence (R5): {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
