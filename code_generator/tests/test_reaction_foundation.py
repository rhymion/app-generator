"""
Tests for the comment reaction foundation layer (subtask_132a / subtask_132a2).

Covers:
  - extract_entities: x-internal entities are excluded (2 tests)
  - validate_schema:  valid reaction accepted, malformed x-internal/enum rejected (4 tests)
  - build_context:    comment includes contain reactions (3 tests)
  - extract_named_constants: correct value/label mapping for x-internal integer enums (2 tests)
  - reaction_constants template: rendered TS contains export const (2 tests)  [B1]
  - build_context named_constants: key present in context (2 tests)            [B1]
  - build_context reaction_batch_query: key present for comment entities (3 tests) [B2]
"""
import pytest
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from generate_types import extract_entities, extract_named_constants
from validate import validate_schema, SchemaValidationError


# ---------------------------------------------------------------------------
# Shared schema fixtures
# ---------------------------------------------------------------------------

def _cuid_field() -> dict:
    return {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}


def _fk_field(target: str, label: str = "name") -> dict:
    return {
        "type": "string",
        "pattern": "^c[a-z0-9]{24,}$",
        "x-relationship": {"type": "many-to-one", "target": target, "labelField": label},
    }


def _reaction_defn() -> dict:
    """Minimal valid reaction definition with x-internal."""
    return {
        "type": "object",
        "required": ["id", "comment_id", "user_id", "type"],
        "x-internal": {"page": False, "embed": False, "api": "custom"},
        "properties": {
            "id": _cuid_field(),
            "comment_id": _fk_field("comment", label="id"),
            "user_id": _fk_field("user", label="name"),
            "type": {
                "type": "integer",
                "minimum": 0,
                "maximum": 4,
                "enum": ["Like", "Celebrate", "Insightful", "Helpful", "Confused"],
            },
        },
    }


def _user_defn() -> dict:
    return {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
            "id": _cuid_field(),
            "name": {"type": "string"},
        },
    }


def _comment_defn() -> dict:
    return {
        "type": "object",
        "required": ["id", "message"],
        "properties": {
            "id": _cuid_field(),
            "message": {"type": "string", "minLength": 1},
        },
    }


def _parent_with_comment_child_schema() -> dict:
    """Schema with a parent entity that has a direct 'comments' x-outputType child."""
    return {
        "definitions": {
            "user": _user_defn(),
            "comment": _comment_defn(),
            "reaction": _reaction_defn(),
            "__parent": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": _cuid_field(),
                    "name": {"type": "string"},
                },
            },
            "parent": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": False, "test": False,
                },
                "allOf": [
                    {"$ref": "#/definitions/__parent"},
                    {"type": "object", "properties": {
                        "comments": {
                            "type": "array",
                            "x-outputType": "comments",
                            "items": {"$ref": "#/definitions/comment"},
                        }
                    }},
                ],
            },
        }
    }


# ---------------------------------------------------------------------------
# 1. extract_entities: x-internal entities are excluded
# ---------------------------------------------------------------------------

class TestXInternalExcludedFromExtractEntities:
    def test_x_internal_entity_not_in_page_entities(self):
        """reaction (x-internal) must NOT appear in extract_entities output."""
        schema = {
            "definitions": {
                "user": _user_defn(),
                "__comment": _comment_defn(),
                "reaction": _reaction_defn(),
                "comment": {
                    "x-generate": {
                        "list": True, "view": True, "new": True, "edit": True,
                        "delete": True, "api": False, "test": False,
                    },
                    "allOf": [{"$ref": "#/definitions/__comment"}],
                },
            }
        }
        entities = extract_entities(schema)
        models = {e["model"] for e in entities}
        assert "reaction" not in models

    def test_x_internal_entity_excluded_while_others_included(self):
        """Non-internal entities are still included when reaction is present."""
        schema = {
            "definitions": {
                "user": _user_defn(),
                "__comment": _comment_defn(),
                "reaction": _reaction_defn(),
                "comment": {
                    "x-generate": {
                        "list": True, "view": True, "new": True, "edit": True,
                        "delete": True, "api": False, "test": False,
                    },
                    "allOf": [{"$ref": "#/definitions/__comment"}],
                },
            }
        }
        entities = extract_entities(schema)
        models = {e["model"] for e in entities}
        assert "comment" in models
        assert "reaction" not in models


# ---------------------------------------------------------------------------
# 2. validate_schema: accepts valid reaction, rejects malformed x-internal/enum
# ---------------------------------------------------------------------------

class TestValidateSchemaXInternal:
    def _schema_with_reaction(self, reaction_override: dict = None) -> dict:
        """Build a schema containing reaction; apply overrides to reaction defn."""
        reaction = _reaction_defn()
        if reaction_override:
            reaction.update(reaction_override)
        return {
            "definitions": {
                "user": _user_defn(),
                "comment": _comment_defn(),
                "reaction": reaction,
            }
        }

    def test_valid_reaction_passes_validation(self):
        """A well-formed reaction entity with x-internal must not raise."""
        schema = self._schema_with_reaction()
        validate_schema(schema)  # should not raise

    def test_x_internal_missing_key_raises(self):
        """x-internal with a missing required key (embed) must raise."""
        schema = self._schema_with_reaction(
            reaction_override={"x-internal": {"page": False, "api": "custom"}}
            # 'embed' key missing
        )
        with pytest.raises(SchemaValidationError, match="x-internal is missing required key 'embed'"):
            validate_schema(schema)

    def test_x_internal_not_a_dict_raises(self):
        """x-internal must be a mapping; a scalar value must raise."""
        schema = self._schema_with_reaction(
            reaction_override={"x-internal": True}
        )
        with pytest.raises(SchemaValidationError, match="x-internal must be a mapping"):
            validate_schema(schema)

    def test_enum_count_mismatch_raises(self):
        """Enum label count not matching minimum/maximum range must raise."""
        reaction = _reaction_defn()
        # maximum=4 → range 0..4 = 5 values, but only 3 labels provided
        reaction["properties"]["type"]["enum"] = ["Like", "Celebrate", "Insightful"]
        schema = {"definitions": {"user": _user_defn(), "comment": _comment_defn(), "reaction": reaction}}
        with pytest.raises(SchemaValidationError, match="integer enum labels count"):
            validate_schema(schema)


# ---------------------------------------------------------------------------
# 3. build_context: comment includes contain reactions
# ---------------------------------------------------------------------------

class TestBuildContextCommentIncludeReactions:
    def _build(self, schema: dict, entity_name: str) -> dict:
        """Extract entity by name from schema and call build_context."""
        from build_context import build_context

        entities = extract_entities(schema)
        entity = next(e for e in entities if e["model"] == entity_name)
        return build_context(entity, schema)

    def test_direct_comment_child_include_contains_reactions(self):
        """include_props_detail contains 'reactions' when child has x-outputType: comments."""
        schema = _parent_with_comment_child_schema()
        ctx = self._build(schema, "parent")
        assert "reactions" in ctx["include_props_detail"]

    def test_direct_comment_child_include_has_user_id(self):
        """reactions include selects user_id for 'my reactions' state tracking."""
        schema = _parent_with_comment_child_schema()
        ctx = self._build(schema, "parent")
        assert "user_id" in ctx["include_props_detail"]

    def test_comment_children_detected(self):
        """comment_children is non-empty for an entity with a comments output_type child."""
        schema = _parent_with_comment_child_schema()
        ctx = self._build(schema, "parent")
        assert len(ctx["comment_children"]) > 0


# ---------------------------------------------------------------------------
# 4. extract_named_constants: correct value/label mapping
# ---------------------------------------------------------------------------

class TestExtractNamedConstants:
    def _schema_with_reaction(self) -> dict:
        return {
            "definitions": {
                "user": _user_defn(),
                "comment": _comment_defn(),
                "reaction": _reaction_defn(),
            }
        }

    def test_reaction_constants_const_name(self):
        """COMMENT_REACTION_TYPES is generated (parent prefix = 'comment')."""
        schema = self._schema_with_reaction()
        constants = extract_named_constants(schema)
        names = [c["const_name"] for c in constants]
        assert "COMMENT_REACTION_TYPES" in names

    def test_reaction_constants_value_label_mapping(self):
        """Items have correct zero-based integer values and string labels."""
        schema = self._schema_with_reaction()
        constants = extract_named_constants(schema)
        const = next(c for c in constants if c["const_name"] == "COMMENT_REACTION_TYPES")
        expected = [
            {"value": 0, "label": "Like"},
            {"value": 1, "label": "Celebrate"},
            {"value": 2, "label": "Insightful"},
            {"value": 3, "label": "Helpful"},
            {"value": 4, "label": "Confused"},
        ]
        assert const["items"] == expected


# ---------------------------------------------------------------------------
# 5. reaction_constants template: rendered TS output contains export const  [B1]
# ---------------------------------------------------------------------------

def _make_jinja_env() -> Environment:
    templates_dir = Path(__file__).parent.parent / "templates"
    env = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    from helpers.naming import to_pascal_case, to_camel_case
    env.filters["pascal_case"] = to_pascal_case
    env.filters["camel_case"] = to_camel_case
    return env


class TestReactionConstantsTemplate:
    def _render_constants(self, constants: list) -> str:
        env = _make_jinja_env()
        tmpl = env.get_template("reaction_constants.ts.jinja2")
        return tmpl.render(named_constants=constants)

    def test_rendered_ts_contains_export_const(self):
        """Template render must include 'export const COMMENT_REACTION_TYPES'."""
        schema = {
            "definitions": {
                "user": _user_defn(),
                "comment": _comment_defn(),
                "reaction": _reaction_defn(),
            }
        }
        constants = extract_named_constants(schema)
        output = self._render_constants(constants)
        assert "export const COMMENT_REACTION_TYPES" in output

    def test_rendered_ts_contains_type_export(self):
        """Template render must include 'export type COMMENT_REACTION_TYPE'."""
        schema = {
            "definitions": {
                "user": _user_defn(),
                "comment": _comment_defn(),
                "reaction": _reaction_defn(),
            }
        }
        constants = extract_named_constants(schema)
        output = self._render_constants(constants)
        assert "export type COMMENT_REACTION_TYPE" in output


# ---------------------------------------------------------------------------
# 6. build_context: named_constants key present in return dict  [B1]
# ---------------------------------------------------------------------------

class TestBuildContextNamedConstants:
    def _build(self, schema: dict, entity_name: str) -> dict:
        from build_context import build_context
        entities = extract_entities(schema)
        entity = next(e for e in entities if e["model"] == entity_name)
        return build_context(entity, schema)

    def test_named_constants_key_present_in_context(self):
        """build_context must return 'named_constants' key."""
        schema = _parent_with_comment_child_schema()
        # inject reaction into schema so extract_named_constants finds it
        schema["definitions"]["reaction"] = _reaction_defn()
        ctx = self._build(schema, "parent")
        assert "named_constants" in ctx

    def test_named_constants_contains_comment_reaction_types(self):
        """build_context['named_constants'] includes COMMENT_REACTION_TYPES constant."""
        schema = _parent_with_comment_child_schema()
        schema["definitions"]["reaction"] = _reaction_defn()
        ctx = self._build(schema, "parent")
        names = [c["const_name"] for c in ctx["named_constants"]]
        assert "COMMENT_REACTION_TYPES" in names


# ---------------------------------------------------------------------------
# 7. build_context: reaction_batch_query present for comment entities  [B2]
# ---------------------------------------------------------------------------

class TestBuildContextReactionBatchQuery:
    def _build(self, schema: dict, entity_name: str) -> dict:
        from build_context import build_context
        entities = extract_entities(schema)
        entity = next(e for e in entities if e["model"] == entity_name)
        return build_context(entity, schema)

    def test_reaction_batch_query_present_for_entity_with_comments(self):
        """build_context must include 'reaction_batch_query' when entity has comment children."""
        schema = _parent_with_comment_child_schema()
        schema["definitions"]["reaction"] = _reaction_defn()
        ctx = self._build(schema, "parent")
        assert "reaction_batch_query" in ctx
        assert ctx["reaction_batch_query"] is not None

    def test_reaction_batch_query_fn_name(self):
        """reaction_batch_query['fn_name'] must be 'getCommentReactions'."""
        schema = _parent_with_comment_child_schema()
        schema["definitions"]["reaction"] = _reaction_defn()
        ctx = self._build(schema, "parent")
        assert ctx["reaction_batch_query"]["fn_name"] == "getCommentReactions"

    def test_reaction_batch_query_none_for_entity_without_comments(self):
        """build_context['reaction_batch_query'] must be None for entities without comment children."""
        schema = {
            "definitions": {
                "user": _user_defn(),
                "__task": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": _cuid_field(),
                        "name": {"type": "string"},
                    },
                },
                "task": {
                    "x-generate": {
                        "list": True, "view": True, "new": True, "edit": True,
                        "delete": True, "api": False, "test": False,
                    },
                    "allOf": [{"$ref": "#/definitions/__task"}],
                },
            }
        }
        ctx = self._build(schema, "task")
        assert ctx.get("reaction_batch_query") is None
