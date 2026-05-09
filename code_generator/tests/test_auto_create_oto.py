"""
Regression tests for auto-create OTO bridge handling
(`approvable` and `commentable` patterns).

Background
----------
A parent entity can carry a `one-to-one_bridge` FK whose target is a bridge
model created automatically when the parent is created (commentable /
approvable). These bridges differ from selector OTOs (`one-to-one`):

- No picker UI — the user never selects an existing bridge row
- No `XxxOption` type, no `initialXxxs` / `searchXxxOptions` props
- The bridge type is emitted inline (with its nested children) — no
  `import type { Xxx } from '@/lib/xxx/types'` because bridge models do not
  have their own generated module

These tests pin the contract so a bridge OTO cannot regress into being
treated as a regular many-to-one or selector OTO.
"""
import pytest
from build_context import build_context
from context import build_entity_context
from generators import form_upsert_context
from helpers.schema_helpers import get_one_to_one_rels, get_parent_relationships


# ---------------------------------------------------------------------------
# Schema fixtures
# ---------------------------------------------------------------------------

def _entity(model: str) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": True, "fields": None,
        },
    }


def _commentable_schema() -> dict:
    """db_table-style schema: parent has commentable_id one-to-one to commentable bridge."""
    return {
        "definitions": {
            "comment": {
                "type": "object",
                "required": ["id", "message", "commentable_id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "message": {"type": "string", "minLength": 1},
                    "commentable_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "many-to-one",
                            "target": "commentable",
                            "labelField": "id",
                        },
                    },
                },
            },
            "commentable": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                },
            },
            "commentable_detail": {
                "x-generate": {
                    "list": False, "view": False, "new": False, "edit": False,
                    "delete": False, "api": False, "test": False,
                },
                "allOf": [
                    {"$ref": "#/definitions/commentable"},
                    {
                        "type": "object",
                        "required": ["comments"],
                        "properties": {
                            "comments": {
                                "type": "array",
                                "x-outputType": "comments",
                                "items": {"$ref": "#/definitions/comment"},
                            },
                        },
                    },
                ],
            },
            "db_table": {
                "type": "object",
                "required": ["id", "name", "commentable_id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string", "minLength": 1},
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
            "db_table_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": True,
                },
                "allOf": [
                    {"$ref": "#/definitions/db_table"},
                    {
                        "type": "object",
                        "properties": {
                            "commentable": {"$ref": "#/definitions/commentable"},
                        },
                    },
                ],
            },
        }
    }


def _approvable_schema() -> dict:
    """leave_request-style schema: parent has approvable_id one-to-one to approvable bridge."""
    return {
        "definitions": {
            "approval_flow": {
                "type": "object",
                "required": ["id", "entity_name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "entity_name": {"type": "string"},
                },
            },
            "approval_flow_detail": {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": True, "test": True},
                "allOf": [{"$ref": "#/definitions/approval_flow"}],
            },
            "approval_request": {
                "type": "object",
                "required": ["id", "approvable_id", "approval_flow_id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "approvable_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "many-to-one", "target": "approvable", "labelField": "id",
                        },
                    },
                    "approval_flow_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "many-to-one", "target": "approval_flow",
                            "labelField": "entity_name",
                        },
                    },
                    "status": {"type": "integer", "enum": [0, 1, 2]},
                },
            },
            "approvable": {
                "type": "object",
                "required": ["id"],
                "properties": {"id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}},
            },
            "approvable_detail": {
                "x-generate": {
                    "list": False, "view": False, "new": False, "edit": False,
                    "delete": False, "api": False, "test": False,
                },
                "allOf": [
                    {"$ref": "#/definitions/approvable"},
                    {
                        "type": "object",
                        "required": ["approval_requests"],
                        "properties": {
                            "approval_requests": {
                                "type": "array",
                                "x-outputType": "list",
                                "items": {"$ref": "#/definitions/approval_request"},
                            },
                        },
                    },
                ],
            },
            "leave_request": {
                "type": "object",
                "required": ["id", "approvable_id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "approvable_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "one-to-one_bridge", "target": "approvable", "labelField": "id",
                        },
                    },
                },
            },
            "leave_request_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": True,
                },
                "allOf": [
                    {"$ref": "#/definitions/leave_request"},
                    {
                        "type": "object",
                        "properties": {
                            "approvable": {"$ref": "#/definitions/approvable"},
                        },
                    },
                ],
            },
        }
    }


# ---------------------------------------------------------------------------
# build_context — auto-create OTO segregation
# ---------------------------------------------------------------------------

class TestAutoCreateOTOSegregation:
    """The bridge FK must NOT leak into parent_rels_raw / parent_rels — those
    are reserved for many-to-one and selector OTO. Leaking caused duplicate
    fields, duplicate includes, and bogus option props."""

    def test_commentable_fk_not_in_parent_rels(self):
        ctx = build_context(_entity("db_table"), _commentable_schema())
        assert all(r["prop_name"] != "commentable_id" for r in ctx["parent_rels"]), \
            "commentable_id must be handled via auto_create_oto_rels, not parent_rels"
        assert all(r["target"] != "commentable" for r in ctx["parent_rels"])

    def test_commentable_in_auto_create_oto_rels(self):
        ctx = build_context(_entity("db_table"), _commentable_schema())
        targets = [r["target"] for r in ctx["one_to_one_rels"]]
        assert "commentable" in targets

    def test_commentable_not_in_selector_oto_rels(self):
        """commentable is auto-create, not a selector — no picker UI."""
        ctx = build_context(_entity("db_table"), _commentable_schema())
        assert all(r["target"] != "commentable" for r in ctx["selector_oto_rels"])

    def test_approvable_fk_not_in_parent_rels(self):
        ctx = build_context(_entity("leave_request"), _approvable_schema())
        assert all(r["prop_name"] != "approvable_id" for r in ctx["parent_rels"]), \
            "approvable_id must be handled via auto_create_oto_rels, not parent_rels"
        assert all(r["target"] != "approvable" for r in ctx["parent_rels"])

    def test_approvable_in_auto_create_oto_rels(self):
        ctx = build_context(_entity("leave_request"), _approvable_schema())
        targets = [r["target"] for r in ctx["one_to_one_rels"]]
        assert "approvable" in targets


# ---------------------------------------------------------------------------
# build_context — bridge pre-create + include + service params
# ---------------------------------------------------------------------------

class TestAutoCreateOTOServiceLayer:
    """The service-layer wiring (transaction pre-create, include clause,
    parent_data_obj) must be emitted exactly once for each bridge."""

    def test_commentable_pre_create_emitted_once(self):
        ctx = build_context(_entity("db_table"), _commentable_schema())
        # Bridge is pre-created in the create transaction
        assert ctx["one_to_one_pre_creates"].count("tx.commentable.create") == 1
        # FK is wired from bridge.id
        assert "commentable_id: commentable.id" in ctx["parent_data_obj"]

    def test_commentable_fk_excluded_from_service_params(self):
        """commentable_id is auto-populated → must not be a service argument."""
        ctx = build_context(_entity("db_table"), _commentable_schema())
        assert "commentable_id" not in ctx["parent_params_with_types"]

    def test_commentable_include_emitted_once(self):
        """`commentable: { include: { comments: ... } }` is emitted exactly once
        and the bare `commentable: true` (the m2o-style include) is NOT also
        emitted alongside it."""
        ctx = build_context(_entity("db_table"), _commentable_schema())
        include_block = ctx["include_props_detail"]
        # Should include the nested comments shape exactly once
        assert include_block.count("commentable:") == 1
        # And must not also contain the duplicate bare `commentable: true`
        # form that the bug produced.
        assert "commentable: true" not in include_block

    def test_approvable_pre_create_emitted_once(self):
        ctx = build_context(_entity("leave_request"), _approvable_schema())
        assert ctx["one_to_one_pre_creates"].count("tx.approvable.create") == 1
        assert "approvable_id: approvable.id" in ctx["parent_data_obj"]

    def test_approvable_fk_excluded_from_service_params(self):
        ctx = build_context(_entity("leave_request"), _approvable_schema())
        assert "approvable_id" not in ctx["parent_params_with_types"]

    def test_approvable_include_emitted_once(self):
        ctx = build_context(_entity("leave_request"), _approvable_schema())
        include_block = ctx["include_props_detail"]
        assert include_block.count("approvable:") == 1
        assert "approvable: true" not in include_block


# ---------------------------------------------------------------------------
# context.build_entity_context — types.ts surface
# ---------------------------------------------------------------------------

class TestAutoCreateOTOTypesContext:
    """The types-template context drives lib/<entity>/types.ts. The bridge
    must appear inline (one_to_one_rels), not as an external import or m2o
    parent_rel. No `XxxOption` and no `initialXxxs` / `searchXxxOptions`."""

    def test_commentable_not_in_imports(self):
        """No `import type { Commentable } from '@/lib/commentable/types'` —
        commentable has no generated module."""
        ec = build_entity_context(_entity("db_table"), _commentable_schema())
        assert "commentable" not in ec.import_targets

    def test_commentable_not_in_parent_rels(self):
        ec = build_entity_context(_entity("db_table"), _commentable_schema())
        assert all(r.target != "commentable" for r in ec.parent_rels)

    def test_commentable_in_one_to_one_rels(self):
        ec = build_entity_context(_entity("db_table"), _commentable_schema())
        assert any(r.target == "commentable" for r in ec.one_to_one_rels)

    def test_no_commentable_option_type(self):
        """`CommentableOption` would also be a duplicate-id type since the
        commentable bridge only has `id` as a field. Don't emit it at all."""
        ec = build_entity_context(_entity("db_table"), _commentable_schema())
        assert all(o.target != "commentable" for o in ec.option_types)

    def test_commentable_not_in_all_option_targets(self):
        """No initialCommentables / searchCommentableOptions in FormUpsertProps."""
        ec = build_entity_context(_entity("db_table"), _commentable_schema())
        assert "commentable" not in ec.all_option_targets

    def test_commentable_id_not_in_form_view_fields(self):
        """The bridge FK is internal — never shown as a form/view field."""
        ec = build_entity_context(_entity("db_table"), _commentable_schema())
        assert all(f.name != "commentable_id" for f in ec.form_view_fields)

    def test_approvable_not_in_imports(self):
        ec = build_entity_context(_entity("leave_request"), _approvable_schema())
        assert "approvable" not in ec.import_targets

    def test_approvable_not_in_parent_rels(self):
        ec = build_entity_context(_entity("leave_request"), _approvable_schema())
        assert all(r.target != "approvable" for r in ec.parent_rels)

    def test_approvable_in_one_to_one_rels(self):
        ec = build_entity_context(_entity("leave_request"), _approvable_schema())
        assert any(r.target == "approvable" for r in ec.one_to_one_rels)

    def test_no_approvable_option_type(self):
        ec = build_entity_context(_entity("leave_request"), _approvable_schema())
        assert all(o.target != "approvable" for o in ec.option_types)

    def test_approvable_not_in_all_option_targets(self):
        ec = build_entity_context(_entity("leave_request"), _approvable_schema())
        assert "approvable" not in ec.all_option_targets

    def test_approvable_id_not_in_form_view_fields(self):
        ec = build_entity_context(_entity("leave_request"), _approvable_schema())
        assert all(f.name != "approvable_id" for f in ec.form_view_fields)


# ---------------------------------------------------------------------------
# generators.form_upsert_context — FormUpsert component surface
# ---------------------------------------------------------------------------

class TestAutoCreateOTOFormUpsert:
    """FormUpsert must NOT destructure / use a picker for the bridge FK."""

    def _ctx(self, entity_name: str, schema: dict) -> dict:
        ctx = build_context(_entity(entity_name), schema)
        return form_upsert_context(ctx, schema)

    def test_no_initial_commentables_in_params(self):
        ctx = self._ctx("db_table", _commentable_schema())
        assert "initialCommentables" not in ctx["form_upsert_params"]
        assert "searchCommentableOptions" not in ctx["form_upsert_params"]

    def test_no_commentable_rel_opt_setup(self):
        """No EntityAutocomplete options/search wiring for commentable."""
        ctx = self._ctx("db_table", _commentable_schema())
        assert "searchCommentableOptions" not in ctx["rel_opt_setups"]
        assert "initialCommentables" not in ctx["rel_opt_setups"]

    def test_no_initial_approvables_in_params(self):
        ctx = self._ctx("leave_request", _approvable_schema())
        assert "initialApprovables" not in ctx["form_upsert_params"]
        assert "searchApprovableOptions" not in ctx["form_upsert_params"]

    def test_no_approvable_rel_opt_setup(self):
        ctx = self._ctx("leave_request", _approvable_schema())
        assert "searchApprovableOptions" not in ctx["rel_opt_setups"]
        assert "initialApprovables" not in ctx["rel_opt_setups"]


# ---------------------------------------------------------------------------
# helpers/schema_helpers — type-based branching contract
# ---------------------------------------------------------------------------

class TestRelationTypeBranching:
    """Pin the explicit type discriminator: `one-to-one` is always selector,
    `one-to-one_bridge` is always bridge. No `_detail.x-generate` heuristic."""

    def _bridge_def(self) -> dict:
        return {
            "properties": {
                "id": {"type": "string"},
                "commentable_id": {
                    "type": "string",
                    "x-relationship": {
                        "type": "one-to-one_bridge",
                        "target": "commentable",
                        "labelField": "id",
                    },
                },
            }
        }

    def _selector_def(self) -> dict:
        return {
            "properties": {
                "id": {"type": "string"},
                "checkup_id": {
                    "type": "string",
                    "x-relationship": {
                        "type": "one-to-one",
                        "target": "checkup",
                        "labelField": "checkup_date",
                    },
                },
            }
        }

    def _schema(self) -> dict:
        # Note the absence of `x-generate` on the bridge target's _detail —
        # the old code path required this heuristic; the new code path does
        # not. Selector target also has no `x-generate` here for symmetry.
        return {
            "definitions": {
                "commentable": {"type": "object", "required": ["id"]},
                "commentable_detail": {
                    "allOf": [
                        {"$ref": "#/definitions/commentable"},
                        {"type": "object", "properties": {
                            "comments": {
                                "type": "array",
                                "x-outputType": "comments",
                                "items": {"$ref": "#/definitions/comment"},
                            },
                        }},
                    ],
                },
                "comment": {"type": "object", "required": ["id"]},
                "checkup": {"type": "object", "required": ["id"]},
                "checkup_detail": {"allOf": [{"$ref": "#/definitions/checkup"}]},
            }
        }

    def test_bridge_oto_is_not_selector(self):
        rels = get_one_to_one_rels(self._bridge_def(), self._schema())
        assert len(rels) == 1
        assert rels[0]["relation_type"] == "one-to-one_bridge"
        assert rels[0]["is_selector"] is False

    def test_bridge_oto_collects_target_children(self):
        """Bridge OTO populates `children` from the target's _detail (e.g. comments)."""
        rels = get_one_to_one_rels(self._bridge_def(), self._schema())
        children = rels[0]["children"]
        assert any(c["child_name"] == "comment" for c in children)

    def test_selector_oto_is_selector(self):
        rels = get_one_to_one_rels(self._selector_def(), self._schema())
        assert len(rels) == 1
        assert rels[0]["relation_type"] == "one-to-one"
        assert rels[0]["is_selector"] is True

    def test_selector_oto_does_not_collect_children(self):
        """Selector OTO leaves `children` empty — its target uses regular pages."""
        rels = get_one_to_one_rels(self._selector_def(), self._schema())
        assert rels[0]["children"] == []

    def test_bridge_oto_excluded_from_get_parent_relationships(self):
        """`get_parent_relationships` returns m2o + selector-OTO only — never bridge OTO."""
        rels = get_parent_relationships(self._bridge_def(), self._schema())
        assert all(r["target"] != "commentable" for r in rels)

    def test_selector_oto_included_in_get_parent_relationships(self):
        """Selector OTO is exposed by get_parent_relationships so it can be
        re-injected as an m2o-shaped picker entry."""
        rels = get_parent_relationships(self._selector_def(), self._schema())
        assert any(r["target"] == "checkup" for r in rels)


class TestSelectorWithBridgeCoexistence:
    """A single entity carrying BOTH a selector OTO and a bridge OTO must
    generate non-conflicting context: each goes through its own pipeline."""

    def _schema(self) -> dict:
        return {
            "definitions": {
                "checkup": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                },
                "checkup_detail": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": True, "test": True},
                    "allOf": [{"$ref": "#/definitions/checkup"}],
                },
                "comment": {
                    "type": "object",
                    "required": ["id", "message", "commentable_id"],
                    "properties": {
                        "id": {"type": "string"},
                        "message": {"type": "string"},
                        "commentable_id": {
                            "type": "string",
                            "x-relationship": {
                                "type": "many-to-one",
                                "target": "commentable",
                                "labelField": "id",
                            },
                        },
                    },
                },
                "commentable": {
                    "type": "object",
                    "required": ["id"],
                    "properties": {"id": {"type": "string"}},
                },
                "commentable_detail": {
                    "allOf": [
                        {"$ref": "#/definitions/commentable"},
                        {"type": "object", "properties": {
                            "comments": {
                                "type": "array",
                                "x-outputType": "comments",
                                "items": {"$ref": "#/definitions/comment"},
                            },
                        }},
                    ],
                },
                "report": {
                    "type": "object",
                    "required": ["id", "checkup_id", "commentable_id"],
                    "properties": {
                        "id": {"type": "string"},
                        "checkup_id": {
                            "type": "string",
                            "x-relationship": {
                                "type": "one-to-one", "target": "checkup", "labelField": "name",
                            },
                        },
                        "commentable_id": {
                            "type": "string",
                            "x-relationship": {
                                "type": "one-to-one_bridge", "target": "commentable", "labelField": "id",
                            },
                        },
                    },
                },
                "report_detail": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": True, "test": True},
                    "allOf": [
                        {"$ref": "#/definitions/report"},
                        {"type": "object", "properties": {
                            "commentable": {"$ref": "#/definitions/commentable"},
                        }},
                    ],
                },
            }
        }

    def test_selector_in_selector_oto_rels_only(self):
        ctx = build_context(_entity("report"), self._schema())
        assert any(r["target"] == "checkup" for r in ctx["selector_oto_rels"])
        assert all(r["target"] != "checkup" for r in ctx["one_to_one_rels"])

    def test_bridge_in_one_to_one_rels_only(self):
        ctx = build_context(_entity("report"), self._schema())
        assert any(r["target"] == "commentable" for r in ctx["one_to_one_rels"])
        assert all(r["target"] != "commentable" for r in ctx["selector_oto_rels"])

    def test_bridge_pre_create_emitted_only_for_bridge(self):
        ctx = build_context(_entity("report"), self._schema())
        assert "tx.commentable.create" in ctx["one_to_one_pre_creates"]
        assert "tx.checkup.create" not in ctx["one_to_one_pre_creates"]

    def test_selector_fk_kept_as_service_param_bridge_fk_dropped(self):
        ctx = build_context(_entity("report"), self._schema())
        # Selector OTO FK is still a service argument (the picker provides it).
        # The TS variable name is camelCased — `checkup_id` → `checkupId`.
        assert "checkupId" in ctx["parent_params_with_types"]
        # Bridge OTO FK is auto-populated → dropped from service params
        assert "commentableId" not in ctx["parent_params_with_types"]
        assert "commentable_id" not in ctx["parent_params_with_types"]
