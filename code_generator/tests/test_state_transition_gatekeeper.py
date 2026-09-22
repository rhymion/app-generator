"""Issue #696, state-transition Stage 1 PR2b/PR2c: the state-transition
gatekeeper and its x-approval AND-composition
(state-transition-generator-design.md's composition law, Case A/B/C).

cmd_1132/cmd_1133 corrected this task's own earlier design: the gatekeeper
is no longer a dedicated transition{Field}() Server-reachable entry point
guarded by a write-lock (derive_write_locked_values()'s former Source 3).
It is checked inline, at the update{Parent}/add{Parent} convergence point
every entry point (UI Server Action, REST route, CSV import) already
funnels through -- the same discipline x-approval's own guard follows --
via a single model-scoped runtime table + judgment function,
lib/state_transitions.ts (templates/state_transitions.ts.jinja2), imported
by each entity's own service_validation.ts.

Covers:
  - derive_approval_legal_transition_edges (helpers/schema_helpers.py): the
    pure (fromState, toState) legal-edge derivation for a field also
    governed by x-approval's own submit_on -- Case A/B/C's semantic core.
    Unaffected by the convergence-point correction; unit-tested as before.
  - derive_write_locked_values() no longer has a state-machine source: the
    convergence-point check supersedes it (there is no longer a
    service-layer-bypassing writer for a governed field to guard against).
  - build_context(): state_machine_diagrams / state_machine_field_list /
    state_machine_approval_edges still flow through to template context
    correctly; write_locked_values does NOT pick up a state-machine source.
  - service.ts.jinja2: no dedicated transition{Field}() entry point is ever
    emitted, regardless of can_update.
  - service_validation.ts.jinja2: the inline convergence-point check --
    import of assertTransitionAllowed/assertInitialStateAllowed, gated on
    can_update; the edge check (assertTransitionAllowed) is skipped on
    create (currentId === null, no prevRow to read a fromState off of); the
    create path instead runs assertInitialStateAllowed against the
    diagram's own declared initial state(s) (cmd_1139); field naming (a
    governed field named something other than 'status') behaves
    identically for both checks. Issue #710/cmd_1144/cmd_1145: both checks
    read a field's VALUE presence (`data.<field> !== undefined`), never its
    KEY presence -- a client-writable prop's key is always present in
    `data` regardless of whether the client supplied it (validation_data_obj
    always emits the key). On update, an omitted field falls back to
    prevRow's own current value (never to the schema default -- defaults
    are create-time-only) and is fed through the SAME
    assertTransitionAllowed() call every explicit value goes through, no
    separate branch; that call's own fromState === toState rule makes the
    omitted-field case (and any other same-value resubmission) an
    unconditional no-op.
  - state_transitions.ts.jinja2 (the model-scoped file itself): Case A/B/C
    edge-table shape, keyed by '{model}.{field}', across multiple models in
    one file; assertInitialStateAllowed()'s initialStates set per entry.
  - generate.py: can_update gating of which models' entries actually reach
    lib/state_transitions.ts; the file itself is skipped entirely (cmd_1139)
    when a schema contributes zero entries, not emitted empty (opt-in byte
    identity for a schema untouched by this feature).
  - Full pipeline (build_user_schema -> generate.py): the above, exercised
    through the real generator entry point.

Case D (the generate-time static check rejecting a diagram edge whose
state is structurally impossible under x-approval's own declared stages)
was already implemented in PR2a-2 -- see
test_validate_state_machine_precondition.py's TestDiagramContentChecks --
and is not re-tested here; this file's own fixtures are deliberately built
so they'd also pass Case D (both endpoints of every diagram edge are
individually legal x-approval values), which is exactly what makes Case A
a check Case D's value-only logic cannot perform on its own.
"""
import shutil
from pathlib import Path

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
# -- unaffected by the convergence-point correction, unit-tested as before.
# ---------------------------------------------------------------------------

class TestDeriveApprovalLegalTransitionEdges:
    def test_no_x_approval_returns_none(self):
        model_def = {'properties': {'status': {'type': 'string', 'enum': ['draft', 'submitted']}}}
        assert derive_approval_legal_transition_edges(model_def, 'status') is None

    def test_field_not_governed_by_submit_on_returns_none(self):
        """x-approval exists on this entity, but its submit_on governs a
        DIFFERENT field than the one asked about -- field-scoped
        independence (design doc): an x-approval entity may govern a field
        a diagram never touches."""
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
        """A non-terminal rejection leaves the ordinary edit path (including
        resubmission back to submit_on's value) open."""
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
        """The single most important case (design doc): x-approval's own
        legal-transition set must NOT contain a direct draft->approved
        pair, even though both 'draft' and 'approved' are individually
        legal x-approval values."""
        model_def = _widget(x_approval=_case_abc_x_approval())
        edges = derive_approval_legal_transition_edges(model_def, 'status')
        assert ('draft', 'approved') not in edges


# ---------------------------------------------------------------------------
# derive_write_locked_values(): no longer has a state-machine source
# (cmd_1132/cmd_1133 correction -- the convergence-point check supersedes
# it; see the function's own docstring for why).
# ---------------------------------------------------------------------------

class TestDeriveWriteLockedValuesHasNoStateMachineSource:
    def test_state_machine_governed_field_with_no_other_source_is_unlocked(self):
        """A field governed ONLY by x-state-machines (no x-approval, no
        x-write-locked-values) must be entirely absent from
        derive_write_locked_values()'s result -- the ordinary write path
        (update{{Parent}}) is now itself responsible for checking legality,
        via lib/state_transitions.ts, not this lockdown mechanism."""
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['draft', 'submitted', 'approved', 'rejected']}},
        }
        assert derive_write_locked_values(model_def) == {}

    def test_takes_a_single_argument(self):
        """Signature regression guard: the removed state_machine_diagrams
        parameter must not silently resurrect (a caller passing a second
        positional argument should fail loudly, not be ignored)."""
        with pytest.raises(TypeError):
            derive_write_locked_values({'properties': {}}, {'status': {'states': ['a'], 'initial_states': ['a']}})

    def test_other_sources_unaffected(self):
        """Sources 1 (x-approval) and 2 (x-write-locked-values) still work
        exactly as before -- only the state-machine source was removed."""
        model_def = {
            'properties': {'status': {'type': 'string', 'enum': ['draft', 'approved', 'rejected']}},
            'x-approval': {'on_approved': {'set_fields': {'status': 'approved'}}},
        }
        assert derive_write_locked_values(model_def) == {'status': ['approved']}


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

    def test_write_locked_values_excludes_state_machine_source(self, tmp_path):
        """cmd_1132/cmd_1133 correction: a state-transition-governed field
        with no x-approval/x-write-locked-values of its own must be
        entirely absent from write_locked_values -- update{{Parent}}'s own
        inline check (not a write-lock) now guards it."""
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=None)
        ctx = build_context(_entity(), schema)
        assert 'status' not in ctx['write_locked_values']

    def test_no_pointer_no_state_machine_context(self):
        schema = {'definitions': {'widget': _widget()}}
        ctx = build_context(_entity(), schema)
        assert ctx['state_machine_field_list'] == []
        assert ctx['state_machine_diagrams'] == {}
        assert ctx['state_machine_approval_edges'] == {}


# ---------------------------------------------------------------------------
# service.ts.jinja2: no dedicated transition{{Field}}() entry point, ever
# (cmd_1132/cmd_1133: update{{Parent}}/add{{Parent}} are the sole
# convergence points -- see service_validation.ts.jinja2's inline check
# below for where the actual gatekeeper now runs).
# ---------------------------------------------------------------------------

class TestServiceTsNoDedicatedTransitionEntryPoint:
    def _render(self, schema, edit=True):
        from generate import _make_env
        from generators import service_context
        env = _make_env()
        ctx = build_context(_entity(edit=edit), schema)
        svc_ctx = {**ctx, **service_context(ctx, schema)}
        return env.get_template('service.ts.jinja2').render(**svc_ctx)

    def test_no_transition_function_when_can_update(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema, edit=True)
        assert 'transitionStatus' not in rendered
        assert 'STATE_MACHINE' not in rendered
        assert 'export async function updateWidget' in rendered

    def test_no_transition_function_when_can_update_false(self, tmp_path):
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
# service_validation.ts.jinja2: the inline convergence-point check --
# import + call, gated on can_update, skipped on create, field-diff-only.
# ---------------------------------------------------------------------------

class TestServiceValidationInlineTransitionCheck:
    def _render(self, schema, edit=True):
        from generate import _make_env
        from validation_context import build_validation_context
        env = _make_env()
        ctx = build_context(_entity(edit=edit), schema)
        val_ctx = {**ctx, **build_validation_context(ctx)}
        return env.get_template('service_validation.ts.jinja2').render(**val_ctx)

    def test_imports_and_calls_shared_gatekeeper(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema)
        assert "import { assertTransitionAllowed, assertInitialStateAllowed } from '@/lib/state_transitions';" in rendered
        assert "assertTransitionAllowed('widget', 'status', String(prevRow.status), String(statusToState))" in rendered

    def test_transition_check_skipped_on_create(self, tmp_path):
        """The edge check (fromState -> toState) has no fromState to read on
        create -- a new row has no prevRow -- so assertTransitionAllowed
        must be gated on currentId !== null, i.e. reachable only from
        validateOnUpdate, never validateOnAdd."""
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema)
        assert 'if (currentId !== null && prevRow) {' in rendered
        guard_and_below = rendered.split('if (currentId !== null && prevRow) {')[1]
        assert "assertTransitionAllowed('widget', 'status'" in guard_and_below.split('}')[0]

    def test_initial_state_check_fires_on_create(self, tmp_path):
        """cmd_1139: a new row's submitted value must be one of the
        diagram's own declared initial state(s) -- checked via
        assertInitialStateAllowed(), gated on currentId === null (the
        opposite guard from the edge check above)."""
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema)
        assert 'if (currentId === null) {' in rendered
        guard_and_below = rendered.split('if (currentId === null) {')[1]
        assert "assertInitialStateAllowed('widget', 'status', String(data.status))" in guard_and_below.split('}')[0]

    def test_initial_state_check_not_gated_on_prevRow(self, tmp_path):
        """The create guard must not also require `prevRow` (there is none
        on create) -- distinguishes it from the update guard's
        `currentId !== null && prevRow` shape."""
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema)
        assert 'if (currentId === null && prevRow)' not in rendered
        assert 'if (currentId === null)' in rendered

    def test_update_falls_back_to_current_value_not_a_default(self, tmp_path):
        """Issue #710/cmd_1145: an omitted field on update is treated as
        "leave it unchanged" -- toState falls back to prevRow's own current
        value, never to the field's schema default (defaults are a
        create-time-only concept, see the create guard below). No separate
        "field omitted" branch exists -- the fallback feeds the SAME
        assertTransitionAllowed() call every explicit value goes through,
        relying on its own fromState === toState rule to make the omitted
        case a no-op."""
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema)
        assert 'const statusToState = data.status !== undefined ? data.status : prevRow.status;' in rendered
        assert "assertTransitionAllowed('widget', 'status', String(prevRow.status), String(statusToState));" in rendered
        # No former key-presence / value-diff branch left in the update path.
        assert "'status' in data" not in rendered
        assert 'data.status !== prevRow.status' not in rendered

    def test_field_naming_non_status_field_works(self, tmp_path):
        """A governed field named something other than 'status' (the
        design doc's own real-schema example, verification_status on
        bank_account) must generate an identically-shaped, correctly-named
        check -- proving no field name is hardcoded."""
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
        assert (
            'const verification_statusToState = data.verification_status !== undefined '
            '? data.verification_status : prevRow.verification_status;'
        ) in rendered
        assert (
            "assertTransitionAllowed('widget', 'verification_status', "
            "String(prevRow.verification_status), String(verification_statusToState));"
        ) in rendered

    def test_no_approval_composition_argument_when_not_approval_governed(self, tmp_path):
        """Whether the field is ALSO x-approval-governed is entirely a
        lib/state_transitions.ts concern now (its approvalEdges being
        present or null) -- the call site here is identical either way, no
        per-entity branching."""
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=None)
        rendered = self._render(schema)
        assert "assertTransitionAllowed('widget', 'status'" in rendered

    def test_no_dead_code_when_no_state_machine_fields(self):
        schema = {'definitions': {'widget': _widget()}}
        rendered = self._render(schema)
        assert 'assertTransitionAllowed' not in rendered
        assert 'assertInitialStateAllowed' not in rendered
        assert 'state_transitions' not in rendered

    def test_gated_on_can_update_false(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=_case_abc_x_approval())
        rendered = self._render(schema, edit=False)
        assert 'assertTransitionAllowed' not in rendered
        assert 'assertInitialStateAllowed' not in rendered
        assert 'state_transitions' not in rendered


# ---------------------------------------------------------------------------
# state_transitions.ts.jinja2: the model-scoped file itself -- Case A/B/C
# edge-table shape, keyed by '{model}.{field}', across multiple models.
# ---------------------------------------------------------------------------

class TestStateTransitionsTsTemplate:
    def _render(self, entries):
        from generate import _make_env
        env = _make_env()
        return env.get_template('state_transitions.ts.jinja2').render(entries=entries)

    def _widget_entry(self, tmp_path, x_approval=_case_abc_x_approval()):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        schema = _schema(x_approval=x_approval)
        ctx = build_context(_entity(), schema)
        return {**ctx['state_machine_transitions'][0], 'model': 'widget'}

    def test_case_a_diagram_permits_approval_forbids(self, tmp_path):
        entry = self._widget_entry(tmp_path)
        rendered = self._render([entry])
        assert "'widget.status'" in rendered
        block = rendered.split("'widget.status'")[1].split('},')[0]
        assert '["draft", "approved"]' in block.split('approvalEdges')[0]
        assert '["draft", "approved"]' not in block.split('approvalEdges')[1]

    def test_case_b_diagram_forbids_approval_permits(self, tmp_path):
        entry = self._widget_entry(tmp_path)
        rendered = self._render([entry])
        block = rendered.split("'widget.status'")[1].split('},')[0]
        assert '["submitted", "approved"]' not in block.split('approvalEdges')[0]
        assert '["submitted", "approved"]' in block.split('approvalEdges')[1]

    def test_case_c_both_permit(self, tmp_path):
        entry = self._widget_entry(tmp_path)
        rendered = self._render([entry])
        block = rendered.split("'widget.status'")[1].split('},')[0]
        assert '["draft", "submitted"]' in block.split('approvalEdges')[0]
        assert '["draft", "submitted"]' in block.split('approvalEdges')[1]

    def test_approval_edges_null_when_not_approval_governed(self, tmp_path):
        entry = self._widget_entry(tmp_path, x_approval=None)
        rendered = self._render([entry])
        block = rendered.split("'widget.status'")[1].split('},')[0]
        assert 'approvalEdges: null' in block

    def test_initial_states_rendered_from_diagram(self, tmp_path):
        """_CASE_ABC_MMD declares exactly one initial state ('[*] --> draft')
        -- initialStates must carry it, regardless of x-approval."""
        entry = self._widget_entry(tmp_path)
        rendered = self._render([entry])
        block = rendered.split("'widget.status'")[1].split('},')[0]
        assert 'initialStates: ["draft"]' in block

    def test_multiple_models_keyed_separately(self, tmp_path):
        _write_mmd(tmp_path, 'sm/widget_status.mmd', _CASE_ABC_MMD)
        _write_mmd(tmp_path, 'sm/other_stage.mmd', 'stateDiagram-v2\n[*] --> a\na --> b\nb --> [*]\n')
        widget_schema = _schema(x_approval=_case_abc_x_approval())
        widget_ctx = build_context(_entity(), widget_schema)
        other_schema = {
            'definitions': {'other': _widget(field_name='stage', enum_values=['a', 'b'], default='a')},
            'x-state-machines': {'other.stage': 'sm/other_stage.mmd'},
        }
        other_ctx = build_context(_entity(model='other'), other_schema)
        entries = [
            {**widget_ctx['state_machine_transitions'][0], 'model': 'widget'},
            {**other_ctx['state_machine_transitions'][0], 'model': 'other'},
        ]
        rendered = self._render(entries)
        assert "'widget.status'" in rendered
        assert "'other.stage'" in rendered

    def test_no_dead_code_when_no_entries(self):
        rendered = self._render([])
        assert 'export function assertTransitionAllowed' in rendered
        assert 'export function assertInitialStateAllowed' in rendered
        assert "':" not in rendered.split('TRANSITIONS')[1].split('};')[0]

    def test_same_state_transition_always_permitted_ahead_of_edge_check(self):
        """cmd_1145: a same-state 'transition' (fromState === toState) must
        be permitted unconditionally, before the diagram edge / x-approval
        checks -- not merely one more legal edge among others."""
        rendered = self._render([])
        fn_body = rendered.split('export function assertTransitionAllowed')[1].split('\n}')[0]
        assert 'if (fromState === toState) return;' in fn_body
        # Must come before the edge-list check, not after it.
        assert fn_body.index('if (fromState === toState) return;') < fn_body.index('diagramPermits')


# ---------------------------------------------------------------------------
# Full pipeline (build_user_schema -> generate.py): proves generate.py's
# own per-entity collection loop and its can_update gate, not just the
# Jinja-rendering level above.
# ---------------------------------------------------------------------------

class TestStateTransitionConvergencePipeline:
    REPO_ROOT = Path(__file__).resolve().parents[2]
    FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'state_transition_convergence_gate'

    def _run_pipeline(self, tmp_path, monkeypatch):
        from build_user_schema import build_user_schema
        from generate import generate
        monkeypatch.chdir(tmp_path)
        shutil.copytree(self.FIXTURE_DIR / 'sm', tmp_path / 'sm')
        prisma_dir = tmp_path / 'prisma'
        prisma_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(self.FIXTURE_DIR / 'schema.prisma', prisma_dir / 'schema.prisma')
        intermediate = tmp_path / 'generated_json_schema.yaml'
        build_user_schema(self.FIXTURE_DIR / 'json_schema.yaml', self.FIXTURE_DIR / 'schema.prisma', intermediate)
        generate(str(intermediate), str(tmp_path))
        return tmp_path

    def test_writable_model_entry_present_with_case_a_composition(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'lib' / 'state_transitions.ts').read_text()
        assert "'state_transition_gate_widget.status'" in content
        block = content.split("'state_transition_gate_widget.status'")[1].split('},')[0]
        assert '["draft", "approved"]' in block.split('approvalEdges')[0]
        assert '["draft", "approved"]' not in block.split('approvalEdges')[1]

    def test_readonly_model_entry_absent_no_update_to_check_from(self, tmp_path, monkeypatch):
        """can_update=false gate: state_transition_gate_readonly_widget has
        no update{{Parent}}(), so its governed field must not appear in the
        shared table at all."""
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'lib' / 'state_transitions.ts').read_text()
        assert 'state_transition_gate_readonly_widget' not in content

    def test_widget_service_validation_calls_shared_gatekeeper(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'lib' / 'state_transition_gate_widget' / 'service_validation.ts').read_text()
        assert "import { assertTransitionAllowed, assertInitialStateAllowed } from '@/lib/state_transitions';" in content
        assert "assertTransitionAllowed('state_transition_gate_widget', 'status'" in content
        assert "assertInitialStateAllowed('state_transition_gate_widget', 'status'" in content

    def test_widget_state_transitions_ts_carries_initial_states(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'lib' / 'state_transitions.ts').read_text()
        block = content.split("'state_transition_gate_widget.status'")[1].split('},')[0]
        assert 'initialStates: ["draft"]' in block

    def test_widget_service_has_no_dedicated_transition_entry_point(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'lib' / 'state_transition_gate_widget' / 'service.ts').read_text()
        assert 'transitionStatus' not in content
        assert 'export async function updateStateTransitionGateWidget' in content

    def test_readonly_widget_service_validation_has_no_gatekeeper_reference(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        service_validation = out / 'lib' / 'state_transition_gate_readonly_widget' / 'service_validation.ts'
        if service_validation.exists():
            content = service_validation.read_text()
            assert 'assertTransitionAllowed' not in content
            assert 'state_transitions' not in content


# ---------------------------------------------------------------------------
# cmd_1139: opt-in byte identity -- a schema that never uses
# x-state-machines at all must generate byte-identical output to before
# this feature existed. self_only_admin_bypass_entities.ts (the sibling
# "always written, even empty" file this design was originally modeled on)
# cannot dangle an import the way that file must not -- see generate.py's
# comment at the lib/state_transitions.ts _write() call.
# ---------------------------------------------------------------------------

class TestStateTransitionsFileSkippedWhenNoGovernedFields:
    REPO_ROOT = Path(__file__).resolve().parents[2]
    FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'state_transition_no_governed_fields'

    def _run_pipeline(self, tmp_path, monkeypatch):
        from build_user_schema import build_user_schema
        from generate import generate
        monkeypatch.chdir(tmp_path)
        prisma_dir = tmp_path / 'prisma'
        prisma_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(self.FIXTURE_DIR / 'schema.prisma', prisma_dir / 'schema.prisma')
        intermediate = tmp_path / 'generated_json_schema.yaml'
        build_user_schema(self.FIXTURE_DIR / 'json_schema.yaml', self.FIXTURE_DIR / 'schema.prisma', intermediate)
        generate(str(intermediate), str(tmp_path))
        return tmp_path

    def test_state_transitions_ts_not_written(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        assert not (out / 'lib' / 'state_transitions.ts').exists()

    def test_plain_widget_service_validation_has_no_gatekeeper_reference(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'lib' / 'plain_widget' / 'service_validation.ts').read_text()
        assert 'assertTransitionAllowed' not in content
        assert 'assertInitialStateAllowed' not in content
        assert 'state_transitions' not in content


# ---------------------------------------------------------------------------
# cmd_1140: docs/generated/{parent}.md must document a governed field's
# diagram (creation states / legal transitions / terminal states), and must
# state the corrected semantics of a creation state -- "a state a new row
# may land in" (any producer: UI, side-effect hook, batch job, import), not
# "the state a row's life begins with."
# ---------------------------------------------------------------------------

class TestStateMachineGeneratedDoc:
    REPO_ROOT = Path(__file__).resolve().parents[2]
    FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'state_transition_convergence_gate'

    def _run_pipeline(self, tmp_path, monkeypatch):
        from build_user_schema import build_user_schema
        from generate import generate
        monkeypatch.chdir(tmp_path)
        shutil.copytree(self.FIXTURE_DIR / 'sm', tmp_path / 'sm')
        prisma_dir = tmp_path / 'prisma'
        prisma_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(self.FIXTURE_DIR / 'schema.prisma', prisma_dir / 'schema.prisma')
        intermediate = tmp_path / 'generated_json_schema.yaml'
        build_user_schema(self.FIXTURE_DIR / 'json_schema.yaml', self.FIXTURE_DIR / 'schema.prisma', intermediate)
        generate(str(intermediate), str(tmp_path))
        return tmp_path

    def test_widget_doc_lists_creation_states_and_transitions(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'docs' / 'generated' / 'state_transition_gate_widget.md').read_text()
        assert '## State Machine' in content
        assert '### `status`' in content
        assert '- `draft`' in content
        assert '| `draft` | `approved` |' in content
        assert '| `draft` | `submitted` |' in content
        assert '| `submitted` | `rejected` |' in content

    def test_widget_doc_creation_state_wording_not_lifecycle_start(self, tmp_path, monkeypatch):
        """cmd_1140: must not describe a creation state as where a row's
        life begins -- a row can be created into it via any producer."""
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'docs' / 'generated' / 'state_transition_gate_widget.md').read_text()
        assert 'may be created into' in content
        assert "life's beginning" not in content
        assert 'side-effect hook' in content
        assert 'batch' in content
        assert 'import' in content

    def test_widget_doc_terminal_state_has_no_runtime_meaning_note(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'docs' / 'generated' / 'state_transition_gate_widget.md').read_text()
        assert 'Terminal states' in content
        assert 'no meaning at runtime' in content
        assert 'no relationship to delete permission' in content
        assert '- `approved`' in content
        assert '- `rejected`' in content

    def test_readonly_widget_doc_notes_declared_but_unenforced(self, tmp_path, monkeypatch):
        out = self._run_pipeline(tmp_path, monkeypatch)
        content = (out / 'docs' / 'generated' / 'state_transition_gate_readonly_widget.md').read_text()
        assert 'not enforced' in content
        assert '### `stage`' in content

    def test_no_state_machine_section_when_no_governed_fields(self):
        from generate import _make_env
        from build_context import build_context
        from generators_doc import build_doc_entity_context
        env = _make_env()
        schema = {'definitions': {'widget': _widget()}}
        ctx = build_context(_entity(), schema)
        doc_ctx = build_doc_entity_context(ctx)
        rendered = env.get_template('doc_entity.md.jinja2').render(**doc_ctx)
        assert '## State Machine' not in rendered

    def test_no_extra_blank_line_before_relationships_when_no_governed_fields(self):
        """cmd_1139 byte-identity regression: the conditional `{% if
        state_machine_fields %}...{% endif %}` block must not leave a
        stray blank line behind when it renders nothing -- caught via a
        full-pipeline byte comparison against proj_c/proj_h's own schemas
        (neither declares x-state-machines), not by this unit test alone;
        added here so the same regression fails fast next time."""
        from generate import _make_env
        from build_context import build_context
        from generators_doc import build_doc_entity_context
        env = _make_env()
        schema = {'definitions': {'widget': _widget()}}
        ctx = build_context(_entity(), schema)
        doc_ctx = build_doc_entity_context(ctx)
        rendered = env.get_template('doc_entity.md.jinja2').render(**doc_ctx)
        assert '\n\n\n## Relationships' not in rendered
        assert '\n\n## Relationships' in rendered
