from generators_test import api_spec_context, helper_context, spec_context


def _entity(model: str) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True,
            "view": True,
            "new": True,
            "edit": True,
            "delete": True,
            "api": True,
            "test": True,
            "fields": None,
        },
    }


def _schema() -> dict:
    return {
        "definitions": {
            "patient": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                },
                "x-display": {
                    "table": [
                        {"name": {"primary": True}},
                    ],
                },
            },
            "checkup": {
                "type": "object",
                "required": ["id", "checkup_date", "patient_id"],
                "properties": {
                    "id": {"type": "string"},
                    "checkup_date": {"type": "string", "format": "date"},
                    "patient_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "patient", "labelField": "name"},
                    },
                },
                "x-display": {
                    "table": [
                        {"checkup_date": {"primary": True}},
                    ],
                },
            },
            "lifestyle": {
                "type": "object",
                "required": [
                    "id",
                    "patient_id",
                    "quolity_of_sleep",
                    "stress_level",
                    "date",
                    "sleep_time",
                    "wakeup_time",
                    "drinking",
                    "exercise",
                    "performance",
                    "troubles",
                    "trouble_dates",
                ],
                "properties": {
                    "id": {"type": "string"},
                    "patient_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "patient", "labelField": "name"},
                    },
                    "checkup_id": {
                        "type": ["string", "null"],
                        "x-relationship": {"type": "one-to-one", "target": "checkup", "labelField": "checkup_date"},
                    },
                    "quolity_of_sleep": {"type": "integer", "minimum": 0, "maximum": 10},
                    "stress_level": {"type": "integer", "minimum": 0, "maximum": 10},
                    "date": {"type": "string", "format": "date"},
                    "sleep_time": {"type": "string", "format": "time"},
                    "wakeup_time": {"type": "string", "format": "time"},
                    "drinking": {"type": "integer", "minimum": 0, "maximum": 7},
                    "exercise": {"type": "integer", "minimum": 0, "maximum": 7},
                    "performance": {"type": "integer", "minimum": 0, "maximum": 10},
                    "troubles": {"type": "integer", "enum": ["Less concentrated"]},
                    "trouble_dates": {"type": "integer", "minimum": 0, "maximum": 7},
                },
                "x-display": {
                    "table": [
                        {"patient": {"primary": True}},
                    ],
                },
            },
            "lifestyle_detail": {
                "allOf": [{"$ref": "#/definitions/lifestyle"}],
            },
            "pre_check": {
                "type": "object",
                "required": ["id", "checkup_id"],
                "properties": {
                    "id": {"type": "string"},
                    "checkup_id": {
                        "type": "string",
                        "x-relationship": {"type": "one-to-one", "target": "checkup", "labelField": "checkup_date"},
                    },
                    "ams_score": {"type": ["integer", "null"], "minimum": 0},
                },
                "x-display": {
                    "table": [
                        {"checkup": {"primary": True}},
                    ],
                },
            },
            "pre_check_detail": {
                "allOf": [{"$ref": "#/definitions/pre_check"}],
            },
        },
    }


def test_spec_context_uses_deps_for_fk_primary_edit():
    ctx = spec_context("lifestyle", [], _schema(), "lifestyle", "lifestyle_detail", _entity("lifestyle")["generate_config"])
    assert ctx["use_deps_in_3_3"] is True
    assert ctx["edit_primary_cmd"] == "        cy.selectAutocomplete('Patient', 'Test Patient 2');"


def test_api_spec_context_omits_required_one_to_one_fk_in_missing_field_case():
    ctx = api_spec_context("pre_check", [], _schema(), "pre_check", "pre_check_detail", _entity("pre_check")["generate_config"])
    body_lines = "\n".join(ctx["post_body_missing_field"])
    assert "checkup_id" not in body_lines


def test_helper_context_self_ref_dep_keeps_required_non_self_fk_deps():
    schema = {
        "definitions": {
            "patient": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                },
                "x-display": {"table": [{"name": {"primary": True}}]},
            },
            "medicine": {
                "type": "object",
                "required": ["id", "patient_id", "name", "by_doctor", "purpose", "start_date"],
                "properties": {
                    "id": {"type": "string"},
                    "patient_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "patient", "labelField": "name"},
                    },
                    "prev_id": {
                        "type": ["string", "null"],
                        "x-relationship": {"type": "one-to-one", "target": "medicine"},
                    },
                    "name": {"type": "string"},
                    "by_doctor": {"type": "integer", "minimum": 0, "maximum": 2, "enum": ["Yes", "No", "Partially"]},
                    "purpose": {"type": "string"},
                    "start_date": {"type": "string", "format": "date-time"},
                },
                "x-display": {"table": [{"patient": {"primary": True}}]},
            },
            "medicine_detail": {"allOf": [{"$ref": "#/definitions/medicine"}]},
        },
    }

    ctx = helper_context("medicine", [], schema, "medicine", "medicine_detail", _entity("medicine")["generate_config"])
    prev_dep = next(d for d in ctx["self_ref_deps"] if d["var_name"] == "prev")
    assert prev_dep["fk_deps"] == [{"prop_name": "patient_id", "dep_var_name": "patient"}]
