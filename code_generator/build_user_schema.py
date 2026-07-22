#!/usr/bin/env python3
"""Build the intermediate generator schema from a user-authored schema.

Stage 4 (cmd_395 design doc, planning/cmd395-schema-restructuring-design.md
Sec.12 "Stage 4"; design review queue/reports/subtask_409a_gunshi.yaml): the
`_detail` suffix is retired from the user-authored schema. Where Stage 3
required writing `role_detail:` (with the raw entity implicitly named
`role`), Stage 4 lets the user write the natural `role:` directly. The
machine-derived raw entity that used to occupy the unsuffixed name now
moves to a reserved `__`-prefixed name (`__role`) so it can never collide
with a user-chosen entity name.

This module reconstructs the *exact* legacy-shape intermediate schema
(same shape `code_generator/json_schema.yaml` had through Stage 2, modulo
the `__` rename below) so `generate.py` keeps working once Batch 2 teaches
it the new key convention:

  - For every user schema entity whose name IS a Prisma model AND that
    carries at least one Category D / view-level annotation
    (`_VIEW_LEVEL_CONFIG_KEYS` -- `x-generate`, `x-audit`,
    `x-relationships`, `x-search`, `x-custom-components`) -- a "paired"
    entity, e.g. `role` (was `role_detail`): the raw entity `__role` is
    synthesized from Prisma (`schema_deriver.derive_raw_entity`),
    Category C entity-level annotations (`x-import-key`, `x-display`,
    etc.) move from the user schema entry onto it, and the view entity
    `role` is reconstructed with an `allOf: [{$ref: __role}, {...}]`
    wrapper. The view's embed declarations (`required:`/`properties:` for
    many-to-many / many-to-one relations) are *not* re-derived -- Sec.7's
    own R4 table only classifies `x-relationships` (the relation
    existence + target) as data; the embed *shape* around it
    (`x-outputType`, which `required` entries apply, one-off structural
    exceptions like `commentable`'s plain Prisma back-relation with no
    `x-relationships` entry at all) is copied through verbatim from the
    user schema's own `required:`/`properties:` keys. This keeps the
    only-really-derivable part (Category A: the raw entity) the only part
    this module actually derives, which is what Sec.4's ~1,400-line/43%
    estimate is about in the first place.

    Whether an entity needs this raw/view split is decided by *content*
    (does it carry a view-level annotation?), not by name, because Stage 4
    entity names no longer carry a `_detail` marker to key off of. This is
    also what "normalizes" the one pre-Stage-4 anomaly on record
    (`inventory_transaction` in proj_c, per gunshi review): a Prisma-model
    entity that had `x-generate` directly on what was nominally its "raw"
    entry now goes through the same split as every other paired entity.

  - For every user schema entity whose name IS a Prisma model with no
    view-level annotation ("standalone raw", e.g. `comment`, `reaction`):
    the entity is fully reconstructed the same way, with entity-level
    Category C annotations merged directly onto it (no separate view, no
    `__` prefix -- there is nothing to disambiguate it from).

  - Anything else (e.g. `setting`, a second view of the `user` model that
    is not itself a Prisma model) is a pass-through: copied verbatim,
    since it never had raw boilerplate of its own to eliminate.

Top-level file keys (`$schema`, `format-version`, `x-generator`, and the
annotation-type documentation blocks `x-pii`/`x-retention`/`x-mention`/
`x-gdpr-mode`/`x-import-key`) are generator meta-config, not per-entity
data -- they never duplicated anything in Prisma and are copied through
unchanged.

Entity-name validation (`_validate_entity_names`) runs before any of the
above: a user-authored entity name starting with the reserved `__` prefix,
or a Prisma-model-named entity that is itself written in the pass-through
(`allOf`-wrapper) shape, is rejected with a clear error rather than being
silently misinterpreted.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ruamel.yaml import YAML

from schema_deriver import SchemaDivergenceError, derive_raw_entity, parse_prisma_schema

# Reserved prefix for machine-generated raw entities (Stage 4).
_RESERVED_RAW_PREFIX = "__"


class UserSchemaError(Exception):
    """Raised when the user-authored schema itself is invalid: a reserved
    `__`-prefixed entity name, or a Prisma-model-named entity written in
    the pass-through (`allOf`-wrapper) shape. Distinct from
    `SchemaDivergenceError` (R5), which is about a field-level fact
    contradicting Prisma once an entity's shape is otherwise valid.
    """

# Matches the indent style already used throughout json_schema.yaml: a
# block sequence's `-` markers sit two spaces further in than their parent
# key (mapping=2, sequence=4, offset=2), not ruamel's default
# (mapping=2, sequence=2, offset=0).
_YAML_INDENT = {"mapping": 2, "sequence": 4, "offset": 2}

# Category C entity-level annotations that legacy format placed on the RAW
# entity, but the user schema now carries on the paired / standalone entry
# (Sec.7 R4 table). The builder copies these back onto the reconstructed
# raw entity so the intermediate schema is unchanged.
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

# Category D: unchanged location, stay on the view entity as before. Also
# the content-based signal (`_has_view_level_config`) for whether an entity
# needs a raw/view split at all.
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


def _has_view_level_config(entry: dict) -> bool:
    """Whether `entry` carries at least one Category D / view-level
    annotation -- the content-based signal (Stage 4 has no `_detail`
    suffix to key off of) that decides whether a Prisma-model-named
    entity needs a raw/view split at all.
    """
    return any(key in entry for key in _VIEW_LEVEL_CONFIG_KEYS)


def _validate_entity_names(user_definitions: dict, prisma_models: dict) -> None:
    """Reject user schema entity names before any other processing (Sec.4
    of the design review). Two failure modes:

    1. A user-chosen entity name starts with the reserved `__` prefix --
       that namespace is reserved for this module's own synthesized raw
       entities and must never collide with a user-authored one.
    2. A user-chosen entity name matches a Prisma model name, but the
       entry is written in the pass-through/`allOf`-wrapper shape (as
       `setting` legitimately is for the *non*-model-named case). Such an
       entity would silently stop being a pass-through and instead be
       (mis)interpreted as that Prisma model's own raw/view pair,
       discarding the author's actual `allOf` intent.
    """
    for entity_key, raw_entry in user_definitions.items():
        entry = raw_entry or {}
        if entity_key.startswith(_RESERVED_RAW_PREFIX):
            raise UserSchemaError(
                f"ERROR: Entity name '{entity_key}' is reserved: the '__' "
                "prefix is used for machine-generated raw entities derived "
                "from Prisma models. Rename your entity to avoid the '__' "
                "prefix."
            )
        if entity_key in prisma_models and "allOf" in entry:
            raise UserSchemaError(
                f"ERROR: Entity '{entity_key}' in user schema is "
                f"interpreted as the view definition for Prisma model "
                f"'{entity_key}'. If you intend a different entity, rename "
                "it or the Prisma model."
            )


def _build_raw_and_view(entity_key: str, entry: dict, prisma_models: dict):
    fields_spec = entry.get("fields") or {}
    raw = derive_raw_entity(prisma_models[entity_key], fields_spec)

    for key in _ENTITY_LEVEL_DATA_KEYS:
        if key in entry:
            raw[key] = entry[key]

    view: dict = {}
    for key in _VIEW_LEVEL_CONFIG_KEYS:
        if key in entry:
            view[key] = entry[key]

    allof: list = [{"$ref": f"#/definitions/{_RESERVED_RAW_PREFIX}{entity_key}"}]
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

    _validate_entity_names(user_definitions, prisma_models)

    for entity_key, raw_entry in user_definitions.items():
        entry = raw_entry or {}
        try:
            if entity_key in prisma_models and _has_view_level_config(entry):
                raw, view = _build_raw_and_view(entity_key, entry, prisma_models)
                out["definitions"][f"{_RESERVED_RAW_PREFIX}{entity_key}"] = raw
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
    """Write `out_path` from `user_schema_path` (Stage 4: Prisma-driven derivation,
    `__`-prefixed synthesized raw entities).

    Raises FileNotFoundError if either input path does not exist.
    Raises UserSchemaError if the user schema itself is invalid (reserved
    `__` prefix, or a Prisma-model-named entity written as a pass-through).
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
    except UserSchemaError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
