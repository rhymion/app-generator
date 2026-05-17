"""
Regression tests for `generators_i18n._collect_field_keys`.

Background
----------
Generated `FormUpsert.tsx` / `FormView.tsx` render selector one-to-one (`type:
one-to-one`) FK pickers with `tf('<base>')` — e.g. `medicine.prev_id` becomes
`tf('prev')`. So the i18n collector must emit a Fields entry for selector OTO
FKs the same way it does for many-to-one FKs. Bridge OTO FKs (`type:
one-to-one_bridge`, e.g. `commentable_id`, `approvable_id`) are different —
they have no picker UI, and the bridge body is rendered with component-level
keys, so they must NOT produce a field-level key.

A previous refactor coalesced both OTO subtypes into a single `continue`
branch, dropping `Fields.prev`, `Fields.checkup`, and `Fields.userAccount`
from generated output. These tests pin the corrected behavior.
"""
from generators_i18n import _collect_field_keys


def _entity(model: str, definition_key: str | None = None) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": definition_key or f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": True, "fields": None,
        },
    }


def _scalar_id_prop() -> dict:
    return {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}


def test_selector_oto_fk_emits_field_key_with_id_stripped():
    """`medicine.prev_id` (one-to-one self-ref) → Fields.prev = 'Prev'."""
    schema = {
        "definitions": {
            "medicine": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": _scalar_id_prop(),
                    "name": {"type": "string"},
                    "prev_id": {
                        "type": ["string", "null"],
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {"type": "one-to-one", "target": "medicine"},
                    },
                },
            },
            "medicine_detail": {"allOf": [{"$ref": "#/definitions/medicine"}]},
        }
    }
    keys = _collect_field_keys([_entity("medicine")], schema)

    assert keys.get("prev") == "Prev", (
        "Selector OTO FK must emit a Fields key with the _id suffix stripped "
        "(form code uses tf('prev'))."
    )
    # Sanity: the unstripped form must not be there.
    assert "prevId" not in keys


def test_selector_oto_fk_to_other_entity_emits_field_key():
    """`checkup_judgment.checkup_id` (one-to-one → checkup) → Fields.checkup."""
    schema = {
        "definitions": {
            "checkup_judgment": {
                "type": "object",
                "required": ["id", "checkup_id"],
                "properties": {
                    "id": _scalar_id_prop(),
                    "checkup_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "one-to-one",
                            "target": "checkup",
                            "labelField": "checkup_date",
                        },
                    },
                },
            },
            "checkup_judgment_detail": {"allOf": [{"$ref": "#/definitions/checkup_judgment"}]},
        }
    }
    keys = _collect_field_keys([_entity("checkup_judgment")], schema)
    assert keys.get("checkup") == "Checkup"


def test_bridge_oto_fk_does_not_emit_field_key():
    """`db_table.commentable_id` (one-to-one_bridge) must NOT produce Fields.commentable."""
    schema = {
        "definitions": {
            "db_table": {
                "type": "object",
                "required": ["id", "commentable_id"],
                "properties": {
                    "id": _scalar_id_prop(),
                    "commentable_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "one-to-one_bridge",
                            "target": "commentable",
                        },
                    },
                },
            },
            "db_table_detail": {"allOf": [{"$ref": "#/definitions/db_table"}]},
        }
    }
    keys = _collect_field_keys([_entity("db_table")], schema)
    assert "commentable" not in keys
    assert "commentableId" not in keys


def test_many_to_one_fk_still_emits_field_key():
    """Regression guard: many-to-one behaviour unchanged."""
    schema = {
        "definitions": {
            "medicine": {
                "type": "object",
                "required": ["id", "patient_id"],
                "properties": {
                    "id": _scalar_id_prop(),
                    "patient_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "many-to-one",
                            "target": "patient",
                            "labelField": "name",
                        },
                    },
                },
            },
            "medicine_detail": {"allOf": [{"$ref": "#/definitions/medicine"}]},
        }
    }
    keys = _collect_field_keys([_entity("medicine")], schema)
    assert keys.get("patient") == "Patient"


def test_child_table_selector_oto_emits_field_key():
    """Child table column header for a selector OTO FK must also get a Fields key."""
    schema = {
        "definitions": {
            "parent_model": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": _scalar_id_prop()},
            },
            "parent_model_detail": {"allOf": [{"$ref": "#/definitions/parent_model"}]},
            "child_model": {
                "type": "object",
                "required": ["id", "parent_model_id"],
                "properties": {
                    "id": _scalar_id_prop(),
                    "parent_model_id": _scalar_id_prop(),
                    "linked_id": {
                        "type": ["string", "null"],
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {"type": "one-to-one", "target": "other_entity"},
                    },
                },
            },
        }
    }
    entity = _entity("parent_model")
    entity["children"] = [{"name": "child_model", "property_name": "child_models"}]
    keys = _collect_field_keys([entity], schema)
    assert keys.get("linked") == "Linked"


def test_entity_custom_components_inject_keys_for_each_named_component():
    """`x-custom-components` is a list — every entry whose name has registered keys
    in `_CUSTOM_COMPONENT_FIELD_KEYS` contributes its keys to the Fields namespace."""
    schema = {
        "definitions": {
            "leave_request": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": _scalar_id_prop()},
            },
            "leave_request_detail": {
                "allOf": [{"$ref": "#/definitions/leave_request"}],
                "x-custom-components": [
                    {"name": "ApprovalSection",
                     "path": "@/components/_standard/ApprovalSection",
                     "target": ["view", "edit"]},
                    # An additional unrelated component on the same entity must not
                    # remove ApprovalSection's keys.
                    {"name": "Unrelated", "target": ["view"]},
                ],
            },
        }
    }
    keys = _collect_field_keys([_entity("leave_request")], schema)
    # ApprovalSection's registered field keys must all be present.
    assert keys.get("approve") == "Approve"
    assert keys.get("reject") == "Reject"
    assert keys.get("approvalRequests") == "Approval Requests"
