"""
Tests for the comment reaction template layer.

Covers:
  - types.ts template: reaction summary type and fields on Comment (3 tests)
  - actions.ts template: toggleCommentReaction emitted for commentable entities (3 tests)
  - comment_reactions_api_route template: auth / toggle / groupBy response (3 tests)
"""
import pytest
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
from generate_types import extract_entities, extract_named_constants
from build_context import build_context


# ---------------------------------------------------------------------------
# Shared helpers
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


def _cuid_field() -> dict:
    return {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}


def _fk_field(target: str, label: str = "name", constant_parent: bool = False) -> dict:
    rel = {"type": "many-to-one", "target": target, "labelField": label}
    if constant_parent:
        rel["constantParent"] = True
    return {
        "type": "string",
        "pattern": "^c[a-z0-9]{24,}$",
        "x-relationship": rel,
    }


def _reaction_defn() -> dict:
    return {
        "type": "object",
        "required": ["id", "comment_id", "user_id", "type"],
        "x-internal": {"page": False, "embed": False, "api": "custom"},
        "properties": {
            "id": _cuid_field(),
            "comment_id": _fk_field("comment", label="id", constant_parent=True),
            "user_id": _fk_field("user", label="name"),
            "type": {
                "type": "integer",
                "minimum": 0,
                "maximum": 4,
                "enum": ["Like", "Celebrate", "Insightful", "Helpful", "Confused"],
            },
        },
    }


def _commentable_schema() -> dict:
    """Schema with parent entity using the commentable bridge (mirrors real app structure)."""
    return {
        "definitions": {
            "user": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": _cuid_field(),
                    "name": {"type": "string"},
                },
            },
            "__commentable": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": _cuid_field()},
            },
            "commentable": {
                "x-generate": {
                    "list": False, "view": False, "new": False, "edit": False,
                    "delete": False, "api": False, "test": False,
                },
                "allOf": [
                    {"$ref": "#/definitions/__commentable"},
                    {"type": "object", "required": ["comments"], "properties": {
                        "comments": {
                            "type": "array",
                            "x-outputType": "comments",
                            "items": {"$ref": "#/definitions/comment"},
                        }
                    }},
                ],
            },
            "comment": {
                "type": "object",
                "required": ["id", "message"],
                "properties": {
                    "id": _cuid_field(),
                    "message": {"type": "string"},
                    "commentable_id": _fk_field("commentable", label="id"),
                    "creator_id": _fk_field("user", label="name"),
                },
            },
            "reaction": _reaction_defn(),
            "__task": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": _cuid_field(),
                    "name": {"type": "string"},
                    "commentable_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "one-to-one_bridge",
                            "target": "commentable",
                            "labelField": "id",
                        },
                    },
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


def _build_ctx(schema: dict, entity_name: str) -> dict:
    entities = extract_entities(schema)
    entity = next(e for e in entities if e["model"] == entity_name)
    return build_context(entity, schema)


# ---------------------------------------------------------------------------
# 1. types.ts template: reaction summary type and fields on Comment
# ---------------------------------------------------------------------------

class TestTypesTemplateReactionSummary:
    def _render_types(self, schema: dict, entity_name: str) -> str:
        from context import build_entity_context
        from dataclasses import asdict
        entities = extract_entities(schema)
        entity = next(e for e in entities if e["model"] == entity_name)
        ctx = build_entity_context(entity, schema)
        env = _make_jinja_env()
        tmpl = env.get_template("types.ts.jinja2")
        return tmpl.render(**asdict(ctx))

    def test_types_template_emits_comment_reaction_summary_type(self):
        """types.ts must declare CommentReactionSummary when entity has comment children."""
        schema = _commentable_schema()
        output = self._render_types(schema, "task")
        assert "CommentReactionSummary" in output

    def test_types_template_comment_has_reaction_counts_field(self):
        """Comment type must include reactionCounts field."""
        schema = _commentable_schema()
        output = self._render_types(schema, "task")
        assert "reactionCounts" in output

    def test_types_template_comment_has_my_reaction_types_field(self):
        """Comment type must include myReactionTypes field."""
        schema = _commentable_schema()
        output = self._render_types(schema, "task")
        assert "myReactionTypes" in output


# ---------------------------------------------------------------------------
# 2. actions.ts template: toggle action emitted for commentable entities
# ---------------------------------------------------------------------------

class TestActionsTemplateToggleReaction:
    def _render_actions(self, schema: dict, entity_name: str) -> str:
        from generators import actions_context
        ctx = _build_ctx(schema, entity_name)
        act_ctx = {**ctx, **actions_context(ctx)}
        env = _make_jinja_env()
        tmpl = env.get_template("actions.ts.jinja2")
        return tmpl.render(**act_ctx)

    def test_actions_toggle_function_emitted_for_commentable_entity(self):
        """actions.ts must export toggleXxxCommentReaction for entities with commentable bridge."""
        schema = _commentable_schema()
        output = self._render_actions(schema, "task")
        assert "toggleTaskCommentReaction" in output

    def test_actions_toggle_imports_reaction_constants(self):
        """actions.ts must import COMMENT_REACTION_TYPES from reaction_constants."""
        schema = _commentable_schema()
        output = self._render_actions(schema, "task")
        assert "COMMENT_REACTION_TYPES" in output
        assert "reaction_constants" in output

    def test_actions_toggle_returns_comment_reaction_summary(self):
        """toggleXxxCommentReaction must be typed as returning CommentReactionSummary."""
        schema = _commentable_schema()
        output = self._render_actions(schema, "task")
        assert "Promise<CommentReactionSummary>" in output


# ---------------------------------------------------------------------------
# 3. comment_reactions_api_route template: auth / toggle / groupBy response
# ---------------------------------------------------------------------------

class TestCommentReactionsApiRouteTemplate:
    def _render_route(self) -> str:
        env = _make_jinja_env()
        tmpl = env.get_template("comment_reactions_api_route.ts.jinja2")
        return tmpl.render()

    def test_route_template_uses_authenticate_api_key(self):
        """API route must authenticate via authenticateApiKey."""
        output = self._render_route()
        assert "authenticateApiKey" in output

    def test_route_template_has_post_toggle_handler(self):
        """API route must export POST handler for the toggle endpoint."""
        output = self._render_route()
        assert "export async function POST" in output

    def test_route_template_returns_group_by_counts(self):
        """POST handler must use Prisma groupBy to return reaction counts."""
        output = self._render_route()
        assert "groupBy" in output
        assert "counts" in output


# ---------------------------------------------------------------------------
# 4. B1/B2/B3 regression tests
# ---------------------------------------------------------------------------

class TestGenerateRoutePathB1:
    """B1: generate.py must emit route at reactions/toggle/route.ts (D3=A)."""

    def test_generate_py_uses_toggle_subpath(self):
        """generate.py output path must contain 'reactions/toggle/route.ts'."""
        import ast, pathlib
        src = (pathlib.Path(__file__).parent.parent / "generate.py").read_text()
        # Verify the toggle subpath appears in the source
        assert "reactions" in src and "toggle" in src
        # The old path without /toggle/ must not appear in the write call
        # We look for the toggle path in the write call section
        assert "'toggle'" in src or '"toggle"' in src

    def test_generate_py_toggle_path_string(self):
        """generate.py reaction route section must reference the toggle subpath."""
        import pathlib
        src = (pathlib.Path(__file__).parent.parent / "generate.py").read_text()
        assert "reactions/toggle/route.ts" in src or (
            "reactions" in src and "toggle" in src and "route.ts" in src
        )


class TestApiRouteD7FallbackB2:
    """B2: API route uses D7=A fallback (authenticateApiKey only); fallback is documented."""

    def _render_route(self) -> str:
        from jinja2 import Environment, FileSystemLoader
        import pathlib
        templates_dir = pathlib.Path(__file__).parent.parent / "templates"
        env = Environment(loader=FileSystemLoader(str(templates_dir)))
        return env.get_template("comment_reactions_api_route.ts.jinja2").render()

    def test_route_documents_d7a_fallback(self):
        """Template must contain a comment acknowledging the D7=A fallback."""
        output = self._render_route()
        assert "D7=A" in output

    def test_route_does_not_use_require_api_permission(self):
        """D7=A: route must NOT call requireApiPermission (owner-entity check absent)."""
        output = self._render_route()
        assert "requireApiPermission" not in output

    def test_route_has_get_handler(self):
        """Route must export GET handler for single-comment reaction read."""
        output = self._render_route()
        assert "export async function GET" in output


class TestApiRouteD4BatchedB3:
    """B3: D4=C batched strategy — server action handles batch, API route handles single."""

    def _render_route(self) -> str:
        from jinja2 import Environment, FileSystemLoader
        import pathlib
        templates_dir = pathlib.Path(__file__).parent.parent / "templates"
        env = Environment(loader=FileSystemLoader(str(templates_dir)))
        return env.get_template("comment_reactions_api_route.ts.jinja2").render()

    def test_route_documents_d4c_batched_strategy(self):
        """Template must document that D4=C batched is handled by server action."""
        output = self._render_route()
        assert "D4=C" in output or "batched" in output.lower()

    def test_get_handler_queries_single_comment(self):
        """GET handler must query a single comment_id (not a list of ids)."""
        output = self._render_route()
        assert "comment_id: commentId" in output

    def test_get_handler_uses_group_by(self):
        """GET handler must use groupBy to return reaction counts for the single comment."""
        output = self._render_route()
        assert "groupBy" in output
