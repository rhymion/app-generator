"""Tests for the prj:sync prisma/schema.prisma drop guard (Issue #646).

Background: `prj:sync` (scripts/prj_sync.py) copies a consumer's
`prj/prisma/schema.prisma` verbatim over this generator's own
`prisma/schema.prisma`. When the generator adds a new model or field to
its own schema and a consumer's `prj/` copy predates that addition, the
verbatim copy silently drops the new content -- confirmed to have
happened identically three times (proj_c/app-template, proj_h, proj_g)
at commit boundary f06d2a0b, which added the `idempotency_key` model and
the `user.api_key_expires_at` field. These tests reproduce that exact
shape and assert the guard both detects it and refuses to perform the
destructive copy.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import prj_sync  # noqa: E402


# ---------------------------------------------------------------------------
# _parse_prisma_models / _diff_prisma_schema_drop unit tests
# ---------------------------------------------------------------------------

DST_SCHEMA_F06D2A0B_SHAPE = """\
model user {
  id                    String   @id @default(cuid())
  email                 String   @unique
  api_key               String?  @unique
  api_key_expires_at    DateTime?
}

model idempotency_key {
  id         String   @id @default(cuid())
  key        String   @unique
  created_at DateTime @default(now())
}
"""

# The consumer's stale prj/prisma/schema.prisma, captured before
# f06d2a0b: no idempotency_key model, no api_key_expires_at field.
SRC_SCHEMA_PRE_F06D2A0B = """\
model user {
  id      String  @id @default(cuid())
  email   String  @unique
  api_key String? @unique
}
"""


def test_parse_prisma_models_extracts_model_and_field_names():
    models = prj_sync._parse_prisma_models(DST_SCHEMA_F06D2A0B_SHAPE)
    assert set(models) == {"user", "idempotency_key"}
    assert models["user"] == {"id", "email", "api_key", "api_key_expires_at"}
    assert models["idempotency_key"] == {"id", "key", "created_at"}


def test_parse_prisma_models_skips_comments_and_block_attributes():
    text = """\
model widget {
  // a comment describing id
  id   String @id
  /// doc comment
  name String
  @@unique([id, name])
  @@map("widgets")
}
"""
    models = prj_sync._parse_prisma_models(text)
    assert models["widget"] == {"id", "name"}


def test_diff_detects_f06d2a0b_shape_dropped_model_and_field(tmp_path):
    dst = tmp_path / "dst_schema.prisma"
    src = tmp_path / "src_schema.prisma"
    dst.write_text(DST_SCHEMA_F06D2A0B_SHAPE, encoding="utf-8")
    src.write_text(SRC_SCHEMA_PRE_F06D2A0B, encoding="utf-8")

    dropped = prj_sync._diff_prisma_schema_drop(dst, src)

    assert "model idempotency_key" in dropped
    assert "user.api_key_expires_at" in dropped


def test_diff_empty_when_src_has_all_dst_content(tmp_path):
    dst = tmp_path / "dst_schema.prisma"
    src = tmp_path / "src_schema.prisma"
    dst.write_text(DST_SCHEMA_F06D2A0B_SHAPE, encoding="utf-8")
    src.write_text(DST_SCHEMA_F06D2A0B_SHAPE, encoding="utf-8")

    assert prj_sync._diff_prisma_schema_drop(dst, src) == []


def test_diff_no_false_positive_for_consumer_only_additions(tmp_path):
    """Content present only in src (consumer additions) must never be flagged."""
    dst = tmp_path / "dst_schema.prisma"
    src = tmp_path / "src_schema.prisma"
    dst.write_text(
        """\
model user {
  id    String @id
  email String @unique
}
""",
        encoding="utf-8",
    )
    src.write_text(
        """\
model user {
  id             String @id
  email          String @unique
  consumer_field String?
}

model consumer_only_model {
  id String @id
}
""",
        encoding="utf-8",
    )

    assert prj_sync._diff_prisma_schema_drop(dst, src) == []


def test_diff_returns_empty_when_either_file_missing(tmp_path):
    dst = tmp_path / "dst_schema.prisma"
    src = tmp_path / "src_schema.prisma"
    dst.write_text(DST_SCHEMA_F06D2A0B_SHAPE, encoding="utf-8")
    # src does not exist -- nothing to diff against.
    assert prj_sync._diff_prisma_schema_drop(dst, src) == []


# ---------------------------------------------------------------------------
# prj_sync() end-to-end: the guard must actually block the destructive copy
# ---------------------------------------------------------------------------


def _make_tree(base: Path, rel: str, content: str) -> Path:
    f = base / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(content, encoding="utf-8")
    return f


def test_prj_sync_blocks_drop_and_leaves_dst_unchanged(tmp_path, capsys):
    prj_dir = tmp_path / "prj"
    dst_dir = tmp_path / "generator_root"
    _make_tree(prj_dir, "prisma/schema.prisma", SRC_SCHEMA_PRE_F06D2A0B)
    _make_tree(dst_dir, "prisma/schema.prisma", DST_SCHEMA_F06D2A0B_SHAPE)

    rc = prj_sync.prj_sync(prj_dir, dst_dir)

    assert rc == 1
    # dst must be untouched: the generator-side model/field must survive.
    result = (dst_dir / "prisma/schema.prisma").read_text(encoding="utf-8")
    assert result == DST_SCHEMA_F06D2A0B_SHAPE
    assert "idempotency_key" in result
    assert "api_key_expires_at" in result

    captured = capsys.readouterr()
    assert "ERROR" in captured.err
    assert "idempotency_key" in captured.err


def test_prj_sync_copies_through_when_no_drop(tmp_path, capsys):
    prj_dir = tmp_path / "prj"
    dst_dir = tmp_path / "generator_root"
    # src already has everything dst has, plus a consumer addition.
    src_content = DST_SCHEMA_F06D2A0B_SHAPE + "\nmodel consumer_only {\n  id String @id\n}\n"
    _make_tree(prj_dir, "prisma/schema.prisma", src_content)
    _make_tree(dst_dir, "prisma/schema.prisma", DST_SCHEMA_F06D2A0B_SHAPE)

    rc = prj_sync.prj_sync(prj_dir, dst_dir)

    assert rc == 0
    result = (dst_dir / "prisma/schema.prisma").read_text(encoding="utf-8")
    assert result == src_content
    assert "consumer_only" in result

    captured = capsys.readouterr()
    assert "ERROR" not in captured.err


def test_prj_sync_still_copies_other_files_when_schema_drop_detected(tmp_path):
    """A schema.prisma drop must not block unrelated files from syncing."""
    prj_dir = tmp_path / "prj"
    dst_dir = tmp_path / "generator_root"
    _make_tree(prj_dir, "prisma/schema.prisma", SRC_SCHEMA_PRE_F06D2A0B)
    _make_tree(dst_dir, "prisma/schema.prisma", DST_SCHEMA_F06D2A0B_SHAPE)
    _make_tree(prj_dir, "lib/custom.ts", "export const x = 1;\n")

    rc = prj_sync.prj_sync(prj_dir, dst_dir)

    assert rc == 1
    assert (dst_dir / "lib/custom.ts").read_text(encoding="utf-8") == "export const x = 1;\n"


def test_prj_sync_no_prj_dir_is_still_a_noop_success(tmp_path):
    dst_dir = tmp_path / "generator_root"
    dst_dir.mkdir()
    rc = prj_sync.prj_sync(tmp_path / "does_not_exist", dst_dir)
    assert rc == 0


# ---------------------------------------------------------------------------
# Generator-injected models (Issue #786): generate.py appends `payable` /
# `scheduled_task_run` to prisma/schema.prisma itself, so a consumer snapshot
# that lacks them is not a drop.
# ---------------------------------------------------------------------------

CONSUMER_BASE = """\
model user {
  id    String @id @default(cuid())
  email String @unique
}
"""

# What the generator's schema looks like after the first generate-code on a
# tree that declares x-payment: the consumer base plus the injected model.
GENERATOR_AFTER_FIRST_GENERATE = CONSUMER_BASE + """
model payable {
  id        String @id @default(cuid())
  record_id String
  status    String
}
"""


def test_diff_ignores_generator_injected_model_missing_from_consumer(tmp_path):
    dst = _make_tree(tmp_path / "dst", "schema.prisma", GENERATOR_AFTER_FIRST_GENERATE)
    src = _make_tree(tmp_path / "src", "schema.prisma", CONSUMER_BASE)

    assert prj_sync._diff_prisma_schema_drop(dst, src) == []


def test_diff_still_flags_non_injected_model_next_to_injected_one(tmp_path):
    dst_text = GENERATOR_AFTER_FIRST_GENERATE + "\nmodel idempotency_key {\n  id String @id\n}\n"
    dst = _make_tree(tmp_path / "dst", "schema.prisma", dst_text)
    src = _make_tree(tmp_path / "src", "schema.prisma", CONSUMER_BASE)

    assert prj_sync._diff_prisma_schema_drop(dst, src) == ["model idempotency_key"]


def test_diff_still_compares_fields_of_injected_model_the_consumer_carries(tmp_path):
    src_text = CONSUMER_BASE + "\nmodel payable {\n  id String @id @default(cuid())\n}\n"
    dst = _make_tree(tmp_path / "dst", "schema.prisma", GENERATOR_AFTER_FIRST_GENERATE)
    src = _make_tree(tmp_path / "src", "schema.prisma", src_text)

    assert prj_sync._diff_prisma_schema_drop(dst, src) == ["payable.record_id", "payable.status"]


def test_second_prj_sync_after_generate_code_does_not_fail_issue_786(tmp_path, capsys):
    """The exact #786 sequence: generate-code has appended `payable` to the
    generator schema, the consumer snapshot has no such model, prj:sync runs
    again. It used to exit 1 (asking for a manual mirror); it must now copy
    the consumer schema through and exit 0."""
    prj_dir = tmp_path / "prj"
    dst_dir = tmp_path / "generator_root"
    _make_tree(prj_dir, "prisma/schema.prisma", CONSUMER_BASE)
    _make_tree(dst_dir, "prisma/schema.prisma", GENERATOR_AFTER_FIRST_GENERATE)

    rc = prj_sync.prj_sync(prj_dir, dst_dir)

    assert rc == 0
    assert (dst_dir / "prisma/schema.prisma").read_text(encoding="utf-8") == CONSUMER_BASE
    assert "ERROR" not in capsys.readouterr().err


def test_injected_model_list_matches_what_generate_py_injects():
    """GENERATOR_INJECTED_MODELS must name exactly the models generate.py
    appends, or the guard either demands a needless manual mirror (name
    missing) or waves through a real drop (name added by mistake)."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import generate

    injected: set[str] = set()
    for attr in dir(generate):
        value = getattr(generate, attr)
        if attr.startswith("_") and attr.endswith("_PRISMA") and isinstance(value, str):
            injected |= set(prj_sync._parse_prisma_models(value))

    assert injected == set(prj_sync.GENERATOR_INJECTED_MODELS)
