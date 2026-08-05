"""
Tests for x-server-value (cmd_556 design, cmd_565 delegation revision):
server-computed field values the client can never set directly.

Uses `leave_request.applicant_id` as the illustrative example (matching the
docs/knowledge write-up) — an in-process pytest fixture, not a shipped schema
entity; see docs/knowledge/default-vs-consumer-entity-boundary.md.

Verifies:
  - String form "actor" (cmd_556, unchanged): client value fully discarded,
    field excluded entirely from parent_prop_infos, actorId always written.
  - Dict form {source: actor} with no override_permission: identical behavior
    to the string form (regression-safety: the two forms must never diverge).
  - Dict form with override_permission: the field stays a service parameter;
    build_context wires the getModelPermissions() check + fallback-to-actorId
    resolution + an "overridden" flag for the REST transparency response.
  - Both forms make the field readonly (excluded from form input, protected
    by the existing PUT AP-3=B reject, excluded from the update SET clause).
  - CREATE-time x-readonly guard (cmd_565 乙): a *plain* readonly field (no
    x-server-value) is hard-rejected if the client supplies any value on
    create, via both the REST route and the server action — and x-server-value
    fields are exempted from that same generic reject (they have their own
    dedicated resolution instead).
"""
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import service_context, actions_context


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _schema(applicant_server_value=None, extra_props: dict | None = None,
            entity_level_ro: list[str] | None = None) -> dict:
    props: dict = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
    }
    if applicant_server_value is not None:
        props["applicant_id"] = {
            "type": "string",
            "pattern": "^c[a-z0-9]{24,}$",
            "x-relationship": {"type": "many-to-one", "target": "user", "labelField": "name"},
            "x-server-value": applicant_server_value,
        }
    if extra_props:
        props.update(extra_props)

    entity_def: dict = {
        "type": "object",
        "required": ["id", "name"] + (["applicant_id"] if applicant_server_value is not None else []),
        "properties": props,
    }
    if entity_level_ro:
        entity_def["x-readonly-fields"] = entity_level_ro

    return {
        "definitions": {
            "user": {
                "type": "object", "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "leave_request": entity_def,
            "leave_request_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": False, "fields": None,
                },
                "allOf": [{"$ref": "#/definitions/leave_request"}],
            },
        }
    }


def _entity(model: str = "leave_request") -> dict:
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
    here = Path(__file__).parent.parent
    env = Environment(
        loader=FileSystemLoader(here / "templates"),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env.get_template(template_name).render(**ctx)


def _prop_names(ctx: dict) -> list[str]:
    return [p["prop"] for p in ctx["parent_prop_infos"]]


# ---------------------------------------------------------------------------
# build_context: string form (cmd_556, unchanged)
# ---------------------------------------------------------------------------

class TestServerValueStringForm:
    def test_field_excluded_from_parent_prop_infos(self):
        ctx = build_context(_entity(), _schema("actor"))
        assert "applicant_id" not in _prop_names(ctx)

    def test_field_is_readonly(self):
        ctx = build_context(_entity(), _schema("actor"))
        assert "applicant_id" in ctx["readonly_fields"]
        assert "applicant_id" in ctx["readonly_fields_api"]

    def test_no_override_fields_recorded(self):
        ctx = build_context(_entity(), _schema("actor"))
        assert ctx["server_value_override_fields"] == []
        assert len(ctx["server_value_fields"]) == 1
        assert ctx["server_value_fields"][0]["override_permission"] is None

    def test_pre_create_code_always_actor_id(self):
        ctx = build_context(_entity(), _schema("actor"))
        assert ctx["server_value_pre_create_code"].strip() == "const _applicantIdValue = actorId;"
        assert "getModelPermissions" not in ctx["server_value_pre_create_code"]

    def test_data_line_uses_resolved_value(self):
        ctx = build_context(_entity(), _schema("actor"))
        assert "applicant_id: _applicantIdValue," in ctx["server_value_data_lines"]

    def test_not_in_generic_parent_data_obj(self):
        ctx = build_context(_entity(), _schema("actor"))
        assert "applicant_id" not in ctx["parent_data_obj"]

    def test_excluded_from_generic_create_reject(self):
        """乙's guard is for plain readonly fields only — server-value fields
        have their own resolution and must never appear in this list."""
        ctx = build_context(_entity(), _schema("actor"))
        assert "applicant_id" not in ctx["readonly_fields_create_reject"]

    def test_unsupported_string_value_ignored(self):
        """Only 'actor' is a recognized source; anything else is inert (no
        protection applied) -- validate.py is responsible for flagging this
        as a schema error, build_context just doesn't silently half-apply it."""
        ctx = build_context(_entity(), _schema("someone_else"))
        assert "applicant_id" in _prop_names(ctx)
        assert ctx["server_value_fields"] == []


# ---------------------------------------------------------------------------
# build_context: dict form, no override_permission (must match string form)
# ---------------------------------------------------------------------------

class TestServerValueDictFormNoOverride:
    def test_matches_string_form_behavior(self):
        ctx_dict = build_context(_entity(), _schema({"source": "actor"}))
        ctx_str = build_context(_entity(), _schema("actor"))
        assert "applicant_id" not in _prop_names(ctx_dict)
        assert ctx_dict["server_value_pre_create_code"] == ctx_str["server_value_pre_create_code"]
        assert ctx_dict["server_value_data_lines"] == ctx_str["server_value_data_lines"]
        assert ctx_dict["server_value_override_fields"] == []


# ---------------------------------------------------------------------------
# build_context: dict form WITH override_permission (cmd_565 delegation)
# ---------------------------------------------------------------------------

class TestServerValueDictFormWithOverride:
    def _ctx(self):
        return build_context(_entity(), _schema({"source": "actor", "override_permission": "delete"}))

    def test_field_stays_a_service_parameter(self):
        """Unlike the no-override forms, this field must still flow through as
        a param -- the service needs the raw client value to decide whether
        to honor it."""
        ctx = self._ctx()
        assert "applicant_id" in _prop_names(ctx)

    def test_still_readonly_for_form_and_update(self):
        ctx = self._ctx()
        assert "applicant_id" in ctx["readonly_fields"]
        assert "applicant_id" in ctx["readonly_fields_api"]

    def test_still_excluded_from_generic_create_reject(self):
        ctx = self._ctx()
        assert "applicant_id" not in ctx["readonly_fields_create_reject"]

    def test_not_in_generic_parent_data_obj(self):
        ctx = self._ctx()
        assert "applicant_id" not in ctx["parent_data_obj"]

    def test_pre_create_code_checks_permission(self):
        ctx = self._ctx()
        code = ctx["server_value_pre_create_code"]
        assert "getModelPermissions('leave_request', actorId)" in code
        assert "_applicantIdPerms.delete" in code
        assert "applicantId && _applicantIdPerms.delete" in code
        assert "_applicantIdOverridden" in code

    def test_data_line_uses_resolved_value(self):
        ctx = self._ctx()
        assert "applicant_id: _applicantIdValue," in ctx["server_value_data_lines"]

    def test_override_fields_recorded(self):
        ctx = self._ctx()
        assert len(ctx["server_value_override_fields"]) == 1
        assert ctx["server_value_override_fields"][0]["prop"] == "applicant_id"

    def test_overrides_build_code(self):
        ctx = self._ctx()
        code = ctx["server_value_overrides_build_code"]
        assert "_serverValueOverrides" in code
        assert "_serverValueOverrides['applicant_id'] = 'overridden'" in code


# ---------------------------------------------------------------------------
# service.ts.jinja2 rendering
# ---------------------------------------------------------------------------

class TestServiceTemplateRendering:
    def _svc_ctx(self, sv):
        ctx = build_context(_entity(), _schema(sv))
        return {**ctx, **service_context(ctx, _schema(sv))}

    def test_no_override_return_type_unchanged(self):
        rendered = _render("service.ts.jinja2", self._svc_ctx("actor"))
        assert "Promise<{ id: string }>" in rendered
        assert "_server_value_overrides" not in rendered

    def test_override_return_type_and_flag(self):
        rendered = _render(
            "service.ts.jinja2",
            self._svc_ctx({"source": "actor", "override_permission": "delete"}),
        )
        assert "_server_value_overrides?: Record<string, string>" in rendered
        assert "_serverValueOverrides['applicant_id'] = 'overridden'" in rendered
        assert "return { id: created.id, ...(Object.keys(_serverValueOverrides).length" in rendered
        assert "import { getModelPermissions } from '@/lib/authz';" in rendered

    def test_no_override_does_not_import_getmodelpermissions(self):
        rendered = _render("service.ts.jinja2", self._svc_ctx("actor"))
        assert "getModelPermissions" not in rendered


# ---------------------------------------------------------------------------
# api_route.ts.jinja2 (POST) rendering — REST transparency + destructure
# ---------------------------------------------------------------------------

class TestApiRoutePostRendering:
    def test_no_override_field_excluded_from_destructure(self):
        ctx = build_context(_entity(), _schema("actor"))
        rendered = _render("api_route.ts.jinja2", ctx)
        assert "applicant_id" not in rendered.split("export async function POST")[1].split(
            "const result = await add"
        )[0]

    def test_override_field_included_in_destructure(self):
        ctx = build_context(_entity(), _schema({"source": "actor", "override_permission": "delete"}))
        rendered = _render("api_route.ts.jinja2", ctx)
        post_body = rendered.split("export async function POST")[1]
        assert "applicant_id: applicantId" in post_body

    def test_server_value_field_never_in_create_reject_block(self):
        ctx = build_context(_entity(), _schema({"source": "actor", "override_permission": "delete"}))
        rendered = _render("api_route.ts.jinja2", ctx)
        assert "Field applicant_id is read-only and cannot be set" not in rendered


# ---------------------------------------------------------------------------
# cmd_565 乙: CREATE-time readonly guard (plain readonly fields, REST)
# ---------------------------------------------------------------------------

class TestReadonlyCreateRejectRest:
    def _ctx(self):
        return build_context(
            _entity(),
            _schema(applicant_server_value=None, extra_props={
                "status": {"type": "integer", "minimum": 0, "maximum": 2, "enum": ["a", "b", "c"],
                           "x-readonly": True},
            }),
        )

    def test_readonly_fields_create_reject_populated(self):
        ctx = self._ctx()
        assert ctx["readonly_fields_create_reject"] == ["status"]

    def test_post_route_rejects_explicit_value(self):
        rendered = _render("api_route.ts.jinja2", self._ctx())
        post_body = rendered.split("export async function POST")[1]
        assert "if (body.status !== undefined)" in post_body
        assert "Field status is read-only and cannot be set" in post_body
        assert "status: 400" in post_body

    def test_no_readonly_fields_no_reject_code(self):
        ctx = build_context(_entity(), _schema())
        rendered = _render("api_route.ts.jinja2", ctx)
        assert "is read-only and cannot be set" not in rendered

    def test_put_ap3b_untouched(self):
        """Sibling regression check: the existing UPDATE guard (AP-3=B) must
        still fire for the very same plain readonly field."""
        rendered = _render("api_detail_route.ts.jinja2", self._ctx())
        assert "body.status !== undefined && String(body.status) !== String(_roRow.status)" in rendered
        assert "is read-only and cannot be changed" in rendered


# ---------------------------------------------------------------------------
# cmd_565 乙: CREATE-time readonly guard (server action)
# ---------------------------------------------------------------------------

class TestReadonlyCreateRejectAction:
    def _ctx(self):
        ctx = build_context(
            _entity(),
            _schema(applicant_server_value=None, extra_props={
                "status": {"type": "integer", "minimum": 0, "maximum": 2, "enum": ["a", "b", "c"],
                           "x-readonly": True},
            }),
        )
        return {**ctx, **actions_context(ctx)}

    def test_upsert_body_has_guarded_reject(self):
        act_ctx = self._ctx()
        body = act_ctx["upsert_body"]
        assert "if (!id) {" in body
        assert "if (data.get('status') !== null)" in body
        assert "Field status is read-only and cannot be set" in body

    def test_no_readonly_fields_no_reject_code(self):
        ctx = build_context(_entity(), _schema())
        act_ctx = {**ctx, **actions_context(ctx)}
        assert "is read-only and cannot be set" not in act_ctx["upsert_body"]

    def test_server_value_field_not_in_action_reject(self):
        ctx = build_context(_entity(), _schema({"source": "actor", "override_permission": "delete"}))
        act_ctx = {**ctx, **actions_context(ctx)}
        assert "Field applicant_id is read-only and cannot be set" not in act_ctx["upsert_body"]
