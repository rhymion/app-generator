"""
Regression tests for cmd_830 (proj_h "insured_party_id is required" report):

1. VALIDATION 'reason' discriminator (service_validation.ts.jinja2 +
   generators.py's Server Action catch blocks + form_upsert.tsx.jinja2's
   getErrorMessage): a value that IS present but rejected by a hand-written
   business rule (service_validation_custom.ts) must not render the same
   "{field} is required." text as a genuinely-missing value. Before this
   fix, ActionFailure carried only {errorCode, field} -- both the generated
   REQUIRED_FIELDS check and any hand-written validateCustomRules() throw
   under the same 'VALIDATION' code, and getErrorMessage() collapsed both to
   the generic 'fieldRequired' i18n key regardless of which one actually
   fired. The REST API path (lib/api-auth.ts handleApiError) was never
   affected -- it always forwarded error.message verbatim.

2. Context-filtered FK "initial options" bypass (generators.py's DP-3
   rel_opt_setups + EntityAutocomplete.tsx): a field whose x-autocomplete-
   context narrows candidates via a sibling FK value must not offer an
   unfiltered default/browse list before the user types a query --
   EntityAutocomplete shows `initialOptions` verbatim whenever the input is
   empty, and the old codegen fed it a static, context-blind server fetch.

Run:
    cd code_generator && python3 -m pytest tests/test_validation_message_reason_and_context_filter.py -v
"""
import json
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import form_upsert_context, actions_context
from validation_context import build_validation_context
from helpers.naming import to_pascal_case, to_camel_case


def _make_env() -> Environment:
    """Mirrors generate.py's _make_env() — the real filters must be
    registered or {{ x | pascal_case }} etc. raise TemplateRuntimeError."""
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    env.filters['tojson'] = json.dumps
    return env


def _base_props(extra: dict = None) -> dict:
    props = {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
        'name': {'type': 'string'},
    }
    props.update(extra or {})
    return props


def _gen_cfg() -> dict:
    return {
        'list': True, 'view': True, 'new': True, 'edit': True,
        'delete': True, 'api': True, 'test': False, 'fields': None,
    }


def _schema() -> dict:
    """Mirrors proj_h's claim/policy/party shape: `ticket.assignee_id`
    (FK -> party) declares x-autocomplete-context: [policy_id], narrowing
    assignee candidates to parties already on the ticket's policy -- same
    structure as claim.insured_party_id / claim.claimant_party_id."""
    defs = {
        'policy': {
            'x-generate': _gen_cfg(),
            'type': 'object',
            'required': ['id', 'name'],
            'properties': _base_props(),
        },
        'party': {
            'x-generate': _gen_cfg(),
            'type': 'object',
            'required': ['id', 'name'],
            'properties': _base_props(),
        },
        'ticket': {
            'x-generate': _gen_cfg(),
            'type': 'object',
            'required': ['id', 'name', 'policy_id', 'assignee_id'],
            'properties': {
                **_base_props(),
                'policy_id': {
                    'type': 'string',
                    'pattern': '^c[a-z0-9]{24,}$',
                    'x-relationship': {'type': 'many-to-one', 'target': 'policy', 'labelField': 'name'},
                },
                'assignee_id': {
                    'type': 'string',
                    'pattern': '^c[a-z0-9]{24,}$',
                    'x-relationship': {'type': 'many-to-one', 'target': 'party', 'labelField': 'name'},
                    'x-autocomplete-context': ['policy_id'],
                },
            },
        },
    }
    return {'definitions': defs}


def _entity_meta() -> dict:
    return {
        'parent': 'ticket',
        'model': 'ticket',
        'definition_key': 'ticket',
        'children': [],
        'generate_config': _gen_cfg(),
    }


def _build_ctx() -> dict:
    return build_context(_entity_meta(), _schema())


# ---------------------------------------------------------------------------
# 1. VALIDATION reason discriminator
# ---------------------------------------------------------------------------

class TestValidationReasonDiscriminator:
    def _render_service_validation(self) -> str:
        ctx = {**_build_ctx(), **build_validation_context(_build_ctx())}
        return _make_env().get_template('service_validation.ts.jinja2').render(**ctx)

    def test_required_field_throw_tags_missing(self):
        """The generated REQUIRED_FIELDS loop must tag its throw 'missing' --
        this is the only case where the field genuinely has no value."""
        rendered = self._render_service_validation()
        assert "`${field.label} is required`, field.key, 'missing'" in rendered

    def test_one_to_one_missing_required_relation_tags_missing(self):
        rendered = self._render_service_validation()
        assert "`${relation.label} is required`, relation.key, 'missing'" in rendered

    def test_validate_custom_rules_call_is_wrapped_and_retags_invalid(self):
        """A hand-written service_validation_custom.ts rejection (always
        constructed as AppError('VALIDATION', msg, field) with no 4th arg,
        since it predates this discriminator) must be re-tagged 'invalid' --
        it rejects a value that IS present, never a missing one."""
        rendered = self._render_service_validation()
        assert 'try {' in rendered
        assert 'await (validateCustomRules as CustomRulesFn)(tx, data, currentId, prevRow, actorId);' in rendered
        assert "e instanceof AppError && e.code === 'VALIDATION' && !e.reason" in rendered
        assert "new AppError('VALIDATION', e.message, e.field, 'invalid')" in rendered

    def test_required_and_custom_rejection_produce_different_reason_tags(self):
        """The actual claim in cmd_830: 'value missing' and 'value present
        but rejected by a business rule' must be structurally distinguishable
        in the generated code, not just both throw AppError('VALIDATION')."""
        rendered = self._render_service_validation()
        assert "'missing'" in rendered
        assert "'invalid'" in rendered

    def test_server_action_catch_forwards_reason(self):
        """generators.py's _wrap_call_with_catch/_wrap_block_with_catch must
        put e.reason on the returned ActionFailure -- otherwise the reason
        tag set above never reaches the client at all."""
        ctx = {**_build_ctx(), **actions_context(_build_ctx())}
        rendered = _make_env().get_template('actions.ts.jinja2').render(**ctx)
        assert 'reason: e.reason' in rendered

    def test_get_error_message_branches_on_reason_for_validation(self):
        """form_upsert.tsx.jinja2's getErrorMessage must render a different
        i18n key for reason 'invalid' than for the default/missing case --
        this is the actual user-visible fix. Before this, VALIDATION always
        rendered terr('fieldRequired', ...) regardless of cause."""
        ctx = form_upsert_context(_build_ctx(), _schema())
        full_ctx = {**_build_ctx(), **ctx}
        rendered = _make_env().get_template('form_upsert.tsx.jinja2').render(**full_ctx)
        start = rendered.index('const getErrorMessage')
        end = rendered.index('\n  };', start)
        block = rendered[start:end]
        assert "err.reason === 'invalid'" in block
        assert "fieldInvalid" in block
        assert "fieldRequired" in block


# ---------------------------------------------------------------------------
# 2. Context-filtered FK: live-refetched initial options
# ---------------------------------------------------------------------------

class TestContextFilteredAutocompleteInitialOptions:
    def _rel_opt_setups(self) -> str:
        ctx = form_upsert_context(_build_ctx(), _schema())
        return ctx['rel_opt_setups']

    def test_ctx_filtered_relation_does_not_use_static_initial_options(self):
        """assignee_id declares x-autocomplete-context: [policy_id] -- its
        initialOptions must NOT be a plain useMemo over the page-load-time
        server fetch (that fetch has no policy_id to filter by), unlike an
        unfiltered relation (policy_id itself has no context, so it keeps
        the untouched useMemo form)."""
        setups = self._rel_opt_setups()
        assert 'const policyIdInitialOptions = useMemo(' in setups
        assert 'const assigneeIdInitialOptions = useMemo(' not in setups

    def test_ctx_filtered_relation_refetches_via_its_own_search_action(self):
        """The live list must come from assigneeIdSearchAction('', []) --
        the SAME context-aware path (filterAutocompleteOptions) the typed
        search already used -- not a second, separately-filtered code path."""
        setups = self._rel_opt_setups()
        assert "assigneeIdSearchAction('', [])" in setups
        assert 'useEffect(() => {' in setups

    def test_ctx_filtered_relation_refetches_when_context_changes(self):
        """The useEffect must depend on the search action itself (which is
        already memoized on the context field's live value), so a new
        Policy selection triggers a re-fetch instead of leaving the stale
        pre-Policy list on screen."""
        setups = self._rel_opt_setups()
        idx = setups.index('useEffect(')
        end = setups.index('}, [assigneeIdSearchAction]);', idx)
        block = setups[idx:end]
        assert 'cancelled = true' in block

    def test_ctx_filtered_relation_still_seeds_from_server_fetch(self):
        """The static initial{Target}s fetch (still made by the page's
        Promise.all) must seed the live state so the field isn't empty for
        the one render before the effect resolves, and so `initialPartys`
        remains referenced (no unused-var regression)."""
        setups = self._rel_opt_setups()
        assert 'useState(() => (initialPartys ?? [])' in setups

    def test_uses_use_effect_flag_set_only_when_ctx_fields_present(self):
        ctx = form_upsert_context(_build_ctx(), _schema())
        assert ctx['uses_use_effect'] is True

    def test_react_import_includes_use_effect_when_needed(self):
        ctx = {**_build_ctx(), **form_upsert_context(_build_ctx(), _schema())}
        rendered = _make_env().get_template('form_upsert.tsx.jinja2').render(**ctx)
        import_line = rendered.splitlines()[2]
        assert 'useEffect' in import_line

    def test_unfiltered_relation_byte_for_byte_unchanged_shape(self):
        """policy_id (no x-autocomplete-context) must keep the original
        useMemo-only shape -- DP-3's existing 'every other FK's call site is
        byte-for-byte unchanged' guarantee must still hold for this fix."""
        setups = self._rel_opt_setups()
        start = setups.index('const policyIdInitialOptions')
        end = setups.index('const policyIdCurrentOption')
        block = setups[start:end]
        assert 'useEffect' not in block
        assert 'useState' not in block
