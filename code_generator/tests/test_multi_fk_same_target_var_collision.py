"""
Regression tests for subtask_747b: multiple FK fields on the same entity
pointing at the SAME target model (e.g. claim.insured_party_id and
claim.insurer_party_id, both -> party) is a valid business schema — the test
generator, not the schema, was wrong to collapse them onto one dep variable.

helper_context() already had the correct fix (commit 4d6eca2a) via an inline
same-target-FK split block. This suite covers two remaining call sites that
did NOT have it, both confirmed live-broken on develop tip via a pre-fix
manual repro (rendering the real jinja2 templates for a synthetic
claim-with-two-party-FK schema) before this change:

  1. api_spec_context() never split at all, so the API-spec POST/PUT body
     wired BOTH insured_party_id and insurer_party_id to the SAME created
     `party` record instead of two distinct ones — silent data-correctness
     bug, not a crash.
  2. spec_context()'s three "fail create" sections (5.1 skip-one-required,
     5.2 missing-scalar-child-field, 5.3 missing-FK-child-field) called
     gen_fill_commands() without the fk_dep_vars argument, so their
     autocomplete fill commands fell back to gen_fill_commands()'s
     to_camel_case(dep_target) default ('party') instead of the actual
     prop-stem dep var name ('insuredParty'/'insurerParty') that
     helper_context's split produces — a reference to a dep object that does
     not exist in the rendered spec's `deps`.

The fix extracts helper_context's inline split logic into a shared
split_same_target_fk_deps() and calls it from api_spec_context() too; the
three spec_context() call sites now pass the already-correct fk_dep_vars
dict spec_context() builds (prop-stem-based for every FK, not just
same-target ones) that they previously omitted.

Per the injected-fixture verification convention: render the actual jinja2
templates, don't just assert context dicts look right.
"""
import os

from jinja2 import Environment, FileSystemLoader

from generators_test import (
    api_spec_context,
    helper_context,
    spec_context,
    split_same_target_fk_deps,
)
from helpers.naming import to_camel_case, to_pascal_case

_GEN_CFG = {
    'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True,
    'api': True, 'test': True, 'fields': None,
}


def _template_env() -> Environment:
    template_dir = os.path.join(os.path.dirname(__file__), '..', 'templates')
    env = Environment(
        loader=FileSystemLoader(template_dir),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env


def _party_def() -> dict:
    return {
        'type': 'object',
        'required': ['id', 'name'],
        'properties': {
            'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
            'name': {'type': 'string'},
        },
    }


def _claim_def(multi_fk: bool) -> dict:
    properties = {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
        'insured_party_id': {
            'type': 'string',
            'x-relationship': {'type': 'many-to-one', 'target': 'party', 'labelField': 'name'},
        },
    }
    required = ['id', 'insured_party_id']
    if multi_fk:
        properties['insurer_party_id'] = {
            'type': 'string',
            'x-relationship': {'type': 'many-to-one', 'target': 'party', 'labelField': 'name'},
        }
        required.append('insurer_party_id')
    return {'type': 'object', 'required': required, 'properties': properties}


def _schema(multi_fk: bool) -> dict:
    return {
        'definitions': {
            'party': _party_def(),
            'claim': _claim_def(multi_fk),
            'claim_detail': {'allOf': [{'$ref': '#/definitions/claim'}]},
        },
    }


class TestSplitSameTargetFkDepsDirect:
    """Unit-level tests of the extracted shared function."""

    def test_multi_fk_same_target_splits_into_prop_stem_deps(self):
        schema = _schema(multi_fk=True)
        from generators_test import resolve_dependencies, get_entity_fk_deps, get_parent_relationships
        from build_context import _raw_def
        model_def = _raw_def('claim', schema)
        relationships = get_parent_relationships(model_def, schema)
        deps = resolve_dependencies('claim', schema)
        entity_fk_deps = get_entity_fk_deps('claim', schema, deps)
        # Pre-split: both FKs collapse onto the single 'party' dep.
        assert [d['var_name'] for d in deps] == ['party']
        assert {d['dep_var_name'] for d in entity_fk_deps} == {'party'}

        split_deps, split_fk_deps, _, multi_fk_targets = split_same_target_fk_deps(
            'claim', relationships, deps, entity_fk_deps,
        )
        assert 'party' in multi_fk_targets
        assert sorted(d['var_name'] for d in split_deps) == ['insuredParty', 'insurerParty']
        assert {d['dep_var_name'] for d in split_fk_deps} == {'insuredParty', 'insurerParty'}
        assert next(d['dep_var_name'] for d in split_fk_deps if d['prop_name'] == 'insured_party_id') == 'insuredParty'
        assert next(d['dep_var_name'] for d in split_fk_deps if d['prop_name'] == 'insurer_party_id') == 'insurerParty'

    def test_single_fk_no_op(self):
        """No-regression guard: a single FK to a target is left untouched
        (still uses the bare target-name var, e.g. 'party' not 'insuredParty')."""
        schema = _schema(multi_fk=False)
        from generators_test import resolve_dependencies, get_entity_fk_deps, get_parent_relationships
        from build_context import _raw_def
        model_def = _raw_def('claim', schema)
        relationships = get_parent_relationships(model_def, schema)
        deps = resolve_dependencies('claim', schema)
        entity_fk_deps = get_entity_fk_deps('claim', schema, deps)
        split_deps, split_fk_deps, _, multi_fk_targets = split_same_target_fk_deps(
            'claim', relationships, deps, entity_fk_deps,
        )
        assert multi_fk_targets == {}
        assert split_deps == deps
        assert split_fk_deps == entity_fk_deps


class TestHelperContextMultiFk:
    def test_context_produces_prop_stem_deps(self):
        ctx = helper_context('claim', [], _schema(multi_fk=True), 'claim', 'claim_detail', _GEN_CFG)
        assert sorted(d['var_name'] for d in ctx['deps']) == ['insuredParty', 'insurerParty']

    def test_rendered_helper_has_no_duplicate_dep_declaration(self):
        ctx = helper_context('claim', [], _schema(multi_fk=True), 'claim', 'claim_detail', _GEN_CFG)
        tmpl = _template_env().get_template('test_helper.ts.jinja2')
        code = tmpl.render(**ctx)
        assert code.count('const party') == 0
        assert 'const insuredParty' in code
        assert 'const insurerParty' in code


class TestApiSpecContextMultiFk:
    def test_rendered_post_body_wires_distinct_records_not_same_one(self):
        """Pre-fix, both FK columns rendered `deps.party.id` — i.e. both
        wired to the SAME created record. Confirm they now reference two
        distinct dep vars."""
        ctx = api_spec_context('claim', [], _schema(multi_fk=True), 'claim', 'claim_detail', _GEN_CFG)
        post_body = '\n'.join(ctx['post_body_create'])
        assert 'insured_party_id: deps.insuredParty.id,' in post_body
        assert 'insurer_party_id: deps.insurerParty.id,' in post_body
        assert 'deps.party.id' not in post_body

    def test_single_fk_no_regression(self):
        ctx = api_spec_context('claim', [], _schema(multi_fk=False), 'claim', 'claim_detail', _GEN_CFG)
        post_body = '\n'.join(ctx['post_body_create'])
        assert 'insured_party_id: deps.party.id,' in post_body


class TestSpecContextFailCreateSectionsMultiFk:
    def test_fail_create_5_1_uses_distinct_fk_dep_vars(self):
        """Pre-fix, gen_fill_commands() was called without fk_dep_vars in
        this section, so its autocomplete fallback referenced the
        non-existent bare-target dep (`deps.party`) instead of the actual
        split dep var — a reference to an undefined object in the rendered
        spec. Both required FKs must appear with their real dep vars in at
        least one of the fill command sets (5.1 skips exactly one required
        field, so this uses the full-fields render to see all of them)."""
        ctx = spec_context('claim', [], _schema(multi_fk=True), 'claim', 'claim_detail', _GEN_CFG, 0)
        all_fill_cmds = '\n'.join(ctx['all_fill_cmds'])
        assert "deps.insuredParty.name" in all_fill_cmds
        assert "deps.insurerParty.name" in all_fill_cmds
        assert 'deps.party.name' not in all_fill_cmds

        fail_create_5_1 = ctx.get('fail_create_5_1')
        assert fail_create_5_1 is not None
        fill_cmds_5_1 = '\n'.join(fail_create_5_1['fill_cmds'])
        # 5.1 skips exactly one required field, so the OTHER FK must still be
        # present and must reference its real (split) dep var, not the stale
        # to_camel_case(target) fallback ('party').
        assert 'deps.party.name' not in fill_cmds_5_1
        skipped_both = (
            'deps.insuredParty.name' not in fill_cmds_5_1
            and 'deps.insurerParty.name' not in fill_cmds_5_1
        )
        assert not skipped_both, 'fail_create_5_1 must retain at least one of the two split FK fields'

    def test_single_fk_no_regression(self):
        """spec_context's fk_dep_vars is always prop-stem based (independent
        of whether the target is shared by multiple FKs) — for the single-FK
        case here, prop_stem 'insured_party' != target 'party', so the dep
        var is 'insuredParty' both before and after this fix. This guards
        that passing fk_dep_vars into the three previously-omitted call
        sites didn't change that pre-existing behavior."""
        ctx = spec_context('claim', [], _schema(multi_fk=False), 'claim', 'claim_detail', _GEN_CFG, 0)
        all_fill_cmds = '\n'.join(ctx['all_fill_cmds'])
        assert 'deps.insuredParty.name' in all_fill_cmds
        # Only one required field (the FK itself) -> it's the one skipped, so
        # fail_create_5_1's fill_cmds end up empty rather than the section
        # being absent entirely.
        assert ctx['fail_create_5_1']['fill_cmds'] == []
