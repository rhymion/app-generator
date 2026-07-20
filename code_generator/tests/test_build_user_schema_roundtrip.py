"""
Tests for build_user_schema.py -- cmd_395 Stage 3 (Prisma-driven derivation).

Stage 3's pass/fail gate (design doc Sec.9 "Validation gate: before any
Stage N+1 PR is opened" / Sec.12 Stage 3): given the new simplified
`user_schema.yaml` + `prisma/schema.prisma`, the builder must reconstruct
an intermediate schema that is *semantically* identical to the Stage 2
reference (the legacy fully-specified format this project used through
Stage 2, snapshotted at `tests/fixtures/stage2_reference_json_schema.yaml`
-- before Stage 3 replaced the live `json_schema.yaml` with the simplified
format). "Semantically identical" -- not byte-identical, unlike Stage 1 --
because reconstructed dict key order need not match for `generate.py`'s
*output* to be byte-identical (verified separately, at the generate-code
pipeline level, by the golden-diff harness this task's report documents).
"""
from pathlib import Path

import pytest
from ruamel.yaml import YAML

from build_user_schema import build_user_schema
from schema_deriver import SchemaDivergenceError

SCHEMA_PATH = Path(__file__).parent.parent / "json_schema.yaml"
PRISMA_SCHEMA_PATH = Path(__file__).parent.parent.parent / "prisma" / "schema.prisma"
STAGE2_REFERENCE_PATH = Path(__file__).parent / "fixtures" / "stage2_reference_json_schema.yaml"


def _load(path):
    yaml = YAML(typ="safe")
    with path.open(encoding="utf-8") as f:
        return yaml.load(f)


def _deep_diff(a, b, path=""):
    diffs = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in a.keys() - b.keys():
            diffs.append(f"{path}.{k}: missing in rebuilt (expected {a[k]!r})")
        for k in b.keys() - a.keys():
            diffs.append(f"{path}.{k}: unexpected in rebuilt ({b[k]!r})")
        for k in a.keys() & b.keys():
            diffs.extend(_deep_diff(a[k], b[k], f"{path}.{k}"))
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            diffs.append(f"{path}: list length {len(a)} != {len(b)}")
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                diffs.extend(_deep_diff(x, y, f"{path}[{i}]"))
    else:
        if a != b:
            diffs.append(f"{path}: {a!r} != {b!r}")
    return diffs


def test_stage3_derivation_matches_stage2_reference_semantically(tmp_path):
    out_path = tmp_path / ".generated" / "json_schema.yaml"
    build_user_schema(SCHEMA_PATH, PRISMA_SCHEMA_PATH, out_path)

    expected = _load(STAGE2_REFERENCE_PATH)
    rebuilt = _load(out_path)

    diffs = _deep_diff(expected, rebuilt)
    assert not diffs, "Stage 3 output diverges from the Stage 2 reference:\n" + "\n".join(diffs)


def test_stage3_user_schema_is_smaller_than_stage2_reference():
    """Sec.4's core claim: raw-entity elimination measurably shrinks the file."""
    original_lines = STAGE2_REFERENCE_PATH.read_text(encoding="utf-8").splitlines()
    new_lines = SCHEMA_PATH.read_text(encoding="utf-8").splitlines()
    assert len(new_lines) < len(original_lines)
    reduction = 1 - (len(new_lines) / len(original_lines))
    assert reduction > 0.30, f"expected a substantial reduction, got {reduction:.1%}"


def test_missing_user_schema_raises():
    with pytest.raises(FileNotFoundError):
        build_user_schema(
            Path("/nonexistent/user_schema.yaml"),
            PRISMA_SCHEMA_PATH,
            Path("/tmp/does-not-matter.yaml"),
        )


def test_missing_prisma_schema_raises():
    with pytest.raises(FileNotFoundError):
        build_user_schema(
            SCHEMA_PATH,
            Path("/nonexistent/schema.prisma"),
            Path("/tmp/does-not-matter.yaml"),
        )


def test_unknown_field_name_raises_divergence(tmp_path):
    """R5: a `fields:` entry naming a column that doesn't exist in Prisma
    is a divergence, not a silently-empty property."""
    user_schema_path = tmp_path / "user_schema.yaml"
    user_schema_path.write_text(
        "definitions:\n"
        "  role_detail:\n"
        "    x-generate: {list: true}\n"
        "    fields:\n"
        "      not_a_real_column: {}\n",
        encoding="utf-8",
    )
    with pytest.raises(SchemaDivergenceError):
        build_user_schema(user_schema_path, PRISMA_SCHEMA_PATH, tmp_path / "out.yaml")
