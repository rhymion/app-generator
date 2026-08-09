from generators_test import api_spec_context, helper_context, spec_context, _seed_relation_label_value


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
    # cmd_594: targets the dependency helper's base instance ('Test Patient A',
    # letter-indexed per cmd_618), not the loop's numbered instance
    # ('Test Patient 2') — populateLifestyleData(2)'s own loop can independently
    # attach a row to the loop-numbered target for entities whose primary FK
    # also participates in a composite @@unique with another field the loop
    # holds constant, causing an update-time P2002 against that sibling row
    # (asn_line/purchase_order_line 3.3, cmd_593/594). The base instance is
    # never produced by that loop, so it's collision-free unconditionally.
    assert ctx["edit_primary_cmd"] == "        cy.selectAutocomplete('Patient', 'Test Patient A');"


def test_spec_context_3_3_populates_two_when_primary_is_fk():
    """Edit-3.3 switches the primary FK from "Test X 1" to "Test X 2", so the
    populate task must seed at least two records to make the second target row
    available in the autocomplete picker."""
    ctx = spec_context("lifestyle", [], _schema(), "lifestyle", "lifestyle_detail", _entity("lifestyle")["generate_config"])
    assert ctx["populate_count_3_3"] == 2


def test_spec_context_3_3_user_account_primary_uses_select_autocomplete():
    """A primary FK to user (the user-account target) is filtered out of
    `fields` (it goes through req_ua_spec instead), so the prim_edit_meta
    lookup misses it. Even so, the field renders as an autocomplete in the
    form — fall through to selectAutocomplete rather than clearAndFillField,
    and bump the populate count so two distinct user rows exist."""
    schema = {
        "definitions": {
            "user": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "shift": {
                "type": "object",
                "required": ["id", "user_id", "start_time"],
                "properties": {
                    "id": {"type": "string"},
                    "user_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "user", "labelField": "name"},
                    },
                    "start_time": {"type": "string", "format": "date-time"},
                },
                "x-display": {"table": [{"user": {"primary": True}}]},
            },
            "shift_detail": {"allOf": [{"$ref": "#/definitions/shift"}]},
        },
    }
    ctx = spec_context("shift", [], schema, "shift", "shift_detail", _entity("shift")["generate_config"])
    assert ctx["populate_count_3_3"] == 2
    # cmd_594: base instance, not the loop-numbered instance — see
    # test_spec_context_uses_deps_for_fk_primary_edit above for the rationale.
    # cmd_618: base instance is now letter-indexed ('Test User A').
    assert ctx["edit_primary_cmd"] == "        cy.selectAutocomplete('User', 'Test User A');"


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
    # patient is medicine's primary-display FK dep, so the self-ref decoy's
    # patient_id is routed onto the second instance (cmd_590/6908ff49): a
    # decoy referencing the SAME patient as the record under test would
    # render an identical primary-display label in the list, reproducing the
    # goods_receipt_line row-mismatch bug this mechanism exists to prevent.
    # The prop_name -> fk_deps mapping itself (this test's original intent)
    # is unaffected; only the routed instance changed.
    assert prev_dep["fk_deps"] == [{"prop_name": "patient_id", "dep_var_name": "patient2"}]


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
    # on the rendered string (e.g. `cy.contains('Test Patient No 0_1')`).
    # Idempotency for repeated dep-helper invocations (populateXxxDependencies'
    # base/second rows) is handled separately at the helper template level via
    # findFirst-or-create on the dep's `name` field, NOT by suffixing values
    # with Date.now(). The per-iteration primary-FK-dep row (prisma_val_unique)
    # instead gets a per-call callIndex prefix (cmd_620 Option β) — no
    # find-or-create at all, so repeat calls never collide or reuse a row.
    assert patient_no["prisma_val"] == "'Test Patient No A'"
    assert patient_no["prisma_val_unique"] == '`Test Patient No ${callIndex}_${i}`'


def test_api_spec_context_x_relationships_list_includes_composite_label_field():
    """cmd_382 (b): api_spec_context's x_relationships_list (used by N6's
    expected-headers assertion in test_api_spec.cy.ts.jinja2) must match
    build_context.py's x_relationships_list 1:1 by relation, regardless of
    labelField shape — else N6 asserts presence of a header that either does
    (build_context.py includes it) or doesn't (this test context excludes it)
    actually appear in the generated CSV, and the generated cypress spec
    itself becomes wrong."""
    schema = {
        "definitions": {
            "product": {"type": "object", "properties": {"id": {"type": "string"}, "name": {"type": "string"}}},
            "inventory": {
                "type": "object",
                "required": ["id", "product_id"],
                "properties": {
                    "id": {"type": "string"},
                    "product_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "product", "labelField": "name"},
                    },
                },
            },
            "inventory_movement": {
                "type": "object",
                "required": ["id", "from_inventory_id"],
                "properties": {
                    "id": {"type": "string"},
                    "from_inventory_id": {
                        "type": "string",
                        "x-relationship": {
                            "type": "many-to-one",
                            "target": "inventory",
                            "labelField": ["product.name", "id"],
                        },
                    },
                },
            },
            "inventory_movement_detail": {"allOf": [{"$ref": "#/definitions/inventory_movement"}]},
        },
    }
    ctx = api_spec_context(
        "inventory_movement", [], schema, "inventory_movement", "inventory_movement_detail",
        _entity("inventory_movement")["generate_config"],
    )
    fields = [r["field"] for r in ctx["x_relationships_list"]]
    assert "from_inventory" in fields
    assert ctx["x_relationships_list"][fields.index("from_inventory")]["display_col"] == "from_inventory_name"


def _server_value_shift_schema(user_id_server_value=None):
    user_id_field = {
        "type": "string",
        "x-relationship": {"type": "many-to-one", "target": "user", "labelField": "name"},
    }
    if user_id_server_value is not None:
        user_id_field["x-server-value"] = user_id_server_value
    return {
        "definitions": {
            "user": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "shift": {
                "type": "object",
                "required": ["id", "user_id", "start_time"],
                "properties": {
                    "id": {"type": "string"},
                    "user_id": user_id_field,
                    "start_time": {"type": "string", "format": "date-time"},
                },
            },
            "shift_detail": {"allOf": [{"$ref": "#/definitions/shift"}]},
        },
    }


def test_spec_context_ua_field_without_server_value_gets_select_autocomplete():
    """Sanity check (pre-fix baseline behavior, unaffected): a plain FK to
    user with no x-server-value still gets a selectAutocomplete fill command
    — the field genuinely renders as a form autocomplete."""
    ctx = spec_context(
        "shift", [], _server_value_shift_schema(None), "shift", "shift_detail",
        _entity("shift")["generate_config"],
    )
    assert any("selectAutocomplete('User'" in cmd for cmd in ctx["required_fill_cmds"])
    assert any("selectAutocomplete('User'" in cmd for cmd in ctx["all_fill_cmds"])


def test_spec_context_ua_field_with_server_value_excluded_from_fill_commands():
    """cmd_611/612: an x-server-value field is always readonly and excluded
    from every form input — a UI test trying cy.selectAutocomplete() on it
    fails outright (`Expected to find element: 'filter', but never found
    it`) because the form never renders that autocomplete in the first
    place. The fill-command generator must not emit that command."""
    ctx = spec_context(
        "shift", [], _server_value_shift_schema("actor"), "shift", "shift_detail",
        _entity("shift")["generate_config"],
    )
    assert not any("selectAutocomplete('User'" in cmd for cmd in ctx["required_fill_cmds"])
    assert not any("selectAutocomplete('User'" in cmd for cmd in ctx["all_fill_cmds"])


def test_spec_context_ua_field_with_server_value_dict_form_also_excluded():
    """Dict form (with override_permission) is equally excluded — the field
    is a service parameter for the API path, but still never a form input."""
    ctx = spec_context(
        "shift", [], _server_value_shift_schema({"source": "actor", "override_permission": "delete"}),
        "shift", "shift_detail", _entity("shift")["generate_config"],
    )
    assert not any("selectAutocomplete('User'" in cmd for cmd in ctx["required_fill_cmds"])
    assert not any("selectAutocomplete('User'" in cmd for cmd in ctx["all_fill_cmds"])


def _server_value_primary_shift_schema(user_id_server_value):
    """Same shape as leave_request: user_id is BOTH the x-display.table
    primary field AND x-server-value -- exercises the separate
    edit_primary_cmd code path (3.3 mixed-changes edit test), distinct from
    req_ua_spec/all_ua_spec (create/fail-edit fill commands)."""
    return {
        "definitions": {
            "user": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "shift": {
                "type": "object",
                "required": ["id", "user_id", "start_time"],
                "properties": {
                    "id": {"type": "string"},
                    "user_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "user", "labelField": "name"},
                        "x-server-value": user_id_server_value,
                    },
                    "start_time": {"type": "string", "format": "date-time"},
                },
                "x-display": {"table": [{"user": {"primary": True}}]},
            },
            "shift_detail": {"allOf": [{"$ref": "#/definitions/shift"}]},
        },
    }


def test_spec_context_server_value_primary_field_skips_edit_primary_cmd():
    """cmd_611/612: when the x-display.table PRIMARY field is itself
    x-server-value (leave_request.user_id's exact shape), the 3.3
    mixed-changes edit test must not try to touch it via
    cy.selectAutocomplete() either -- edit_primary_cmd must be None, not a
    command against a form input that doesn't exist. populate_count_3_3
    also drops back to 1 -- the 2-row FK-switch setup is meaningless for a
    field the UI can never edit."""
    ctx = spec_context(
        "shift", [], _server_value_primary_shift_schema({"source": "actor", "override_permission": "delete"}),
        "shift", "shift_detail", _entity("shift")["generate_config"],
    )
    assert ctx["edit_primary_cmd"] is None
    assert ctx["populate_count_3_3"] == 1
    # cmd_625b: edit_primary_cmd being None means 3.3 never touches this
    # field, so the post-save row lookup / checkField assertions must stay
    # at the as-created value (list_id_1/check_field_value_1), not the
    # "as-if-edited" letter-suffixed value (list_id_updated/check_field_updated
    # would otherwise compute as if a selectAutocomplete had run). Before this
    # fix, spec_context computed list_id_updated/check_field_updated
    # unconditionally whenever prim_is_fk, regardless of edit_primary_cmd
    # being None -- leave_request's generated 3.3 test asserted 'Test User A'
    # after an edit that never changed the User field, which stayed
    # 'Test User 0_1' (caught via PR#47 CI, cmd_625).
    assert ctx["list_id_updated"] == ctx["list_id_1"]
    assert ctx["check_field_updated"] == ctx["check_field_value_1"]


def test_spec_context_non_server_value_primary_field_still_gets_edit_primary_cmd():
    """Sanity check (pre-fix baseline behavior, unaffected): a primary FK to
    user with no x-server-value still gets the selectAutocomplete
    edit_primary_cmd and populate_count_3_3 == 2."""
    ctx = spec_context(
        "shift", [], _server_value_primary_shift_schema(None), "shift", "shift_detail",
        _entity("shift")["generate_config"],
    )
    # cmd_618: base instance is now letter-indexed ('Test User A').
    assert ctx["edit_primary_cmd"] == "        cy.selectAutocomplete('User', 'Test User A');"
    assert ctx["populate_count_3_3"] == 2


def test_seed_relation_label_value_is_user_account_excludes_callindex_prefix():
    """cmd_625b/625g: is_user_account (target=='user') FK targets are excluded
    from Phase2's callIndex namespace on the CREATION side --
    test_helper.ts.jinja2's primary_fk_dep.is_user_account branch always
    creates `Test User ${i}` (plain per-call loop index), never
    `${callIndex}_${i}`. Before this fix, the ASSERTION side
    (_seed_relation_label_value / _seed_path_part) didn't know this and
    unconditionally applied the callIndex-prefixed `0_{unique_index}` format
    to every primary FK, including is_user_account ones -- so every
    populate{Pascal}Data/FullData-backed row's label assertion looked for
    'Test User 0_1' against actual data 'Test User 1' and never found the
    row (leave_request.cy.ts 1.2/1.3/3.1/3.2/3.3/4.3/6.1, cmd_625 B-system)."""
    schema = _server_value_primary_shift_schema(None)
    assert _seed_relation_label_value("user", "name", False, schema, unique_index=1) == "Test User 1"
    assert _seed_relation_label_value("user", "name", False, schema, unique_index=2) == "Test User 2"
    # No unique_index (letter-suffixed base instance) is unaffected either way.
    assert _seed_relation_label_value("user", "name", False, schema) == "Test User A"


def test_seed_relation_label_value_non_user_target_keeps_callindex_prefix():
    """Sanity check (pre-fix baseline behavior, unaffected): a non-user FK
    target keeps the callIndex-prefixed `0_{unique_index}` format."""
    schema = _schema()
    assert _seed_relation_label_value("patient", "name", False, schema, unique_index=1) == "Test Patient 0_1"


def test_spec_context_is_user_account_primary_label_excludes_callindex_prefix():
    """spec_context-level regression for the same fix: leave_request's exact
    shape (primary FK to user) must compute list_id_1 / check_field_value_1
    as 'Test User 1', not 'Test User 0_1' -- matching the actual seed data
    test_helper.ts.jinja2 creates for is_user_account primary FKs."""
    ctx = spec_context(
        "shift", [], _server_value_primary_shift_schema(None), "shift", "shift_detail",
        _entity("shift")["generate_config"],
    )
    assert ctx["list_id_1"] == "Test User 1"
    assert ctx["check_field_value_1"] == "Test User 1"
