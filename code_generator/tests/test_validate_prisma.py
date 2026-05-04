"""Tests for the Prisma schema index validator in validate.py."""
from pathlib import Path

import pytest

from validate import (
    SchemaValidationError,
    validate_prisma_indexes,
    _iter_model_blocks,
    _leftmost_indexed_columns,
    _model_has_column,
)


def _write(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "schema.prisma"
    path.write_text(content)
    return path


# ---------------------------------------------------------------------------
# Helper-level tests
# ---------------------------------------------------------------------------

def test_iter_model_blocks_basic():
    text = """
generator client {
  provider = "prisma-client"
}

model foo {
  id String @id
}

model bar {
  id String @id
}
"""
    blocks = list(_iter_model_blocks(text))
    assert [name for name, _ in blocks] == ["foo", "bar"]


def test_leftmost_indexed_columns_picks_first_only():
    body = """
  id String @id
  @@index([creator_id])
  @@index([name, organization_id])
"""
    cols = _leftmost_indexed_columns(body)
    assert cols == {"creator_id", "name"}
    assert "organization_id" not in cols


def test_model_has_column_matches_field_decl_only():
    body = """
  id          String @id
  creator_id  String
  // creator_id appears in this comment but should not match
"""
    assert _model_has_column(body, "creator_id")
    assert not _model_has_column(body, "assignee_id")


# ---------------------------------------------------------------------------
# validate_prisma_indexes — happy path
# ---------------------------------------------------------------------------

def test_validate_passes_when_required_indexes_present(tmp_path):
    text = """
model thing {
  id          String @id
  creator_id  String
  assignee_id String?
  @@index([creator_id])
  @@index([assignee_id])
}
"""
    path = _write(tmp_path, text)
    validate_prisma_indexes(path)  # must not raise


def test_validate_passes_when_model_has_no_required_columns(tmp_path):
    text = """
model only_id {
  id String @id
  name String
}
"""
    path = _write(tmp_path, text)
    validate_prisma_indexes(path)


def test_validate_accepts_composite_with_required_first(tmp_path):
    text = """
model thing {
  id              String @id
  organization_id String
  name            String
  @@index([organization_id, name])
}
"""
    path = _write(tmp_path, text)
    validate_prisma_indexes(path)


# ---------------------------------------------------------------------------
# validate_prisma_indexes — failure cases
# ---------------------------------------------------------------------------

def test_validate_rejects_missing_creator_id_index(tmp_path):
    text = """
model thing {
  id         String @id
  creator_id String
}
"""
    path = _write(tmp_path, text)
    with pytest.raises(SchemaValidationError) as exc:
        validate_prisma_indexes(path)
    assert "thing" in str(exc.value)
    assert "creator_id" in str(exc.value)


def test_validate_rejects_composite_with_required_not_leftmost(tmp_path):
    text = """
model thing {
  id              String @id
  organization_id String
  name            String
  @@index([name, organization_id])
}
"""
    path = _write(tmp_path, text)
    with pytest.raises(SchemaValidationError) as exc:
        validate_prisma_indexes(path)
    assert "organization_id" in str(exc.value)


def test_validate_collects_all_errors_in_one_run(tmp_path):
    text = """
model a {
  id         String @id
  creator_id String
}

model b {
  id         String @id
  creator_id String
  assignee_id String
}
"""
    path = _write(tmp_path, text)
    with pytest.raises(SchemaValidationError) as exc:
        validate_prisma_indexes(path)
    msg = str(exc.value)
    # Three missing indexes total: a.creator_id, b.creator_id, b.assignee_id
    assert msg.count("missing required @@index") == 3


def test_validate_errors_when_file_missing(tmp_path):
    missing = tmp_path / "does-not-exist.prisma"
    with pytest.raises(SchemaValidationError) as exc:
        validate_prisma_indexes(missing)
    assert "not found" in str(exc.value)
