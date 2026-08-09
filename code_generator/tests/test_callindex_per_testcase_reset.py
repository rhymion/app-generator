"""
Regression test for cmd_625 Phase 3 ("per-test-case callIndex reset",
docs/knowledge/cmd614-test-data-uniqueness-design.md §5).

The design's four-template diff guards each addition on
`primary_fk_dep and not primary_fk_dep.is_user_account and
primary_fk_dep.extra_required_fields`. That field is computed by
helper_context() — but spec_context() and tasks_registry_context() build
their own, separate context dicts that never carried it. Without threading
it through (generate.py now does this for both, per cmd_625e), the guard is
always undefined/falsy in test_spec.cy.ts.jinja2, test_spec_mobile.cy.ts.jinja2,
and test_tasks_registry.ts.jinja2: the reset task would silently never be
emitted or called, and cy.task('db:reset{{ pascal }}CallSeq') in a beforeEach
would throw "task not registered" the moment it *was* emitted without a
matching registry entry. This test locks in the wiring end-to-end so a future
context-shape refactor can't silently drop it again.

cmd_628 follow-up: test_api_spec.cy.ts.jinja2 (via api_spec_context()) was
left out of the original cmd_625e diff — same missing-threading defect,
same fix (generate.py injects helper_ctx['primary_fk_dep'] into api_ctx).
Covered below by the test_api_spec_* tests.
"""
from generate import _make_env
from generators_test import api_spec_context, helper_context, spec_context, tasks_registry_context


def _entity(model: str) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": True, "fields": None,
        },
    }


def _schema_with_extra_required_fk() -> dict:
    """checkup -> patient_rel, where patient_rel carries an extra required
    scalar field (patient_no) beyond its own FKs — the exact shape
    helper_context() needs to populate primary_fk_dep.extra_required_fields.
    """
    return {
        "definitions": {
            "patient": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "clinic": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "patient_rel": {
                "type": "object",
                "required": ["id", "patient_no", "patient_id", "clinic_id"],
                "properties": {
                    "id": {"type": "string"},
                    "patient_no": {"type": "string"},
                    "patient_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "patient", "labelField": "name"},
                    },
                    "clinic_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "clinic", "labelField": "name"},
                    },
                },
                "x-display": {"table": [{"patient_no": {"primary": True}}]},
            },
            "checkup": {
                "type": "object",
                "required": ["id", "patient_rel_id", "checkup_date"],
                "properties": {
                    "id": {"type": "string"},
                    "patient_rel_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "patient_rel", "labelField": "patient_no"},
                    },
                    "checkup_date": {"type": "string", "format": "date"},
                },
                "x-display": {"table": [{"patient_rel": {"primary": True}}]},
            },
            "checkup_detail": {"allOf": [{"$ref": "#/definitions/checkup"}]},
        },
    }


def _schema_without_extra_required_fk() -> dict:
    """clinic has no FK dep at all — primary_fk_dep must be None, and none of
    the reset plumbing should be emitted for it.
    """
    return {
        "definitions": {
            "clinic": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                "x-display": {"table": [{"name": {"primary": True}}]},
            },
            "clinic_detail": {"allOf": [{"$ref": "#/definitions/clinic"}]},
        },
    }


def test_helper_context_exposes_primary_fk_dep_needing_reset():
    schema = _schema_with_extra_required_fk()
    ctx = helper_context("checkup", [], schema, "checkup", "checkup_detail", _entity("checkup")["generate_config"])
    assert ctx["primary_fk_dep"] is not None
    assert ctx["primary_fk_dep"]["is_user_account"] is False
    assert ctx["primary_fk_dep"]["extra_required_fields"], (
        "fixture must produce a primary_fk_dep with extra_required_fields — "
        "the exact precondition the reset-task guard checks"
    )


def test_helper_ts_exports_reset_function():
    schema = _schema_with_extra_required_fk()
    ctx = helper_context("checkup", [], schema, "checkup", "checkup_detail", _entity("checkup")["generate_config"])
    out = _make_env().get_template("test_helper.ts.jinja2").render(**ctx)
    assert "let _CheckupCallSeq = 0;" in out
    assert "export function _resetCheckupCallSeq(): void {" in out


def test_spec_context_needs_primary_fk_dep_injected_by_generate_py():
    # spec_context() itself does NOT compute primary_fk_dep (cmd_625e finding)
    # — generate.py must inject it from the sibling helper_ctx before render.
    schema = _schema_with_extra_required_fk()
    spec_ctx = spec_context("checkup", [], schema, "checkup", "checkup_detail", _entity("checkup")["generate_config"])
    assert "primary_fk_dep" not in spec_ctx


def test_spec_and_mobile_spec_call_reset_task_in_before_each():
    schema = _schema_with_extra_required_fk()
    helper_ctx = helper_context("checkup", [], schema, "checkup", "checkup_detail", _entity("checkup")["generate_config"])
    spec_ctx = spec_context("checkup", [], schema, "checkup", "checkup_detail", _entity("checkup")["generate_config"])
    spec_ctx["primary_fk_dep"] = helper_ctx["primary_fk_dep"]

    env = _make_env()
    desktop = env.get_template("test_spec.cy.ts.jinja2").render(**spec_ctx)
    mobile = env.get_template("test_spec_mobile.cy.ts.jinja2").render(**spec_ctx)

    for label, out in [("desktop", desktop), ("mobile", mobile)]:
        before_each, _, rest = out.partition("beforeEach(() => {")
        assert rest, f"{label} spec must have a beforeEach block"
        body, _, _ = rest.partition("});")
        reset_pos = body.find("cy.task('db:resetCheckupCallSeq');")
        db_reset_pos = body.find("cy.task('db:reset');")
        assert reset_pos != -1, f"{label} spec beforeEach must call db:resetCheckupCallSeq"
        assert db_reset_pos != -1
        assert reset_pos < db_reset_pos, (
            f"{label} spec must reset the callIndex counter before db:reset, "
            "so a fresh DB and a fresh counter start together"
        )


def test_registry_emits_reset_task_matching_helper_export():
    schema = _schema_with_extra_required_fk()
    helper_ctx = helper_context("checkup", [], schema, "checkup", "checkup_detail", _entity("checkup")["generate_config"])
    registry_ctx = tasks_registry_context(
        [{
            "parent": "checkup",
            "model_name": "checkup",
            "children": [],
            "definition_key": "checkup_detail",
            "primary_fk_dep": helper_ctx["primary_fk_dep"],
        }],
        schema,
    )
    assert registry_ctx["entities"][0]["primary_fk_dep"] is not None

    out = _make_env().get_template("test_tasks_registry.ts.jinja2").render(**registry_ctx)
    assert "'db:resetCheckupCallSeq'() {" in out
    assert "const { _resetCheckupCallSeq } = require('./checkup/helper');" in out
    assert "_resetCheckupCallSeq();" in out


def test_entity_without_extra_required_fk_gets_no_reset_plumbing():
    schema = _schema_without_extra_required_fk()
    entity_cfg = _entity("clinic")["generate_config"]
    helper_ctx = helper_context("clinic", [], schema, "clinic", "clinic_detail", entity_cfg)
    assert helper_ctx["primary_fk_dep"] is None

    env = _make_env()
    helper_out = env.get_template("test_helper.ts.jinja2").render(**helper_ctx)
    assert "_resetClinicCallSeq" not in helper_out

    spec_ctx = spec_context("clinic", [], schema, "clinic", "clinic_detail", entity_cfg)
    spec_ctx["primary_fk_dep"] = helper_ctx["primary_fk_dep"]
    spec_out = env.get_template("test_spec.cy.ts.jinja2").render(**spec_ctx)
    assert "db:resetClinicCallSeq" not in spec_out

    registry_ctx = tasks_registry_context(
        [{
            "parent": "clinic",
            "model_name": "clinic",
            "children": [],
            "definition_key": "clinic_detail",
            "primary_fk_dep": helper_ctx["primary_fk_dep"],
        }],
        schema,
    )
    registry_out = env.get_template("test_tasks_registry.ts.jinja2").render(**registry_ctx)
    assert "db:resetClinicCallSeq" not in registry_out

    api_ctx = api_spec_context("clinic", [], schema, "clinic", "clinic_detail", {**entity_cfg, "api": True})
    api_ctx["primary_fk_dep"] = helper_ctx["primary_fk_dep"]
    api_out = env.get_template("test_api_spec.cy.ts.jinja2").render(**api_ctx)
    assert "db:resetClinicCallSeq" not in api_out


def test_api_spec_context_needs_primary_fk_dep_injected_by_generate_py():
    # api_spec_context() itself does NOT compute primary_fk_dep either (same
    # gap spec_context()/tasks_registry_context() had — cmd_628 finding) —
    # generate.py must inject it from the sibling helper_ctx before render.
    schema = _schema_with_extra_required_fk()
    entity_cfg = {**_entity("checkup")["generate_config"], "api": True}
    api_ctx = api_spec_context("checkup", [], schema, "checkup", "checkup_detail", entity_cfg)
    assert "primary_fk_dep" not in api_ctx


def test_api_spec_calls_reset_task_in_before_each():
    schema = _schema_with_extra_required_fk()
    entity_cfg = {**_entity("checkup")["generate_config"], "api": True}
    helper_ctx = helper_context("checkup", [], schema, "checkup", "checkup_detail", entity_cfg)
    api_ctx = api_spec_context("checkup", [], schema, "checkup", "checkup_detail", entity_cfg)
    api_ctx["primary_fk_dep"] = helper_ctx["primary_fk_dep"]

    out = _make_env().get_template("test_api_spec.cy.ts.jinja2").render(**api_ctx)

    before_each, _, rest = out.partition("beforeEach(() => {")
    assert rest, "api spec must have a beforeEach block"
    body, _, _ = rest.partition("});")
    reset_pos = body.find("cy.task('db:resetCheckupCallSeq');")
    db_reset_pos = body.find("cy.task('db:reset');")
    assert reset_pos != -1, "api spec beforeEach must call db:resetCheckupCallSeq"
    assert db_reset_pos != -1
    assert reset_pos < db_reset_pos, (
        "api spec must reset the callIndex counter before db:reset, "
        "so a fresh DB and a fresh counter start together"
    )
