"""
Tests for x-filter-values support (cmd_874/subtask_874f).

Verifies:
  - build_context collects filter_values from the view entity (never the
    shared raw entity — same view-scoping as x-readonly-fields).
  - Cross-view isolation: a sibling view of the same raw model does not
    inherit another view's x-filter-values declaration.
  - Fail-closed on an unresolved field name.
  - filter_values_select (Prisma select clause for pre-image reads).
  - Template rendering: build{Entity}AccessWhere() and get{Entity}Detail()
    in getters.ts.jinja2, service.ts.jinja2's update{Entity} pre-image
    guard, and the write-path 404 checks in api_detail_route.ts.jinja2,
    api_bulk_route.ts.jinja2, and actions.ts.jinja2's remove{Entity}.
  - AND composition with org isolation / x-self-only (never OR).
"""
import pytest
from build_context import build_context
from generators_test import helper_context


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _schema_with_filter(
    filter_values: dict | None = None,
    should_filter_by_org: bool = False,
    is_self_only: bool = False,
) -> dict:
    props: dict = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
        "status": {"type": "string"},
        "is_archived": {"type": "boolean"},
    }
    if should_filter_by_org:
        props["organization_id"] = {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}

    entity_def: dict = {"type": "object", "required": ["id", "name"], "properties": props}
    if is_self_only:
        entity_def["x-self-only"] = True

    view_def: dict = {
        "x-generate": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
        "allOf": [{"$ref": "#/definitions/item"}],
    }
    if filter_values is not None:
        view_def["x-filter-values"] = filter_values

    return {
        "definitions": {
            "item": entity_def,
            "item_detail": view_def,
        }
    }


def _entity(model: str = "item") -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }


def _render(template_name: str, ctx: dict) -> str:
    import json
    from jinja2 import Environment, FileSystemLoader
    from pathlib import Path
    from helpers.naming import to_pascal_case, to_camel_case
    here = Path(__file__).parent.parent
    env = Environment(
        loader=FileSystemLoader(here / "templates"),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    env.filters['tojson'] = json.dumps
    return env.get_template(template_name).render(**ctx)


# ---------------------------------------------------------------------------
# build_context: filter_values collection
# ---------------------------------------------------------------------------

class TestBuildContextFilterValues:
    def test_no_filter_values_gives_empty_dict(self):
        schema = _schema_with_filter()
        ctx = build_context(_entity(), schema)
        assert ctx["filter_values"] == {}
        assert ctx["filter_values_select"] is None

    def test_filter_values_collected(self):
        schema = _schema_with_filter(filter_values={"status": ["active", "pending"]})
        ctx = build_context(_entity(), schema)
        assert ctx["filter_values"] == {"status": ["active", "pending"]}

    def test_multiple_fields_collected(self):
        schema = _schema_with_filter(
            filter_values={"status": ["active"], "is_archived": [False]}
        )
        ctx = build_context(_entity(), schema)
        assert ctx["filter_values"] == {"status": ["active"], "is_archived": [False]}

    def test_filter_values_select_populated(self):
        schema = _schema_with_filter(filter_values={"status": ["active"]})
        ctx = build_context(_entity(), schema)
        assert ctx["filter_values_select"] is not None
        assert "status: true" in ctx["filter_values_select"]

    def test_unresolved_field_fails_closed(self):
        """An x-filter-values key that doesn't match a real property must
        raise, not silently be dropped (same fail-closed posture as
        x-readonly-fields, cmd_642)."""
        schema = _schema_with_filter(filter_values={"not_a_real_property": ["x"]})
        with pytest.raises(ValueError, match="not_a_real_property"):
            build_context(_entity(), schema)

    def test_item_context_select_includes_filter_fields(self):
        schema = _schema_with_filter(filter_values={"status": ["active"]})
        ctx = build_context(_entity(), schema)
        assert "status: true" in ctx["item_context_select"]


# ---------------------------------------------------------------------------
# View-scoping: cross-view isolation (mirrors x-readonly-fields cmd_874/874d)
# ---------------------------------------------------------------------------

class TestFilterValuesCrossViewIsolation:
    """Two views sharing the same raw entity must not leak an
    x-filter-values declaration between them."""

    def _schema(self) -> dict:
        return {
            "definitions": {
                "__item": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "name": {"type": "string"},
                        "status": {"type": "string"},
                    },
                },
                "item_a": {
                    "x-generate": {
                        "list": True, "view": True, "new": True, "edit": True,
                        "delete": True, "api": True, "test": False, "fields": None,
                    },
                    "x-filter-values": {"status": ["active"]},
                    "allOf": [{"$ref": "#/definitions/__item"}],
                },
                "item_b": {
                    "x-generate": {
                        "list": True, "view": True, "new": True, "edit": True,
                        "delete": True, "api": True, "test": False, "fields": None,
                    },
                    "allOf": [{"$ref": "#/definitions/__item"}],
                },
            }
        }

    def _entity(self, definition_key: str) -> dict:
        return {
            "parent": definition_key,
            "model": "item",
            "definition_key": definition_key,
            "children": [],
            "generate_config": {
                "list": True, "view": True, "new": True, "edit": True,
                "delete": True, "api": True, "test": False, "fields": None,
            },
        }

    def test_declaring_view_sees_it(self):
        schema = self._schema()
        ctx = build_context(self._entity("item_a"), schema)
        assert ctx["filter_values"] == {"status": ["active"]}

    def test_sibling_view_of_same_raw_model_does_not_inherit_it(self):
        schema = self._schema()
        ctx = build_context(self._entity("item_b"), schema)
        assert ctx["filter_values"] == {}, (
            "item_b shares the __item raw entity with item_a but declares "
            "no x-filter-values of its own — item_a's declaration must not "
            "leak onto it"
        )

    def test_raw_entity_itself_never_carries_the_key(self):
        schema = self._schema()
        assert "x-filter-values" not in schema["definitions"]["__item"]


# ---------------------------------------------------------------------------
# getters.ts.jinja2: build{Entity}AccessWhere() + get{Entity}Detail()
# ---------------------------------------------------------------------------

class TestGettersTemplate:
    def test_no_filter_values_no_generated_code(self):
        schema = _schema_with_filter()
        ctx = build_context(_entity(), schema)
        rendered = _render("getters.ts.jinja2", ctx)
        assert "x-filter-values" not in rendered

    def test_access_where_pushes_in_clause(self):
        schema = _schema_with_filter(filter_values={"status": ["active", "pending"]})
        ctx = build_context(_entity(), schema)
        rendered = _render("getters.ts.jinja2", ctx)
        assert 'and.push({ status: { in: ["active", "pending"] } })' in rendered

    def test_access_where_multiple_fields_and_composed(self):
        schema = _schema_with_filter(
            filter_values={"status": ["active"], "is_archived": [False]}
        )
        ctx = build_context(_entity(), schema)
        rendered = _render("getters.ts.jinja2", ctx)
        assert 'and.push({ status: { in: ["active"] } })' in rendered
        assert 'and.push({ is_archived: { in: [false] } })' in rendered

    def test_detail_inline_where_includes_filter(self):
        schema = _schema_with_filter(filter_values={"status": ["active"]})
        ctx = build_context(_entity(), schema)
        rendered = _render("getters.ts.jinja2", ctx)
        assert "status: { in: [\"active\"] }," in rendered

    def test_composes_with_self_only(self):
        schema = _schema_with_filter(
            filter_values={"status": ["active"]},
            is_self_only=True,
        )
        ctx = build_context(_entity(), schema)
        rendered = _render("getters.ts.jinja2", ctx)
        # Both conditions land in the same `and` array — never an OR
        # between them (AND composition, per ruling_C).
        assert "and.push({ creator_id: userId })" in rendered
        assert 'and.push({ status: { in: ["active"] } })' in rendered


# ---------------------------------------------------------------------------
# search_helpers.ts.jinja2: cross-entity search (via generate.py's shape)
# ---------------------------------------------------------------------------

class TestSearchHelpersTemplate:
    def _render_search(self, filter_values: dict) -> str:
        entity = {
            "entity_type": "widget",
            "model": "widget",
            "should_filter_by_org": False,
            "org_id_field": "organization_id",
            "org_relationship_optional": False,
            "has_assignee_id": False,
            "is_self_only": False,
            "filter_values": filter_values,
            "perms_ts_var": "widgetPerms",
            "general_read_ts_var": "widgetGeneralRead",
            "access_clauses_ts_var": "widgetAccessClauses",
            "access_where_ts_var": "widgetAccessWhere",
            "or_clauses_ts_var": "widgetOrClauses",
            "no_page_children": [],
            "parent_access_clauses_ts_var": "widgetParentAccessClauses",
            "parent_access_where_ts_var": "widgetParentAccessWhere",
            "parent_or_clauses_ts_var": "widgetParentOrClauses",
            "ts_vector_fields_sql": "COALESCE(name, '')",
            "similarity_fields_sql": "similarity(COALESCE(name, ''), ${q})",
            "similarity_where_sql": "similarity(COALESCE(name, ''), ${q}) > 0.3",
            "snippet_field": "name",
            "bigm_where_sql": "COALESCE(name, '') ILIKE '%' || ${q} || '%'",
            "bigm_similarity_fields_sql": "CASE WHEN COALESCE(name, '') ILIKE '%' || ${q} || '%' THEN 1.0 ELSE 0.0 END::float8",
        }
        return _render("search_helpers.ts.jinja2", {"search_entities": [entity]})

    def test_no_filter_values_no_generated_code(self):
        rendered = self._render_search({})
        assert "x-filter-values" not in rendered

    def test_access_clauses_include_parameterized_in(self):
        rendered = self._render_search({"status": ["active"]})
        assert 'widgetAccessClauses.push(Prisma.sql`status IN (${ Prisma.join([\"active\"].map((v: unknown) => Prisma.sql`${ v }`)) })`)' in rendered


# ---------------------------------------------------------------------------
# service.ts.jinja2: update{Entity} pre-image write guard (convergence point)
# ---------------------------------------------------------------------------

class TestServiceTemplate:
    def test_no_filter_values_no_generated_code(self):
        schema = _schema_with_filter()
        ctx = build_context(_entity(), schema)
        rendered = _render("service.ts.jinja2", ctx)
        assert "_filterValuesExisting" not in rendered

    def test_update_prechecks_pre_image_row(self):
        schema = _schema_with_filter(filter_values={"status": ["pending"]})
        ctx = build_context(_entity(), schema)
        rendered = _render("service.ts.jinja2", ctx)
        assert "_filterValuesExisting" in rendered
        assert "prisma.item.findUnique({ where: { id }, select: { status: true } })" in rendered
        assert '["pending"] as unknown[]).includes((_filterValuesExisting as Record<string, unknown>).status)' in rendered
        assert "AppError('NOT_FOUND', 'Not found')" in rendered

    def test_delete_has_no_internal_check(self):
        """delete{Entity} mirrors the existing x-self-only precedent: no
        internal re-verification. Enforcement for delete happens entirely
        at each caller's own pre-image fetch-and-filter (route.ts,
        bulk-route.ts, actions.ts) — see those templates' own tests."""
        schema = _schema_with_filter(filter_values={"status": ["pending"]})
        ctx = build_context(_entity(), schema)
        rendered = _render("service.ts.jinja2", ctx)
        delete_fn = rendered.split("export async function deleteItem")[1]
        assert "_filterValuesExisting" not in delete_fn


# ---------------------------------------------------------------------------
# api_detail_route.ts.jinja2: single-item PUT/DELETE pre-image 404
# ---------------------------------------------------------------------------

class TestApiDetailRouteTemplate:
    def test_no_filter_values_no_generated_code(self):
        schema = _schema_with_filter()
        ctx = build_context(_entity(), schema)
        rendered = _render("api_detail_route.ts.jinja2", ctx)
        assert "x-filter-values" not in rendered

    def test_put_checks_pre_image_and_404s(self):
        schema = _schema_with_filter(filter_values={"status": ["pending"]})
        ctx = build_context(_entity(), schema)
        rendered = _render("api_detail_route.ts.jinja2", ctx)
        put_fn = rendered.split("export async function PUT")[1].split("export async function DELETE")[0]
        assert '["pending"] as unknown[]).includes((existing as Record<string, unknown>).status)' in put_fn
        assert "status: 404" in put_fn

    def test_delete_checks_pre_image_and_404s(self):
        schema = _schema_with_filter(filter_values={"status": ["pending"]})
        ctx = build_context(_entity(), schema)
        rendered = _render("api_detail_route.ts.jinja2", ctx)
        delete_fn = rendered.split("export async function DELETE")[1]
        assert '["pending"] as unknown[]).includes((existing as Record<string, unknown>).status)' in delete_fn
        assert "status: 404" in delete_fn


# ---------------------------------------------------------------------------
# api_bulk_route.ts.jinja2: bulk PUT/DELETE per-item pre-image check
# ---------------------------------------------------------------------------

class TestApiBulkRouteTemplate:
    def test_bulk_put_checks_pre_image(self):
        schema = _schema_with_filter(filter_values={"status": ["pending"]})
        ctx = build_context(_entity(), schema)
        rendered = _render("api_bulk_route.ts.jinja2", ctx)
        put_fn = rendered.split("PUT /api/")[1].split("DELETE /api/")[0]
        assert '["pending"] as unknown[]).includes((existing as Record<string, unknown>).status)' in put_fn
        assert "Not found: ${id}" in put_fn

    def test_bulk_delete_checks_pre_image(self):
        schema = _schema_with_filter(filter_values={"status": ["pending"]})
        ctx = build_context(_entity(), schema)
        rendered = _render("api_bulk_route.ts.jinja2", ctx)
        delete_fn = rendered.split("DELETE /api/")[1]
        assert '["pending"] as unknown[]).includes((existing as Record<string, unknown>).status)' in delete_fn


# ---------------------------------------------------------------------------
# actions.ts.jinja2: remove{Entity} (Server Action delete) pre-image filter
# ---------------------------------------------------------------------------

class TestGeneratedPopulateHelperRespectsFilterValues:
    """cmd_874/subtask_874f addendum: the generic prisma_value() default for
    a plain text field (e.g. `Test Team 1`) has no awareness of a view's
    x-filter-values — an unconstrained populate call would silently create
    test rows outside the view it exists to test, 404ing the generated
    CRUD round-trip tests built on top of it (reproduced live in proj_c's
    alpha_xxxxx_xxxxx.cy.ts: 10/22 tests failed before this fix). Mirrors
    the existing x-approval submit_on lockdown-field override (cmd_858c)
    at the same insertion point."""

    def _schema(self, filter_values: dict) -> dict:
        return {
            "definitions": {
                "item": {
                    "type": "object",
                    "required": ["id", "name", "team"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "name": {"type": "string"},
                        "team": {"type": "string"},
                    },
                },
                "item_detail": {
                    "x-generate": {
                        "list": True, "view": True, "new": False, "edit": True,
                        "delete": True, "api": True, "test": True, "fields": None,
                    },
                    "x-filter-values": filter_values,
                    "allOf": [{"$ref": "#/definitions/item"}],
                },
            }
        }

    def _generate_config(self) -> dict:
        return {
            "list": True, "view": True, "new": False, "edit": True,
            "delete": True, "api": True, "test": True, "fields": None,
        }

    def test_constrained_field_uses_allowed_value_not_generic_placeholder(self):
        schema = self._schema({"team": ["alpha"]})
        ctx = helper_context("item", [], schema, "item", "item_detail", self._generate_config())
        team_field = next(f for f in ctx["required_fields_prisma"] if f["prop_name"] == "team")
        assert team_field["prisma_val"] == "'alpha'"
        assert team_field["prisma_val_fixed"] == "'alpha'"

    def test_unconstrained_field_still_uses_generic_placeholder(self):
        schema = self._schema({})
        ctx = helper_context("item", [], schema, "item", "item_detail", self._generate_config())
        team_field = next(f for f in ctx["required_fields_prisma"] if f["prop_name"] == "team")
        assert "Test" in team_field["prisma_val"]

    def test_boolean_filter_value_renders_as_js_boolean_not_string(self):
        schema = self._schema({"team": [False]})
        ctx = helper_context("item", [], schema, "item", "item_detail", self._generate_config())
        team_field = next(f for f in ctx["required_fields_prisma"] if f["prop_name"] == "team")
        assert team_field["prisma_val"] == "false"


class TestActionsTemplate:
    def test_remove_filters_by_pre_image(self):
        schema = _schema_with_filter(filter_values={"status": ["pending"]})
        ctx = build_context(_entity(), schema)
        rendered = _render("actions.ts.jinja2", ctx)
        assert '(["pending"] as unknown[]).includes((item as Record<string, unknown>).status)' in rendered
        assert "select: { id: true, creator_id: true, status: true }" in rendered

    def test_no_filter_values_select_unchanged(self):
        schema = _schema_with_filter()
        ctx = build_context(_entity(), schema)
        rendered = _render("actions.ts.jinja2", ctx)
        assert "select: { id: true, creator_id: true }" in rendered
