"""Tests for the Prisma schema index validator in validate.py."""
from pathlib import Path

import pytest

from validate import (
    SchemaValidationError,
    validate_prisma_indexes,
    derive_ui_exposed_index_columns,
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


# ---------------------------------------------------------------------------
# derive_ui_exposed_index_columns — Issue #726
# ---------------------------------------------------------------------------

def test_derive_ui_columns_scalar_from_display_table_excludes_relation_and_virtual():
    # 'status' is a real scalar property -> candidate. 'owner' is a
    # relation display column (backed by owner_id) -> excluded, its FK
    # column is already covered by _relation_fk_columns. 'computed_label'
    # has no backing property at all (neither itself nor a '_id' sibling)
    # -> excluded, there is nothing to index.
    schema = {
        'definitions': {
            '__widget': {
                'properties': {
                    'status': {'type': 'string'},
                    'owner_id': {'type': 'string'},
                },
            },
            'widget': {
                'allOf': [{'$ref': '#/definitions/__widget'}],
                'x-display': {
                    'table': [{'status': {}}, {'owner': {}}, {'computed_label': {}}],
                },
            },
        },
    }
    assert derive_ui_exposed_index_columns(schema) == {'widget': {'status'}}


def test_derive_ui_columns_bare_list_x_display_shorthand():
    # x-display may itself be a bare list (older shorthand), not a dict
    # with a 'table' key -- _x_display_table_items() must handle both.
    schema = {
        'definitions': {
            '__widget': {'properties': {'status': {'type': 'string'}}},
            'widget': {
                'allOf': [{'$ref': '#/definitions/__widget'}],
                'x-display': [{'status': {}}],
            },
        },
    }
    assert derive_ui_exposed_index_columns(schema) == {'widget': {'status'}}


def test_derive_ui_columns_from_x_filter_values():
    schema = {
        'definitions': {
            '__gadget': {'properties': {'kind': {'type': 'string'}}},
            'gadget': {'allOf': [{'$ref': '#/definitions/__gadget'}]},
            'gadget_view': {
                'allOf': [{'$ref': '#/definitions/__gadget'}],
                'x-filter-values': {'kind': ['a', 'b']},
            },
        },
    }
    assert derive_ui_exposed_index_columns(schema) == {'gadget': {'kind'}}


def test_derive_ui_columns_aggregates_across_views_of_same_model():
    # Two distinct views of the same raw entity, one contributing a
    # display-table column, the other a filter_values column -- both must
    # attribute their requirement to the SAME backing model.
    schema = {
        'definitions': {
            '__gadget': {
                'properties': {
                    'kind': {'type': 'string'},
                    'status': {'type': 'string'},
                },
            },
            'gadget': {
                'allOf': [{'$ref': '#/definitions/__gadget'}],
                'x-display': {'table': [{'status': {}}]},
            },
            'gadget_view': {
                'allOf': [{'$ref': '#/definitions/__gadget'}],
                'x-filter-values': {'kind': ['a']},
            },
        },
    }
    assert derive_ui_exposed_index_columns(schema) == {'gadget': {'kind', 'status'}}


def test_derive_ui_columns_resolves_proxy_view_to_backing_model():
    # A proxy view (e.g. 'setting' -> 'user') carries its own x-display but
    # has no Prisma model of its own -- the requirement must attribute to
    # the real backing model ('user'), not the view's own key ('setting').
    schema = {
        'definitions': {
            '__user': {'properties': {'nickname': {'type': 'string'}}},
            'user': {'allOf': [{'$ref': '#/definitions/__user'}]},
            'setting': {
                'allOf': [{'$ref': '#/definitions/__user'}],
                'x-display': {'table': [{'nickname': {}}]},
            },
        },
    }
    assert derive_ui_exposed_index_columns(schema) == {'user': {'nickname'}}


def test_derive_ui_columns_ignores_entities_with_neither_source():
    schema = {
        'definitions': {
            '__widget': {'properties': {'status': {'type': 'string'}}},
            'widget': {'allOf': [{'$ref': '#/definitions/__widget'}]},
        },
    }
    assert derive_ui_exposed_index_columns(schema) == {}


# ---------------------------------------------------------------------------
# validate_prisma_indexes — Issue #726 UI-derived enforcement (schema arg)
# ---------------------------------------------------------------------------

_UI_SCHEMA = {
    'definitions': {
        '__widget': {'properties': {'status': {'type': 'string'}}},
        'widget': {
            'allOf': [{'$ref': '#/definitions/__widget'}],
            'x-display': {'table': [{'status': {}}]},
        },
    },
}


def test_validate_rejects_missing_ui_derived_index_when_schema_given(tmp_path):
    text = """
model widget {
  id     String @id
  status String
}
"""
    path = _write(tmp_path, text)
    with pytest.raises(SchemaValidationError) as exc:
        validate_prisma_indexes(path, _UI_SCHEMA)
    msg = str(exc.value)
    assert "status" in msg
    assert "726" in msg


def test_validate_passes_when_ui_derived_index_present(tmp_path):
    text = """
model widget {
  id     String @id
  status String
  @@index([status])
}
"""
    path = _write(tmp_path, text)
    validate_prisma_indexes(path, _UI_SCHEMA)  # must not raise


def test_validate_skips_ui_derived_check_when_no_schema_given(tmp_path):
    # Backward compatibility: callers with no JSON-schema context (e.g. a
    # bare .prisma file check) must not be forced to satisfy a rule they
    # have no way to derive.
    text = """
model widget {
  id     String @id
  status String
}
"""
    path = _write(tmp_path, text)
    validate_prisma_indexes(path)  # no schema arg -> must not raise
