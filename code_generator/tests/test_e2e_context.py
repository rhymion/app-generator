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


def test_spec_context_3_3_populates_two_when_primary_is_fk():
    """Edit-3.3 switches the primary FK from "Test X 1" to "Test X 2", so the
    populate task must seed at least two records to make the second target row
    available in the autocomplete picker."""
    ctx = spec_context("lifestyle", [], _schema(), "lifestyle", "lifestyle_detail", _entity("lifestyle")["generate_config"])
    assert ctx["populate_count_3_3"] == 2


def test_spec_context_3_3_user_account_primary_uses_select_autocomplete():
    """A primary FK to user_account is filtered out of `fields` (it goes through
    req_ua_spec instead), so the prim_edit_meta lookup misses it. Even so, the
    field renders as an autocomplete in the form — fall through to
    selectAutocomplete rather than clearAndFillField, and bump the populate
    count so two distinct user_account rows exist."""
    schema = {
        "definitions": {
            "user_account": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "shift": {
                "type": "object",
                "required": ["id", "user_account_id", "start_time"],
                "properties": {
                    "id": {"type": "string"},
                    "user_account_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "user_account", "labelField": "name"},
                    },
                    "start_time": {"type": "string", "format": "date-time"},
                },
                "x-display": {"table": [{"user_account": {"primary": True}}]},
            },
            "shift_detail": {"allOf": [{"$ref": "#/definitions/shift"}]},
        },
    }
    ctx = spec_context("shift", [], schema, "shift", "shift_detail", _entity("shift")["generate_config"])
    assert ctx["populate_count_3_3"] == 2
    assert ctx["edit_primary_cmd"] == "        cy.selectAutocomplete('User Account', 'Test User Account 2');"


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


def test_helper_context_primary_fk_string_labels_are_human_readable():
    schema = {
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

    ctx = helper_context("checkup", [], schema, "checkup", "checkup_detail", _entity("checkup")["generate_config"])
    assert ctx["primary_fk_dep"]["target"] == "patient_rel"
    patient_no = next(f for f in ctx["primary_fk_dep"]["extra_required_fields"] if f["prop_name"] == "patient_no")
    # Values must be human-readable AND deterministic so e2e specs can assert
    # on the rendered string (e.g. `cy.contains('Test Patient No 1')`).
    # Idempotency for repeated dep-helper invocations is handled separately at
    # the helper template level via findFirst-or-create on the dep's `name`
    # field, NOT by suffixing values with Date.now().
    assert patient_no["prisma_val"] == "'Test Patient No'"
    assert patient_no["prisma_val_unique"] == '`Test Patient No ${i}`'
