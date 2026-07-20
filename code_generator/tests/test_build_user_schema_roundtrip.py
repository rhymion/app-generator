"""
Tests for build_user_schema.py -- cmd_395 Stage 1 (identity transform).

Stage 1's pass/fail gate (design doc Sec.9 "Stage 1 golden diff -- two
levels"): the builder must reproduce code_generator/json_schema.yaml
byte-for-byte as its output, given that file (unchanged format) as the
user-authored schema.

The committed json_schema.yaml has one pre-existing, purely-cosmetic
artifact -- a trailing space after `requestor_role_id.type:` (a key
immediately followed by a block-sequence value) -- that a round-trip YAML
dump normalizes away. This is reported explicitly here per the AC ("differs
-> report + get a ruling, never silently allow") rather than swept under a
loose comparison: the test pins down that this is the *only* line allowed
to differ, and that the difference is whitespace-only, so any other
regression in round-trip fidelity still fails the test.
"""
from pathlib import Path

import pytest
from ruamel.yaml import YAML

from build_user_schema import build_user_schema

SCHEMA_PATH = Path(__file__).parent.parent / "json_schema.yaml"
PRISMA_SCHEMA_PATH = Path(__file__).parent.parent.parent / "prisma" / "schema.prisma"


def test_roundtrip_byte_for_byte_modulo_known_trailing_whitespace(tmp_path):
    out_path = tmp_path / ".generated" / "json_schema.yaml"

    build_user_schema(SCHEMA_PATH, PRISMA_SCHEMA_PATH, out_path)

    original_text = SCHEMA_PATH.read_text(encoding="utf-8")
    output_text = out_path.read_text(encoding="utf-8")

    if output_text == original_text:
        return

    original_lines = original_text.splitlines()
    output_lines = output_text.splitlines()
    assert len(original_lines) == len(output_lines), (
        "roundtrip changed the line count -- not a formatting-only diff"
    )

    diffs = [
        (i, o, r)
        for i, (o, r) in enumerate(zip(original_lines, output_lines))
        if o != r
    ]
    assert len(diffs) == 1, f"unexpected roundtrip differences: {diffs}"

    lineno, orig_line, out_line = diffs[0]
    assert orig_line.rstrip() == out_line.rstrip(), (
        f"non-whitespace roundtrip diff at line {lineno + 1}: "
        f"{orig_line!r} vs {out_line!r}"
    )
    assert orig_line != orig_line.rstrip(), (
        f"line {lineno + 1} differs but the original has no trailing "
        f"whitespace to explain it: {orig_line!r} vs {out_line!r}"
    )


def test_roundtrip_preserves_all_annotations_semantically():
    """Every x-* annotation key/value survives the round trip verbatim.

    Independent of the byte-level test above: parses both documents and
    walks them recursively, so a future formatting-only change to the
    dumper can't accidentally also start dropping annotation content.
    """
    import tempfile

    yaml = YAML(typ="safe")
    with SCHEMA_PATH.open(encoding="utf-8") as f:
        original = yaml.load(f)

    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / ".generated" / "json_schema.yaml"
        build_user_schema(SCHEMA_PATH, PRISMA_SCHEMA_PATH, out_path)
        with out_path.open(encoding="utf-8") as f:
            rebuilt = yaml.load(f)

    def collect_x_keys(node, path=""):
        found = {}
        if isinstance(node, dict):
            for key, value in node.items():
                sub_path = f"{path}.{key}" if path else str(key)
                if isinstance(key, str) and key.startswith("x-"):
                    found[sub_path] = value
                found.update(collect_x_keys(value, sub_path))
        elif isinstance(node, list):
            for idx, item in enumerate(node):
                found.update(collect_x_keys(item, f"{path}[{idx}]"))
        return found

    original_x = collect_x_keys(original)
    rebuilt_x = collect_x_keys(rebuilt)

    assert original_x.keys() == rebuilt_x.keys()
    for key in original_x:
        assert original_x[key] == rebuilt_x[key], f"annotation drifted: {key}"
    assert len(original_x) > 0, "sanity check: fixture must contain x-* annotations"


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
