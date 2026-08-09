"""
Regression test: approval_flow's self-referential preceded_by/followed_by
dep records must use the SAME x-entity-select value (entity_name) as the
primary create test, not a different one.

lib/approval_flow/autocomplete_filter.ts (hand-written, GENERATED ONCE)
narrows preceded_by/followed_by candidates to the same entity_name as the
record being edited — a real business rule (an approval_flow row's
predecessor/successor is only meaningful within one entity_name's approval
chain). populateApprovalFlowDependencies() used to build precededBy/
followedBy with a DIFFERENT entity_name than the primary record (picking the
second x-entity-select option, originally to dodge a hypothetical P2002 on a
compound unique key shared with another dep FK). That divergence made every
self-ref dep invisible to the business filter, so approval_flow.cy.ts 3.1
("adds optional data and child items") always got zero autocomplete
candidates when adding a Preceded By / Followed By item.

The fix keeps the collision-avoidance guarantee (self-ref deps sharing a
required FK still resolve to distinct FK rows via the '{var}2' needs_second
split) while making the x-entity-select value itself match the primary
record.
"""
from pathlib import Path

import pytest
from ruamel.yaml import YAML

from build_user_schema import build_user_schema
from generate_types import extract_entities
from generators_test import helper_context

SCHEMA_PATH = Path(__file__).parent.parent / "json_schema.yaml"
PRISMA_SCHEMA_PATH = Path(__file__).parent.parent.parent / "prisma" / "schema.prisma"
REPO_ROOT = SCHEMA_PATH.parent.parent
PRJ_SYNC_SIBLING = REPO_ROOT.parent / "prj"


def _fail_if_prj_synced_tree():
    if PRJ_SYNC_SIBLING.is_dir():
        pytest.fail(
            f"Refusing to run: {PRJ_SYNC_SIBLING} exists, meaning `npm run "
            "prj:sync` would overlay a consumer's schema onto "
            "code_generator/json_schema.yaml / prisma/schema.prisma. This "
            "test asserts an invariant about the framework's OWN default "
            "schema's approval_flow entity. Run pytest from a tree with no "
            "sibling `prj/` directory (e.g. the standalone app-generator "
            "checkout, as CI does)."
        )


def _load_intermediate_schema(tmp_path):
    _fail_if_prj_synced_tree()
    out_path = tmp_path / ".generated" / "json_schema.yaml"
    build_user_schema(SCHEMA_PATH, PRISMA_SCHEMA_PATH, out_path)
    yaml = YAML(typ="safe")
    with out_path.open(encoding="utf-8") as f:
        return yaml.load(f)


def _approval_flow_self_ref_deps(tmp_path):
    schema = _load_intermediate_schema(tmp_path)
    entities = extract_entities(schema)
    af = next(e for e in entities if e["parent"] == "approval_flow")
    ctx = helper_context(
        af["parent"], af["children"], schema, af["model"], af["definition_key"],
        af["generate_config"],
    )
    self_ref = {d["var_name"]: d for d in ctx["deps"] if d["target"] == "approval_flow"}
    assert set(self_ref) == {"precededBy", "followedBy"}, (
        f"fixture drifted from the expected approval_flow shape — got self-ref "
        f"deps {sorted(self_ref)}, expected precededBy/followedBy"
    )
    return schema, self_ref


def _entity_name_field(dep):
    return next(f for f in dep["extra_required_fields"] if f["prop_name"] == "entity_name")


class TestApprovalFlowSelfRefEntityName:
    def test_self_ref_deps_match_primary_entity_name(self, tmp_path):
        from build_context import _get_entity_options

        schema, self_ref = _approval_flow_self_ref_deps(tmp_path)
        primary_val = f"'{_get_entity_options(schema)[0]['value']}'"
        for var_name, dep in self_ref.items():
            field = _entity_name_field(dep)
            assert field["prisma_val"] == primary_val, (
                f"{var_name}.entity_name prisma_val ({field['prisma_val']}) must "
                f"match the primary record's entity_name ({primary_val}) or "
                "autocomplete_filter.ts's entity_name narrowing hides this dep "
                "from every candidate list (approval_flow.cy.ts 3.1)"
            )
            assert field["prisma_val_unique"] == primary_val
            assert field["prisma_val_second"] == primary_val

    def test_self_ref_deps_still_avoid_fk_collision_with_each_other(self, tmp_path):
        _, self_ref = _approval_flow_self_ref_deps(tmp_path)
        preceded_fk = {fk["prop_name"]: fk["dep_var_name"] for fk in self_ref["precededBy"]["fk_deps"]}
        followed_fk = {fk["prop_name"]: fk["dep_var_name"] for fk in self_ref["followedBy"]["fk_deps"]}
        assert preceded_fk == {"approver_role_id": "approverRole"}
        assert followed_fk == {"approver_role_id": "approverRole2"}, (
            "precededBy/followedBy must still resolve to DIFFERENT approver_role "
            "fk_dep instances (the needs_second '2' split) — matching entity_name "
            "must not reintroduce the P2002 this mechanism guards against"
        )
