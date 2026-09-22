"""Issue #696, state-transition Stage 1 PR2b: the transition gatekeeper
(transition{{Field}}() in service.ts, assertTransitionAllowed{{Field}}() in
service_validation.ts) and its x-approval AND-composition
(state-transition-generator-design.md's 丙 composition law, Case A/B/C).

Covers:
  - derive_approval_legal_transition_edges (helpers/schema_helpers.py): the
    pure (fromState, toState) legal-edge derivation for a field also
    governed by x-approval's own submit_on -- Case A/B/C's semantic core.
    Deliberately pair-level, not value-level like Case D's own legal set
    (validate.py) -- see that function's docstring for why a values-only
    check cannot distinguish Case A's "two individually-legal values in an
    illegal combination" from a genuinely legal edge.
  - derive_write_locked_values()'s new Source 3 (x-state-machines): every
    non-initial diagram state is locked, so only transition{{Field}}() (a
    direct `tx` call bypassing this service layer) may write it.
  - build_context(): state_machine_diagrams / state_machine_field_list /
    state_machine_approval_edges flow through to template context
    correctly, and write_locked_values picks up Source 3.
  - service.ts.jinja2: transition{{Field}}() codegen, gated on can_update.
  - service_validation.ts.jinja2: assertTransitionAllowed{{Field}}()
    codegen -- diagram-edge check, x-approval AND-composition check only
    when the field is x-approval-governed, no dead code otherwise.
  - Field naming (己): a governed field named something other than
    'status' (verification_status) behaves identically -- design doc 丙's
    field-naming requirement, backed by real insurance-app evidence.

Case D (the generate-time static check rejecting a diagram edge whose
state is structurally impossible under x-approval's own declared stages)
was already implemented in PR2a-2 -- see
test_validate_state_machine_precondition.py's TestDiagramContentChecks --
and is not re-tested here; this file's own fixtures are deliberately built
so they'd also pass Case D (both endpoints of every diagram edge are
individually legal x-approval values), which is exactly what makes Case A
a check Case D's value-only logic cannot perform on its own.
"""
import pytest
from build_context import build_context
from helpers.schema_helpers import (
    derive_approval_legal_transition_edges,
    derive_write_locked_values,
)


@pytest.fixture(autouse=True)
def _sm_tmp_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)


def _write_mmd(tmp_path, rel_path, content):
    path = tmp_path / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def _widget(field_name='status', enum_values=None, default='draft', x_approval=None, edit=True):
    enum_values = enum_values or ['draft', 'submitted', 'approved', 'rejected']
    props = {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
        'code': {'type': 'string'},
        field_name: {'type': 'string', 'enum': enum_values, 'default': default},
    }
    defn = {
        'type': 'object', 'required': ['id', 'code'], 'properties': props,
        'x-import-key': ['code'],
    }
    if x_approval:
        defn['x-approval'] = x_approval
    return defn


def _entity(model='widget', edit=True):
    return {
        'parent': model, 'model': model, 'definition_key': model, 'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': edit,
            'delete': True, 'api': True, 'test': False, 'fields': None,
        },
    }


_CASE_ABC_MMD = (
    'stateDiagram-v2\n'
    '[*] --> draft\n'
    'draft --> submitted\n'
    'draft --> approved\n'
    'submitted --> rejected\n'
    'approved --> [*]\n'
    'rejected --> [*]\n'
)


def _case_abc_x_approval(terminal_rejected=True):
    """x-approval only ever moves draft(default) -> submitted -> approved,
    or submitted -> rejected. It NEVER sanctions a direct draft -> approved
    move -- the diagram above declares exactly that extra edge as a
    ('fast-track') attempt, so Case A/B/C can be exercised against one
    shared fixture:
      Case A pair (draft, approved):  diagram permits, x-approval forbids.
      Case B pair (submitted, approved): diagram forbids (no such edge
        above), x-approval would permit (on_approved's own edge).
      Case C pair (draft, submitted): both permit.
    """
    return {
        'submit_on': {'status': 'submitted'},
        'on_approved': {'set_fields': {'status': 'approved'}},
        'on_rejected': {'set_fields': {'status': 'rejected'}, 'terminal': terminal_rejected},
    }


def _schema(field_name='status', x_approval=None, mmd_path='sm/widget_status.mmd', edit=True):
    return {
        'definitions': {'widget': _widget(field_name=field_name, x_approval=x_approval, edit=edit)},
        'x-state-machines': {f'widget.{field_name}': mmd_path},
    }


# ---------------------------------------------------------------------------
# derive_approval_legal_transition_edges (helpers/schema_helpers.py)
# ---------------------------------------------------------------------------

class TestDeriveApprovalLegalTransitionEdges:
    def test_no_x_approval_returns_none(self):
        model_def = {'properties': {'status': {'type': 'string', 'enum': ['draft', 'submitted']}}}
        assert derive_approval_legal_transition_edges(model_def, 'status') is None

    def test_field_not_governed_by_submit_on_returns_none(self):
        """x-approval exists on this entity, but its submit_on governs a
        DIFFERENT field than the one asked about -- field-scoped
        independence (design doc 丙): an x-approval entity may govern a
        field a diagram never touches."""
        model_def = {
            'properties': {
                'status': {'type': 'string', 'enum': ['draft', 'submitted']},
                'kyc_status': {'type': 'string', 'enum': ['pending', 'verified']},
            },
            'x-approval': {'submit_on': {'status': 'submitted'}},
        }
        assert derive_approval_legal_transition_edges(model_def, 'kyc_status') is None

    def test_submit_approve_reject_edges_with_terminal_rejection(self):
        model_def = _widget(x_approval=_case_abc_x_approval(terminal_rejected=True))
        edges = derive_approval_legal_transition_edges(model_def, 'status')
        assert edges == {
            ('draft', 'submitted'),
            ('submitted', 'approved'),
            ('submitted', 'rejected'),
        }

    def test_non_terminal_rejection_adds_resubmission_edge(self):
        """846b: a non-terminal rejection leaves the ordinary edit path
        (including resubmission back to submit_on's value) open."""
        model_def = _widget(x_approval=_case_abc_x_approval(terminal_rejected=False))
        edges = derive_approval_legal_transition_edges(model_def, 'status')
        assert ('rejected', 'submitted') in edges
        assert ('draft', 'submitted') in edges
        assert ('submitted', 'approved') in edges
        assert ('submitted', 'rejected') in edges

    def test_no_default_value_skips_submission_edge(self):
        model_def = _widget(default=None, x_approval=_case_abc_x_approval())
        del model_def['properties']['status']['default']
        edges = derive_approval_legal_transition_edges(model_def, 'status')
        assert ('draft', 'submitted') not in edges
        assert ('submitted', 'approved') in edges

    def test_case_a_pair_not_in_legal_edges(self):
        """The single most important case (design doc 丙): x-approval's own
        legal-transition set must NOT contain a direct draft->approved
        pair, even though both 'draft' and 'approved' are individually
        legal x-approval values."""
        model_def = _widget(x_approval=_case_abc_x_approval())
        edges = derive_approval_legal_transition_edges(model_def, 'status')
        assert ('draft', 'approved') not in edges


# ---------------------------------------------------------------------------
# derive_write_locked_values(): new Source 3 (x-state-machines)
# ---------------------------------------------------------------------------

class TestDeriveWriteLockedValuesSource3:
    def _model_def(self):
        return {
            'properties': {'status': {'type': 'string', 'enum': ['draft', 'submitted', 'approved', 'rejected']}},
        }

    def test_none_diagrams_behaves_like_before(self):
        assert derive_write_locked_values(self._model_def(), None) == {}
        assert derive_write_locked_values(self._model_def()) == {}

    def test_locks_all_non_initial_states(self):
        diagrams = {'status': {'states': ['draft', 'submitted', 'approved'], 'initial_states': ['draft']}}
        locked = derive_write_locked_values(self._model_def(), diagrams)
        assert set(locked['status']) == {'submitted', 'approved'}
        assert 'draft' not in locked['status']

    def test_multiple_initial_states_all_excluded(self):
        diagrams = {'status': {'states': ['a', 'b', 'c'], 'initial_states': ['a', 'b']}}
        locked = derive_write_locked_values(self._model_def(), diagrams)
        assert locked['status'] == ['c']

    def test_union_with_x_approval_source_1(self):
        """A field governed by BOTH x-approval and a state machine gets the
        union of both sources' locked values -- neither replaces the
        other."""
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['draft', 'submitted', 'approved', 'rejected', 'archived']}},
            'x-approval': {'on_approved': {'set_fields': {'status': 'approved'}}},
        }
        diagrams = {'status': {'states': ['draft', 'archived'], 'initial_states': ['draft']}}
        locked = derive_write_locked_values(model_def, diagrams)
        assert set(locked['status']) == {'approved', 'archived'}

    def test_duplicate_value_not_repeated_across_sources(self):
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['draft', 'approved']}},
            'x-approval': {'on_approved': {'set_fields': {'status': 'approved'}}},
        }
        diagrams = {'status': {'states': ['draft', 'approved'], 'initial_states': ['draft']}}
        locked = derive_write_locked_values(model_def, diagrams)
        assert locked['status'] == ['approved']

    def test_different_fields_kept_separate(self):
        diagrams = {'other_field': {'states': ['x', 'y'], 'initial_states': ['x']}}
        locked = derive_write_locked_values(self._model_def(), diagrams)
        assert 'status' not in locked
        assert locked == {'other_field': ['y']}


# ---------------------------------------------------------------------------
# build_context(): state_machine_diagrams / _field_list / _approval_edges
# ---------------------------------------------------------------------------

class TestBuildContextStateMachineContext:
    def test_diagram_parsed_into_context(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        ctx = build_context(_entity(), schema)
        assert ctx['state_machine_field_list'] == ['status']
        diagram = ctx['state_machine_diagrams']['status']
        assert set(diagram['edges']) == {
            ('draft', 'submitted'), ('draft', 'approved'),
            ('submitted', 'rejected'),
        }
        assert diagram['initial_states'] == ['draft']
        assert set(diagram['terminal_states']) == {'approved', 'rejected'}

    def test_approval_edges_present_when_governed(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        ctx = build_context(_entity(), schema)
        appr_edges = set(tuple(e) for e in ctx['state_machine_approval_edges']['status'])
        assert ('draft', 'approved') not in appr_edges
        assert ('draft', 'submitted') in appr_edges
        assert ('submitted', 'approved') in appr_edges

    def test_approval_edges_absent_when_field_not_approval_governed(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=None)
        ctx = build_context(_entity(), schema)
        assert ctx['state_machine_approval_edges'] == {}

    def test_write_locked_values_includes_state_machine_source(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=None)
        ctx = build_context(_entity(), schema)
        assert set(ctx['write_locked_values']['status']) == {'submitted', 'approved', 'rejected'}
        assert 'draft' not in ctx['write_locked_values']['status']

    def test_no_pointer_no_state_machine_context(self):
        schema = {'definitions': {'widget': _widget()}}
        ctx = build_context(_entity(), schema)
        assert ctx['state_machine_field_list'] == []
        assert ctx['state_machine_diagrams'] == {}
        assert ctx['state_machine_approval_edges'] == {}


# ---------------------------------------------------------------------------
# service.ts.jinja2: transition{{Field}}() codegen
# ---------------------------------------------------------------------------

class TestServiceTsTransitionCodegen:
    def _render(self, schema, edit=True):
        from generate import _make_env
        from generators import service_context
        env = _make_env()
        ctx = build_context(_entity(edit=edit), schema)
        svc_ctx = {**ctx, **service_context(ctx, schema)}
        return env.get_template('service.ts.jinja2').render(**svc_ctx)

    def test_transition_function_emitted_when_can_update(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema, edit=True)
        assert 'export async function transitionStatus(actorId: string, id: string, toState: string): Promise<void>' in rendered
        assert 'findUniqueOrThrow' in rendered
        assert 'assertTransitionAllowedStatus(String(_current.status), toState)' in rendered
        assert 'data: { status: toState }' in rendered

    def test_transition_function_absent_when_can_update_false(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema, edit=False)
        assert 'transitionStatus' not in rendered

    def test_no_dead_code_when_no_state_machine_fields(self):
        schema = {'definitions': {'widget': _widget()}}
        rendered = self._render(schema, edit=True)
        assert 'transitionStatus' not in rendered
        assert 'STATE_MACHINE' not in rendered


# ---------------------------------------------------------------------------
# service_validation.ts.jinja2: assertTransitionAllowed{{Field}}() codegen
# -- Case A/B/C, the crux of this task.
# ---------------------------------------------------------------------------

class TestServiceValidationGatekeeperCodegen:
    def _render(self, schema, edit=True):
        from generate import _make_env
        from validation_context import build_validation_context
        env = _make_env()
        ctx = build_context(_entity(edit=edit), schema)
        val_ctx = {**ctx, **build_validation_context(ctx)}
        return env.get_template('service_validation.ts.jinja2').render(**val_ctx)

    def test_case_a_diagram_permits_approval_forbids_rejected(self, tmp_path):
        """Case A: draft->approved is a real diagram edge (STATE_MACHINE_
        EDGES_STATUS), but must be ABSENT from STATE_MACHINE_APPROVAL_
        EDGES_STATUS -- the AND composition's runtime check
        (assertTransitionAllowedStatus) throws for this pair because the
        approval-edges membership test fails, even though the diagram-
        edges membership test passes."""
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema)
        assert '["draft", "approved"]' in rendered  # in STATE_MACHINE_EDGES_STATUS
        # The approval-edges array must not contain the draft/approved pair.
        appr_block = rendered.split('STATE_MACHINE_APPROVAL_EDGES_STATUS')[1].split(';')[0]
        assert '["draft", "approved"]' not in appr_block
        assert 'assertTransitionAllowedStatus' in rendered
        assert 'transition not permitted by x-approval' in rendered
        assert 'no such transition' in rendered

    def test_case_b_diagram_forbids_approval_permits(self, tmp_path):
        """Case B: submitted->approved is legal under x-approval's own
        on_approved stage, but the diagram (deliberately) never declares
        that edge -- absent from STATE_MACHINE_EDGES_STATUS, so the
        diagram-edge check rejects it before the approval check is even
        reached."""
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema)
        diagram_block = rendered.split('STATE_MACHINE_EDGES_STATUS')[1].split(';')[0]
        assert '["submitted", "approved"]' not in diagram_block
        appr_block = rendered.split('STATE_MACHINE_APPROVAL_EDGES_STATUS')[1].split(';')[0]
        assert '["submitted", "approved"]' in appr_block

    def test_case_c_both_permit(self, tmp_path):
        """Case C (positive control): draft->submitted is legal under BOTH
        the diagram and x-approval."""
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema)
        diagram_block = rendered.split('STATE_MACHINE_EDGES_STATUS')[1].split(';')[0]
        appr_block = rendered.split('STATE_MACHINE_APPROVAL_EDGES_STATUS')[1].split(';')[0]
        assert '["draft", "submitted"]' in diagram_block
        assert '["draft", "submitted"]' in appr_block

    def test_field_naming_non_status_field_works(self, tmp_path):
        """己: a governed field named something other than 'status' (the
        design doc's own real-schema example, verification_status on
        bank_account) must generate an identically-shaped, correctly-named
        gatekeeper -- proving no field name is hardcoded."""
        _write_mmd(tmp_path, 'sm/widget_verification_status.mmd', _CASE_ABC_MMD)
        schema = _schema(
            field_name='verification_status',
            x_approval={
                'submit_on': {'verification_status': 'submitted'},
                'on_approved': {'set_fields': {'verification_status': 'approved'}},
                'on_rejected': {'set_fields': {'verification_status': 'rejected'}, 'terminal': True},
            },
            mmd_path='sm/widget_verification_status.mmd',
        )
        rendered = self._render(schema)
        assert 'export function assertTransitionAllowedVerificationStatus(fromState: string, toState: string): void' in rendered
        assert 'STATE_MACHINE_EDGES_VERIFICATION_STATUS' in rendered
        assert 'STATE_MACHINE_APPROVAL_EDGES_VERIFICATION_STATUS' in rendered
        assert "'verification_status', 'invalid'" in rendered

    def test_no_approval_composition_block_when_not_approval_governed(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=None)
        rendered = self._render(schema)
        assert 'assertTransitionAllowedStatus' in rendered
        assert 'STATE_MACHINE_EDGES_STATUS' in rendered
        assert 'STATE_MACHINE_APPROVAL_EDGES_STATUS' not in rendered
        assert 'transition not permitted by x-approval' not in rendered

    def test_no_dead_code_when_no_state_machine_fields(self):
        schema = {'definitions': {'widget': _widget()}}
        rendered = self._render(schema)
        assert 'assertTransitionAllowed' not in rendered
        assert 'STATE_MACHINE' not in rendered

    def test_gated_on_can_update_false(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema, edit=False)
        assert 'assertTransitionAllowed' not in rendered
