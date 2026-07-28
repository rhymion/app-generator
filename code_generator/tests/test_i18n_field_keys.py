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
from generators_i18n import _collect_custom_component_sections, _collect_field_keys


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


# ---------------------------------------------------------------------------
# RC-1 regression: paired VIEW/RAW entities (Stage-4 `__`-prefixed raw split)
# ---------------------------------------------------------------------------
#
# build_intermediate_schema() emits two definitions per Prisma-backed entity:
#   `leave_request`   (VIEW): {"allOf": [{"$ref": "#/definitions/__leave_request"}]}
#   `__leave_request` (RAW):  {"properties": {...}}
# extract_entities() sets both `model` and `definition_key` to the VIEW key
# (`leave_request`). Reading `schema['definitions'][model]` directly (instead
# of resolving through `_raw_def`) hits the VIEW, whose `properties` is empty
# — silently dropping every scalar field key for every paired entity.


def test_paired_view_raw_entity_emits_scalar_field_keys():
    """Main entity backed by a __-prefixed RAW definition must still contribute
    its scalar field keys (RC-1: previously 0 keys for every paired entity)."""
    schema = {
        "definitions": {
            "leave_request": {"allOf": [{"$ref": "#/definitions/__leave_request"}]},
            "__leave_request": {
                "type": "object",
                "required": ["id", "status"],
                "properties": {
                    "id": _scalar_id_prop(),
                    "status": {"type": "string"},
                    "start_date": {"type": "string", "format": "date"},
                    "end_date": {"type": "string", "format": "date"},
                },
            },
        }
    }
    entity = _entity("leave_request", definition_key="leave_request")
    keys = _collect_field_keys([entity], schema)

    assert keys.get("status") == "Status"
    assert keys.get("startDate") == "Start Date"
    assert keys.get("endDate") == "End Date"


def test_paired_view_raw_entity_fk_still_resolves_via_raw():
    """A many-to-one FK on a paired entity's RAW definition must still strip
    `_id` and emit its picker label key."""
    schema = {
        "definitions": {
            "leave_request": {"allOf": [{"$ref": "#/definitions/__leave_request"}]},
            "__leave_request": {
                "type": "object",
                "required": ["id", "user_id"],
                "properties": {
                    "id": _scalar_id_prop(),
                    "user_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {"type": "many-to-one", "target": "user", "labelField": "name"},
                    },
                },
            },
        }
    }
    entity = _entity("leave_request", definition_key="leave_request")
    keys = _collect_field_keys([entity], schema)
    assert keys.get("user") == "User"


def test_paired_child_entity_emits_column_header_keys():
    """Child table backed by a __-prefixed RAW definition must still contribute
    its column-header field keys (RC-1's line-159 counterpart, for paired
    children rather than the paired main entity)."""
    schema = {
        "definitions": {
            "shift_template": {"allOf": [{"$ref": "#/definitions/__shift_template"}]},
            "__shift_template": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": _scalar_id_prop()},
            },
            "shift": {"allOf": [{"$ref": "#/definitions/__shift"}]},
            "__shift": {
                "type": "object",
                "required": ["id", "shift_template_id", "start_time"],
                "properties": {
                    "id": _scalar_id_prop(),
                    "shift_template_id": _scalar_id_prop(),
                    "start_time": {"type": "string"},
                },
            },
        }
    }
    entity = _entity("shift_template", definition_key="shift_template")
    entity["children"] = [{"name": "shift", "property_name": "shifts"}]
    keys = _collect_field_keys([entity], schema)
    assert keys.get("startTime") == "Start Time"


# ---------------------------------------------------------------------------
# RC-2 / FIX-B regression: component-owned namespace sections
# ---------------------------------------------------------------------------


def test_custom_component_section_contributes_own_namespace():
    """`CopyShiftsButton` on shift_template must contribute ShiftTemplate.* keys
    via _CUSTOM_COMPONENT_SECTIONS, not the Fields namespace."""
    schema = {
        "definitions": {
            "shift_template_detail": {
                "x-custom-components": [
                    {"name": "CopyShiftsButton", "target": ["list"]},
                ],
            },
        }
    }
    entity = _entity("shift_template", definition_key="shift_template_detail")
    sections = _collect_custom_component_sections([entity], schema)

    assert sections.get("ShiftTemplate", {}).get("copyToShifts") == "Copy to Shifts"
    assert sections.get("ShiftTemplate", {}).get("copyToShiftsExplanation") == (
        "Copy Shift Templates to Shifts"
    )

    # Must NOT leak into Fields via _collect_field_keys.
    field_keys = _collect_field_keys([entity], {"definitions": {
        "shift_template_detail": schema["definitions"]["shift_template_detail"],
        "shift_template": {"type": "object", "properties": {"id": _scalar_id_prop()}},
    }})
    assert "copyToShifts" not in field_keys
