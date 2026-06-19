"""
Tests for the three generator defects fixed in subtask_154a.

Defect 1 (labelField ignored): embedded non-independent list children must
  use the labelField from x-relationships, not hardcode `f.name`.

Defect 2 (integer enum as labelField): when a FK's labelField resolves to an
  integer/number field, the generated expression must produce a string (not a
  raw number) so TS type-checks pass.

Defect 3 (transitive import missing): when a non-independent child's type is
  declared inline in a parent's types.ts, the child's FK targets must appear
  in the parent's import_targets.
"""
import pytest
from build_context import build_context
from generators import form_upsert_context
from context import build_entity_context
from helpers.label_field import build_label_expression, resolve_label_paths


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _entity(model: str, children: list = None) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": children or [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }


def _child_entry(name: str, prop: str, output_type: str = None, relationship: dict = None) -> dict:
    return {
        "name": name,
        "property_name": prop,
        "output_type": output_type,
        "file_type": None,
        "relationship": relationship,
    }


# ===========================================================================
# Defect 1: labelField ignored in embedded non-independent list children
# ===========================================================================

class TestLabelFieldEmbeddedListChild:
    """
    When an entity has a non-independent, non-m2m mandatory-FK list child
    (e.g. sub_account under user) and x-relationships declares labelField:
    nickname, the FormUpsert child setup must use `f.nickname` / the resolved
    label expression — not the hardcoded `f.name`.
    """

    def _schema(self) -> dict:
        return {
            "definitions": {
                "user": {
                    "type": "object",
                    "required": ["id", "username"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "username": {"type": "string"},
                    },
                },
                "user_detail": {
                    "x-generate": {
                        "list": True, "view": True, "new": True,
                        "edit": True, "delete": True, "api": False,
                    },
                    "allOf": [
                        {"$ref": "#/definitions/user"},
                        {
                            "type": "object",
                            "properties": {
                                "sub_accounts": {
                                    "type": "array",
                                    "items": {"$ref": "#/definitions/sub_account"},
                                    "x-outputType": "list",
                                    "x-relationships": {
                                        "type": "one-to-many",
                                        "target": "sub_account",
                                        "labelField": "nickname",
                                    },
                                },
                            },
                        },
                    ],
                },
                # sub_account has NO _detail with x-generate → non-independent
                "sub_account": {
                    "type": "object",
                    "required": ["id", "parent_user_id", "nickname"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "parent_user_id": {
                            "type": "string",
                            "x-relationship": {"type": "many-to-one", "target": "user"},
                        },
                        "nickname": {"type": "string"},
                    },
                },
            },
        }

    def _ctx(self) -> dict:
        schema = self._schema()
        entity = _entity("user", children=[
            _child_entry(
                "sub_account",
                "sub_accounts",
                output_type="list",
                relationship={
                    "type": "one-to-many",
                    "target": "sub_account",
                    "label_field": "nickname",
                },
            ),
        ])
        ctx = build_context(entity, schema)
        return form_upsert_context(ctx, schema)

    def test_embedded_list_uses_label_field_not_name(self):
        """child_grid_setup must reference `nickname`, not `name`."""
        ctx = self._ctx()
        setup = ctx["child_grid_setup"]
        assert "f.nickname" in setup or "nickname" in setup, (
            f"Expected 'nickname' in child_grid_setup, got:\n{setup}"
        )

    def test_embedded_list_does_not_use_hardcoded_name(self):
        """child_grid_setup must NOT reference `f.name` when labelField is nickname."""
        ctx = self._ctx()
        setup = ctx["child_grid_setup"]
        assert "f.name" not in setup, (
            f"child_grid_setup must not hardcode `f.name` when labelField=nickname:\n{setup}"
        )


# ===========================================================================
# Defect 2: integer enum field used as labelField must produce a string
# ===========================================================================

class TestIntegerEnumLabelField:
    """
    When a FK relationship's labelField points to an integer/number field on
    the target (e.g. subscription.tier which is type:integer with enum), the generated
    label expression must yield a string — not a raw number.
    """

    def _schema_with_integer_enum_label(self) -> dict:
        return {
            "definitions": {
                "subscription": {
                    "type": "object",
                    "required": ["id", "tier"],
                    "properties": {
                        "id": {"type": "string"},
                        "tier": {
                            "type": "integer",
                            "enum": ["free", "premium", "vip"],
                        },
                    },
                },
            },
        }

    def _schema_with_integer_numeric_enum(self) -> dict:
        """Integer field with numeric-only enum — no string labels, must use String()."""
        return {
            "definitions": {
                "subscription": {
                    "type": "object",
                    "required": ["id", "tier"],
                    "properties": {
                        "id": {"type": "string"},
                        "tier": {
                            "type": "integer",
                            "enum": [0, 1, 2],
                        },
                    },
                },
            },
        }

    def test_resolve_label_paths_detects_integer_field(self):
        """resolve_label_paths marks integer final field with final_is_number=True and captures string enum labels."""
        schema = self._schema_with_integer_enum_label()
        paths = resolve_label_paths("tier", "subscription", schema)
        assert len(paths) == 1
        assert paths[0]["final_is_number"] is True
        assert paths[0]["final_enum_labels"] == ["free", "premium", "vip"]

    def test_resolve_label_paths_string_field_is_not_number(self):
        """Non-integer fields have final_is_number=False."""
        schema = {
            "definitions": {
                "entity": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                },
            },
        }
        paths = resolve_label_paths("name", "entity", schema)
        assert paths[0]["final_is_number"] is False

    def test_build_label_expression_integer_enum_uses_lookup(self):
        """build_label_expression for integer enum labelField uses array lookup, not String()."""
        schema = self._schema_with_integer_enum_label()
        built = build_label_expression("item", "tier", "subscription", schema)
        expr = built["expression"]
        # Must use array index lookup with the enum labels
        assert "'free'" in expr and "'premium'" in expr and "'vip'" in expr, (
            f"Integer enum labelField must embed string labels in lookup expression: {expr}"
        )
        assert "String" not in expr, (
            f"Integer enum labelField must not fall back to String() when labels are present: {expr}"
        )
        # Example expected form: (['free','premium','vip'][item.tier] ?? '')
        assert "item.tier" in expr, (
            f"Expression must reference item.tier: {expr}"
        )

    def test_build_label_expression_integer_enum_null_safety(self):
        """Lookup expression uses ?? '' so undefined/null index yields empty string."""
        schema = self._schema_with_integer_enum_label()
        built = build_label_expression("item", "tier", "subscription", schema)
        expr = built["expression"]
        assert "?? ''" in expr, (
            f"Integer enum lookup must include ?? '' null guard: {expr}"
        )

    def test_build_label_expression_integer_no_labels_uses_string(self):
        """Integer enum without string labels (numeric-only) falls back to String() guard."""
        schema = self._schema_with_integer_numeric_enum()
        built = build_label_expression("item", "tier", "subscription", schema)
        expr = built["expression"]
        assert "String" in expr, (
            f"Integer enum without string labels must use String() conversion: {expr}"
        )
        assert "!= null" in expr, (
            f"String() guard must use != null so 0 is not treated as falsy: {expr}"
        )

    def test_nullable_integer_field_is_also_detected(self):
        """Nullable integer fields (type: [integer, null]) are also detected."""
        schema = {
            "definitions": {
                "subscription": {
                    "type": "object",
                    "properties": {
                        "tier": {"type": ["integer", "null"], "enum": [0, 1, 2]},
                    },
                },
            },
        }
        paths = resolve_label_paths("tier", "subscription", schema)
        assert paths[0]["final_is_number"] is True

    def test_number_type_also_detected(self):
        """Fields with type:number (float) are also treated as final_is_number."""
        schema = {
            "definitions": {
                "metric": {
                    "type": "object",
                    "properties": {
                        "score": {"type": "number"},
                    },
                },
            },
        }
        paths = resolve_label_paths("score", "metric", schema)
        assert paths[0]["final_is_number"] is True


# ===========================================================================
# Defect 3: transitive import — inline-declared child FK targets must be imported
# ===========================================================================

class TestTransitiveImport:
    """
    When a non-independent m2m list child's type is declared inline in the
    parent's types.ts, that child's FK targets must be added to import_targets
    so types.ts emits the correct `import type { ... }` statements.

    Scenario:
      author has m2m children books (book) and reviews (review).
      book has FK to publisher.
      review has FK to publisher.
      book and review are non-independent (no _detail with x-generate).
      → publisher must appear in import_targets for author.
    """

    def _schema(self) -> dict:
        return {
            "definitions": {
                "publisher": {
                    "type": "object",
                    "required": ["id", "title"],
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
                    },
                },
                # book: non-independent (no book_detail)
                "book": {
                    "type": "object",
                    "required": ["id", "name", "publisher_id"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "publisher_id": {
                            "type": "string",
                            "x-relationship": {
                                "type": "many-to-one",
                                "target": "publisher",
                                "labelField": "title",
                            },
                        },
                    },
                },
                "author": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                    },
                },
                "author_detail": {
                    "x-generate": {
                        "list": True, "view": True, "new": True,
                        "edit": True, "delete": True, "api": False,
                    },
                    "allOf": [
                        {"$ref": "#/definitions/author"},
                        {
                            "type": "object",
                            "properties": {
                                "books": {
                                    "type": "array",
                                    "items": {"$ref": "#/definitions/book"},
                                    "x-outputType": "list",
                                },
                            },
                        },
                    ],
                },
            },
        }

    def _ec(self) -> object:
        schema = self._schema()
        entity = _entity("author", children=[
            _child_entry("book", "books", output_type="list"),
        ])
        return build_entity_context(entity, schema)

    def test_inline_child_fk_target_in_import_targets(self):
        """publisher must be in import_targets when book is declared inline."""
        ec = self._ec()
        assert "publisher" in ec.import_targets, (
            f"'publisher' must be in import_targets when book (which has FK to publisher) "
            f"is declared inline. import_targets={ec.import_targets}"
        )

    def test_import_targets_does_not_contain_model_itself(self):
        """author must not import itself."""
        ec = self._ec()
        assert "author" not in ec.import_targets

    def test_independent_child_fk_target_not_duplicated(self):
        """When publisher has its own module and is already in import_targets, no duplicate."""
        schema = {
            **self._schema(),
            "definitions": {
                **self._schema()["definitions"],
                "publisher_detail": {
                    "x-generate": {"list": True, "view": True},
                    "allOf": [{"$ref": "#/definitions/publisher"}],
                },
            },
        }
        entity = _entity("author", children=[
            _child_entry("book", "books", output_type="list"),
        ])
        ec = build_entity_context(entity, schema)
        count = ec.import_targets.count("publisher")
        assert count <= 1, f"'publisher' must not appear more than once in import_targets: {ec.import_targets}"
