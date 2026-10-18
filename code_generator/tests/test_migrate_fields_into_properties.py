"""Tests for migrate_fields_into_properties.py (fields: -> properties:, allOf proxy -> x-view-of)."""
import io
import textwrap
from pathlib import Path

import pytest

import migrate_fields_into_properties as mig
from build_user_schema import _make_yaml
from schema_deriver import parse_prisma_schema

CODE_GENERATOR = Path(__file__).parent.parent
PRISMA_SCHEMA_PATH = CODE_GENERATOR.parent / "prisma" / "schema.prisma"
DEFAULT_SCHEMA_PATH = CODE_GENERATOR / "json_schema.yaml"


@pytest.fixture(scope="module")
def models():
    return parse_prisma_schema(PRISMA_SCHEMA_PATH)


def _load(text):
    return _make_yaml().load(textwrap.dedent(text))


def _dump(schema):
    buf = io.StringIO()
    _make_yaml().dump(schema, buf)
    return buf.getvalue()


def _codes(findings):
    return {(f.code, f.entity, f.name) for f in findings}


def test_fields_move_to_front_of_properties_in_original_order(models):
    schema = _load(
        """
        definitions:
          user:
            x-generate: {list: true}
            fields:
              name: {x-pii: direct}
              email: {}
            properties:
              roles: {type: array, items: {$ref: "#/definitions/role"}}
        """
    )
    mig.migrate_schema(schema, models)
    entity = schema["definitions"]["user"]
    assert "fields" not in entity
    assert list(entity) == ["x-generate", "properties"]
    assert list(entity["properties"]) == ["name", "email", "roles"]
    assert entity["properties"]["name"]["x-pii"] == "direct"


def test_fields_only_entity_becomes_properties_in_place(models):
    schema = _load(
        """
        definitions:
          role:
            fields:
              name: {}
            x-generate: {list: true}
        """
    )
    mig.migrate_schema(schema, models)
    assert list(schema["definitions"]["role"]) == ["properties", "x-generate"]


def test_properties_before_fields_keeps_earlier_position(models):
    schema = _load(
        """
        definitions:
          user:
            properties:
              roles: {type: array, items: {$ref: "#/definitions/role"}}
            x-generate: {list: true}
            fields:
              name: {}
        """
    )
    mig.migrate_schema(schema, models)
    entity = schema["definitions"]["user"]
    assert list(entity) == ["properties", "x-generate"]
    assert list(entity["properties"]) == ["name", "roles"]


def test_x_trigram_filter_is_carried_with_its_column(models):
    schema = _load(
        """
        definitions:
          user:
            fields:
              name:
                x-trigram-filter: {threshold: 0.3}
        """
    )
    mig.migrate_schema(schema, models)
    assert schema["definitions"]["user"]["properties"]["name"]["x-trigram-filter"] == {"threshold": 0.3}


def test_same_named_keys_elsewhere_are_not_touched(models):
    schema = _load(
        """
        definitions:
          user:
            x-generate:
              fields: [name, email]
            x-search:
              text_fields: [name]
            fields:
              name: {}
        """
    )
    mig.migrate_schema(schema, models)
    entity = schema["definitions"]["user"]
    assert list(entity["x-generate"]["fields"]) == ["name", "email"]
    assert list(entity["x-search"]["text_fields"]) == ["name"]


def test_allof_proxy_becomes_x_view_of(models):
    schema = _load(
        """
        definitions:
          setting:
            x-self-only: {admin_bypass: true}
            allOf:
              - $ref: "#/definitions/user"
              - type: object
                required: [roles]
                properties:
                  roles: {type: array, items: {$ref: "#/definitions/role"}}
        """
    )
    findings = mig.migrate_schema(schema, models)
    assert findings == []
    entity = schema["definitions"]["setting"]
    assert "allOf" not in entity
    assert list(entity) == ["x-self-only", "x-view-of", "required", "properties"]
    assert entity["x-view-of"] == "user"
    assert list(entity["required"]) == ["roles"]
    assert list(entity["properties"]) == ["roles"]


def test_allof_proxy_without_second_branch(models):
    schema = _load(
        """
        definitions:
          setting:
            allOf:
              - $ref: "#/definitions/user"
        """
    )
    mig.migrate_schema(schema, models)
    assert dict(schema["definitions"]["setting"]) == {"x-view-of": "user"}


def test_second_branch_with_other_keys_is_blocked_and_untouched(models):
    schema = _load(
        """
        definitions:
          setting:
            allOf:
              - $ref: "#/definitions/user"
              - type: object
                description: extra
        """
    )
    before = _dump(schema)
    findings = mig.migrate_schema(schema, models)
    assert [f.code for f in findings] == [mig.ALLOF_UNSUPPORTED_SHAPE]
    assert findings[0].blocking
    assert _dump(schema) == before


def test_allof_on_prisma_model_name_is_blocked(models):
    schema = _load(
        """
        definitions:
          user:
            allOf:
              - $ref: "#/definitions/role"
        """
    )
    before = _dump(schema)
    findings = mig.migrate_schema(schema, models)
    assert _codes(findings) == {(mig.ALLOF_ON_MODEL, "user", "")}
    assert _dump(schema) == before


def test_name_in_both_fields_and_properties_is_blocked(models):
    schema = _load(
        """
        definitions:
          user:
            fields:
              roles: {}
            properties:
              roles: {type: array}
        """
    )
    findings = mig.migrate_schema(schema, models)
    assert (mig.FIELDS_PROPERTIES_COLLISION, "user", "roles") in _codes(findings)
    assert "fields" in schema["definitions"]["user"]


def test_dry_run_reports_what_was_silently_ignored(models):
    schema = _load(
        """
        definitions:
          user:
            fields:
              name: {}
              no_such_column: {}
            properties:
              roles: {type: array, items: {$ref: "#/definitions/role"}}
              ghost: {type: string}
              email: {}
          not_a_model:
            x-generate: {list: true}
          setting:
            allOf:
              - $ref: "#/definitions/user"
              - type: object
                properties:
                  email: {}
                  roles: {type: array}
                  ghost2: {}
        """
    )
    found = _codes(mig.inspect_schema(schema, models))
    assert (mig.FIELD_ABSENT_FROM_PRISMA, "user", "no_such_column") in found
    assert (mig.PROPERTY_ABSENT_FROM_PRISMA, "user", "ghost") in found
    assert (mig.PROPERTY_IS_SCALAR, "user", "email") in found
    assert (mig.ORPHAN_ENTITY, "not_a_model", "") in found
    assert (mig.PROXY_SCALAR_PROPERTY, "setting", "email") in found
    assert (mig.PROPERTY_ABSENT_FROM_PRISMA, "setting", "ghost2") in found
    assert (mig.PROPERTY_ABSENT_FROM_PRISMA, "user", "roles") not in found


def test_relation_in_fields_is_reported(models):
    schema = _load(
        """
        definitions:
          user:
            fields:
              roles: {}
        """
    )
    assert (mig.FIELD_IS_RELATION, "user", "roles") in _codes(mig.inspect_schema(schema, models))


def test_back_relation_list_is_treated_as_relation(models):
    user_lists = [
        name for name, f in models["user"].fields.items() if f.is_list and not f.is_relation_object and f.prisma_type in models
    ]
    if not user_lists:
        pytest.skip("no back-relation list on user in this Prisma schema")
    schema = {"definitions": {"user": {"properties": {user_lists[0]: {"type": "array"}}}}}
    assert mig.PROPERTY_IS_SCALAR not in {f.code for f in mig.inspect_schema(schema, models)}


def test_migration_is_idempotent(models):
    schema = _load(
        """
        definitions:
          user:
            fields:
              name: {}
          setting:
            allOf:
              - $ref: "#/definitions/user"
        """
    )
    mig.migrate_schema(schema, models)
    once = _dump(schema)
    mig.migrate_schema(schema, models)
    assert _dump(schema) == once


def test_comments_survive_the_rewrite(models):
    schema = _load(
        """
        definitions:
          user:
            fields:
              # the display name
              name: {}
              email: {}  # contact address
            x-generate: {list: true}
        """
    )
    mig.migrate_schema(schema, models)
    out = _dump(schema)
    assert "# the display name" in out
    assert "# contact address" in out


def test_default_schema_has_no_findings_and_migrates_cleanly(models):
    schema = _make_yaml().load(DEFAULT_SCHEMA_PATH.read_text(encoding="utf-8"))
    findings = mig.migrate_schema(schema, models)
    assert not [f for f in findings if f.blocking]
    for entity in schema["definitions"].values():
        assert "fields" not in entity and "allOf" not in entity
    assert schema["definitions"]["setting"]["x-view-of"] == "user"


def test_unchanged_schema_round_trips_byte_for_byte(models):
    text = DEFAULT_SCHEMA_PATH.read_text(encoding="utf-8")
    assert _dump(_make_yaml().load(text)) == text


def test_cli_dry_run_does_not_write_and_in_place_does(tmp_path, capsys):
    schema_path = tmp_path / "json_schema.yaml"
    schema_path.write_text("definitions:\n  role:\n    fields:\n      name: {}\n", encoding="utf-8")
    original = schema_path.read_text(encoding="utf-8")

    assert mig.main([str(schema_path), "--prisma", str(PRISMA_SCHEMA_PATH)]) == 0
    assert schema_path.read_text(encoding="utf-8") == original

    assert mig.main([str(schema_path), "--prisma", str(PRISMA_SCHEMA_PATH), "--in-place"]) == 0
    assert "fields:" not in schema_path.read_text(encoding="utf-8")
    assert "properties:" in schema_path.read_text(encoding="utf-8")


def test_cli_refuses_to_write_when_blocked(tmp_path, capsys):
    schema_path = tmp_path / "json_schema.yaml"
    schema_path.write_text(
        "definitions:\n  user:\n    allOf:\n      - $ref: '#/definitions/role'\n", encoding="utf-8"
    )
    original = schema_path.read_text(encoding="utf-8")
    assert mig.main([str(schema_path), "--prisma", str(PRISMA_SCHEMA_PATH), "--in-place"]) == 1
    assert schema_path.read_text(encoding="utf-8") == original
