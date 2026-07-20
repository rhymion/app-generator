#!/usr/bin/env python3
"""Build the intermediate generator schema from a user-authored schema.

Stage 1 (cmd_395 design doc, planning/cmd395-schema-restructuring-design.md
Sec.12 "Stage 1"): identity transform only.

`user_schema.yaml` is, at this stage, still in the legacy fully-specified
format -- every entity carries its own raw `type`/`required`/`properties`
plus the `_detail` UI/API-config entity with its `allOf`/`$ref` boilerplate.
Nothing in that format needs to be derived from Prisma yet: every field the
generator reads is already present verbatim in the user-authored file. So
this stage's builder is a round-trip loader/dumper that reproduces its
input byte-for-byte (module `_YAML_INDENT` documents the one formatting
choice required to match the project's existing YAML style).

`prisma_schema_path` is accepted now so the CLI contract is stable across
stages (Sec.9: `build_user_schema.py user_schema.yaml prisma/schema.prisma
--out .generated/json_schema.yaml`), but Stage 1 does not parse it for
derivation -- Prisma-driven raw-entity synthesis is introduced in Stage 3,
once `user_schema.yaml` moves to the simplified `fields:` format (see
design doc Sec.12 "Stage 3"). Stage 1 only checks that the given path
exists and is readable, so a missing/misconfigured Prisma schema fails
fast instead of silently.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ruamel.yaml import YAML

# Matches the indent style already used throughout json_schema.yaml: a
# block sequence's `-` markers sit two spaces further in than their parent
# key (mapping=2, sequence=4, offset=2), not ruamel's default
# (mapping=2, sequence=2, offset=0).
_YAML_INDENT = {"mapping": 2, "sequence": 4, "offset": 2}


def _make_yaml() -> YAML:
    yaml = YAML()
    yaml.preserve_quotes = True
    # Long lines (e.g. long `description:` blocks) must not be reflowed.
    yaml.width = 4096
    yaml.indent(**_YAML_INDENT)
    return yaml


def build_user_schema(
    user_schema_path: Path, prisma_schema_path: Path, out_path: Path
) -> None:
    """Write `out_path` from `user_schema_path` (Stage 1: identity transform).

    Raises FileNotFoundError if either input path does not exist.
    """
    if not user_schema_path.is_file():
        raise FileNotFoundError(f"user schema not found: {user_schema_path}")
    if not prisma_schema_path.is_file():
        raise FileNotFoundError(f"Prisma schema not found: {prisma_schema_path}")

    yaml = _make_yaml()
    with user_schema_path.open("r", encoding="utf-8") as f:
        data = yaml.load(f)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        yaml.dump(data, f)


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
    return 0


if __name__ == "__main__":
    sys.exit(main())
