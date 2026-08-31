"""Rendering tests for the x-scheduled-task generic mechanism templates
(cmd_750 / subtask_741a), plus its bulk (entity-agnostic) sibling
x-scheduled-tasks (cmd_790).

The default schema (json_schema.yaml) declares no x-scheduled-task entity --
the first user (inventory_reservation) lives in a consumer schema, not this
generator's own -- so `npm run test:e2e:build` never renders these templates.
These tests are the only Gate-SoT-covered check that they render at all
(TS type-correctness itself is proven separately, out of band, against the
consumer schema that actually declares the key -- see the task report).

AC1 (generic, not expires_at-specific): registry.ts must be able to hold
more than one task_id -- test_registry_multiple_tasks below pins this.
AC2 (no duplicated business logic): service_scheduled.ts only ever imports
and calls the configured handler -- it never inlines business logic itself.

cmd_790 adds a second mode for operations that don't fit a single-entity
filtered row scan (e.g. a full demo-data reset spanning many tables): a
top-level, entity-agnostic `x-scheduled-tasks` declaration whose
service_scheduled.ts calls its handler directly, once, with no row
selection. TestServiceScheduledBulkTemplate /
TestServiceScheduledBulkHandlerStubTemplate below cover it; both modes
share the one registry (TestRegistryTemplate.test_registry_mixes_row_scan_and_bulk_tasks).
"""
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

from build_user_schema import _build_raw_and_view
from helpers.naming import to_pascal_case, to_camel_case
from schema_deriver import parse_prisma_schema

PRISMA_SCHEMA_PATH = Path(__file__).parent.parent.parent / "prisma" / "schema.prisma"


def _make_env() -> Environment:
    templates_dir = Path(__file__).parent.parent / 'templates'
    env = Environment(
        loader=FileSystemLoader(templates_dir),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env


_ENV = _make_env()

_EXPIRE_ENTITY = {
    'snake_name': 'inventory_reservation',
    'pascal_name': 'InventoryReservation',
    'task_id': 'inventory_reservation_expire',
    'handler': 'afterExpire',
    'interval': '*/15 * * * *',
    'expires_at_before_now': True,
    'status_in': ['pending', 'active'],
    'module_path': 'inventory_reservation',
    'run_name': 'inventoryReservationRun',
}

_TIMEOUT_ENTITY = {
    'snake_name': 'approval_request',
    'pascal_name': 'ApprovalRequest',
    'task_id': 'approval_request_timeout_release',
    'handler': 'afterTimeout',
    'interval': '0 * * * *',
    'expires_at_before_now': False,
    'status_in': ['pending'],
    'module_path': 'approval_request',
    'run_name': 'approvalRequestRun',
}

_BULK_DEMO_RESET = {
    'task_id': 'demo_reset',
    'handler': 'resetDemo',
    'interval': '0 3 * * *',
    'module_path': 'scheduled-tasks/demo_reset',
    'run_name': 'demoResetRun',
}


class TestServiceScheduledTemplate:
    def _render(self, ctx: dict) -> str:
        return _ENV.get_template('service_scheduled.ts.jinja2').render(**ctx)

    def test_filter_and_dispatch_present(self):
        rendered = self._render(_EXPIRE_ENTITY)
        assert 'prisma.inventory_reservation.findMany' in rendered
        assert "expires_at: { not: null, lt: new Date() }" in rendered
        assert "status: { in: ['pending', 'active'] }" in rendered
        assert 'afterExpire' in rendered
        assert "from './service_scheduled_handler'" in rendered

    def test_no_business_logic_inlined(self):
        """AC2: the dispatch file only imports and calls the handler -- it
        must never define the handler function itself."""
        rendered = self._render(_EXPIRE_ENTITY)
        assert 'export async function afterExpire' not in rendered
        assert rendered.count('export async function') == 1  # only `run`

    def test_interval_and_task_id_surfaced_in_header_comment(self):
        rendered = self._render(_EXPIRE_ENTITY)
        assert 'inventory_reservation_expire' in rendered
        assert '*/15 * * * *' in rendered

    def test_expires_at_only_filter_omits_status_clause(self):
        ctx = dict(_EXPIRE_ENTITY, status_in=[])
        rendered = self._render(ctx)
        assert 'expires_at:' in rendered
        assert 'status:' not in rendered

    def test_status_only_filter_omits_expires_at_clause(self):
        rendered = self._render(_TIMEOUT_ENTITY)
        assert 'expires_at:' not in rendered
        assert "status: { in: ['pending'] }" in rendered

    def test_claim_then_process_advisory_lock_and_recheck_present(self):
        """cmd_886 AC: the dispatcher must claim a row -- a transaction-scoped
        advisory lock keyed on the row id, then a re-check of the same
        filter -- before calling the handler, and skip silently when the
        recheck finds 0 rows (another concurrent invocation's transaction
        already committed a disqualifying write for this row).

        Not an updateMany-with-updated_at compare-and-swap: that shape was
        tried and empirically falsified in a real-Postgres integration test
        -- two invocations racing within the same wall-clock second write
        and re-read `updated_at` (@db.Timestamptz(0), whole-second
        precision) as identical values, so the CAS silently never detects
        the second invocation. See
        test/flows/scheduled_task_claim_then_process.test.ts in a consumer
        checkout for the real-DB proof of both the chosen design and why
        the CAS alternative was rejected."""
        rendered = self._render(_EXPIRE_ENTITY)
        assert 'prisma.inventory_reservation.findMany' in rendered
        assert 'select: { id: true }' in rendered
        assert 'pg_advisory_xact_lock(hashtextextended(${row.id}, 0))' in rendered
        assert 'tx.inventory_reservation.count' in rendered
        assert 'if (stillEligible === 0)' in rendered
        assert '.updateMany(' not in rendered  # rejected CAS design, see docstring
        assert 'row.updated_at' not in rendered
        assert rendered.count("expires_at: { not: null, lt: new Date() }") == 2
        assert rendered.count("status: { in: ['pending', 'active'] }") == 2

    def test_claim_guards_the_handler_call(self):
        """The handler must be called only after the stillEligible === 0
        skip check -- textual ordering proxy for "claim happens before
        dispatch"."""
        rendered = self._render(_EXPIRE_ENTITY)
        claim_check_pos = rendered.index('if (stillEligible === 0)')
        handler_call_pos = rendered.index('await afterExpire(tx, row.id, systemActorId)')
        assert claim_check_pos < handler_call_pos

    def test_claim_and_dispatch_share_one_transaction(self):
        """The claim (lock + recheck) and the handler call must run in the
        same prisma.$transaction as each other -- otherwise the advisory
        lock would be released (transaction-scoped) before the handler's
        writes commit, reopening the exact race this guard exists to
        close."""
        rendered = self._render(_EXPIRE_ENTITY)
        assert rendered.count('prisma.$transaction') == 1
        transaction_pos = rendered.index('prisma.$transaction')
        lock_pos = rendered.index('pg_advisory_xact_lock')
        claim_pos = rendered.index('tx.inventory_reservation.count')
        handler_call_pos = rendered.index('await afterExpire(tx, row.id, systemActorId)')
        assert transaction_pos < lock_pos < claim_pos < handler_call_pos


class TestServiceScheduledHandlerStubTemplate:
    def _render(self, ctx: dict) -> str:
        return _ENV.get_template('service_scheduled_handler_stub.ts.jinja2').render(**ctx)

    def test_exports_configured_handler_name(self):
        rendered = self._render(_EXPIRE_ENTITY)
        assert 'export async function afterExpire(' in rendered

    def test_generated_once_header_present(self):
        """Write-once contract (_write_stub): must carry the same
        'GENERATED ONCE' marker as the existing service_after_reject.ts /
        service_after_approve.ts stubs so cleanup.py and manifest staleness
        detection treat it identically."""
        rendered = self._render(_EXPIRE_ENTITY)
        assert rendered.startswith('// GENERATED ONCE')

    def test_different_handler_name_renders_correctly(self):
        rendered = self._render(_TIMEOUT_ENTITY)
        assert 'export async function afterTimeout(' in rendered
        assert 'afterExpire' not in rendered


class TestServiceScheduledBulkTemplate:
    """cmd_790: bulk mode (top-level x-scheduled-tasks) -- no row selection,
    the handler is called directly, once, per run."""

    def _render(self, ctx: dict) -> str:
        return _ENV.get_template('service_scheduled_bulk.ts.jinja2').render(**ctx)

    def test_calls_handler_directly_with_no_row_selection(self):
        rendered = self._render(_BULK_DEMO_RESET)
        assert 'await resetDemo(systemActorId)' in rendered
        assert "from './service_scheduled_handler'" in rendered
        assert 'findMany' not in rendered
        assert '$transaction' not in rendered

    def test_no_business_logic_inlined(self):
        """AC2 (cmd_750/subtask_741a), same contract as the row-scan
        variant: the dispatch file only imports and calls the handler."""
        rendered = self._render(_BULK_DEMO_RESET)
        assert 'export async function resetDemo' not in rendered
        assert rendered.count('export async function') == 1  # only `run`

    def test_no_claim_then_process_needed_no_row_selection_to_race_on(self):
        """cmd_886 AC-甲 (bulk-applicability check): the entity-level
        template's double-dispatch race exists because two overlapping
        invocations can both see the same row from their own `findMany`
        before either processes it, so the row must be *claimed* (updateMany
        + compare-and-swap) before dispatch. Bulk mode calls the handler
        directly with no row selection and no per-row loop at all (see
        test_calls_handler_directly_with_no_row_selection above: no
        `findMany`, no `$transaction`) -- there is no "row selected as
        eligible, then processed" step for a second invocation to race
        against at the dispatcher level, so the entity-level fix does not
        apply here. Whether a *bulk handler's own* internal logic (which can
        span arbitrarily many rows/tables and is entirely hand-authored, see
        service_scheduled_bulk_handler_stub.ts.jinja2) needs its own
        idempotency guard is that handler's responsibility, same as any
        other GENERATED ONCE handler -- the generic template has no rows to
        claim on its behalf."""
        rendered = self._render(_BULK_DEMO_RESET)
        assert 'findMany' not in rendered
        assert 'updateMany' not in rendered
        assert 'claim' not in rendered

    def test_interval_and_task_id_surfaced_in_header_comment(self):
        rendered = self._render(_BULK_DEMO_RESET)
        assert 'demo_reset' in rendered
        assert '0 3 * * *' in rendered


class TestServiceScheduledBulkHandlerStubTemplate:
    def _render(self, ctx: dict) -> str:
        return _ENV.get_template('service_scheduled_bulk_handler_stub.ts.jinja2').render(**ctx)

    def test_exports_configured_handler_name_with_single_arg(self):
        rendered = self._render(_BULK_DEMO_RESET)
        assert 'export async function resetDemo(systemActorId: string): Promise<void> {' in rendered

    def test_generated_once_header_present(self):
        rendered = self._render(_BULK_DEMO_RESET)
        assert rendered.startswith('// GENERATED ONCE')

    def test_no_tx_or_entity_id_params(self):
        """Bulk mode has no row/entity binding -- unlike the row-scan
        handler stub, there is no `tx`/`entityId` parameter to receive."""
        rendered = self._render(_BULK_DEMO_RESET)
        assert 'entityId' not in rendered
        assert 'tx: Tx' not in rendered


class TestRegistryTemplate:
    def _render(self, entities: list) -> str:
        return _ENV.get_template('scheduled_task_registry.ts.jinja2').render(
            scheduled_task_entities=entities,
        )

    def test_registry_multiple_tasks(self):
        """AC1: the registry must accept more than one task_id -- this is
        what makes the mechanism generic rather than expires_at-specific."""
        rendered = self._render([_EXPIRE_ENTITY, _TIMEOUT_ENTITY])
        assert "'inventory_reservation_expire': inventoryReservationRun" in rendered
        assert "'approval_request_timeout_release': approvalRequestRun" in rendered
        assert rendered.count('import { run as') == 2

    def test_registry_empty_when_no_entities_declare_the_key(self):
        rendered = self._render([])
        assert 'TASK_REGISTRY: Record<string, ScheduledTaskRunner> = {' in rendered
        assert 'import { run as' not in rendered

    def test_registry_single_task(self):
        rendered = self._render([_EXPIRE_ENTITY])
        assert "'inventory_reservation_expire': inventoryReservationRun" in rendered
        assert 'approval_request' not in rendered

    def test_registry_mixes_row_scan_and_bulk_tasks(self):
        """cmd_790: both mechanisms feed the same registry, keyed uniformly
        by task_id -- the registry itself is unaware which mode produced
        any given entry."""
        rendered = self._render([_EXPIRE_ENTITY, _BULK_DEMO_RESET])
        assert "'inventory_reservation_expire': inventoryReservationRun" in rendered
        assert "'demo_reset': demoResetRun" in rendered
        assert "from '@/lib/inventory_reservation/service_scheduled'" in rendered
        assert "from '@/lib/scheduled-tasks/demo_reset/service_scheduled'" in rendered
        assert rendered.count('import { run as') == 2


class TestRouteTemplate:
    def test_route_is_entity_count_independent(self):
        """The dispatcher route takes no per-entity context at all -- it
        only ever imports TASK_REGISTRY, never an individual entity's
        service_scheduled module."""
        rendered = _ENV.get_template('scheduled_task_route.ts.jinja2').render()
        assert "from '@/lib/scheduled-tasks/registry'" in rendered
        assert 'TASK_REGISTRY[task]' in rendered
        assert 'CRON_SECRET' in rendered

    def test_both_get_and_post_exported(self):
        """cmd_781: Vercel Cron always invokes with GET (confirmed against
        Vercel's own docs) -- a POST-only route would 405 on every real
        invocation and every schedule would silently never fire. POST stays
        open too, for GCP Cloud Scheduler / manual triggers."""
        rendered = _ENV.get_template('scheduled_task_route.ts.jinja2').render()
        assert 'export const GET = handleScheduledTask' in rendered
        assert 'export const POST = handleScheduledTask' in rendered

    def test_actor_looked_up_by_fixed_email_not_env_var(self):
        """cmd_781: SCHEDULED_TASK_ACTOR_ID (an env var a human had to set,
        500ing on every run until they did) is replaced by a DB lookup keyed
        on a fixed, well-known email -- the account is seeded unconditionally
        by db:seed-baseline, so there is nothing to separately configure."""
        rendered = _ENV.get_template('scheduled_task_route.ts.jinja2').render()
        assert "from '@/lib/scheduled-tasks/system-actor'" in rendered
        assert 'SCHEDULED_TASK_ACTOR_EMAIL' in rendered
        # The old env var name may still appear in a "here's what this
        # replaces" comment -- what must be gone is any functional read of it.
        assert 'process.env.SCHEDULED_TASK_ACTOR_ID' not in rendered

    def test_manual_trigger_requires_dedicated_role_not_bare_dual_auth(self):
        """cmd_787: the non-CRON_SECRET path must go through
        requireScheduledTaskRole (dual-auth PLUS a dedicated role check), not
        bare requireDualAuth -- the earlier version let any authenticated
        user or X-API-Key holder trigger a scheduled task, with no role or
        permission check at all."""
        rendered = _ENV.get_template('scheduled_task_route.ts.jinja2').render()
        assert "from '@/lib/api-auth'" in rendered
        assert 'requireScheduledTaskRole' in rendered
        assert 'await requireDualAuth(' not in rendered


class TestBuildUserSchemaKeySurvival:
    """Regression test for a real bug caught during the out-of-band consumer
    verification referenced above: `build_user_schema.py` reconstructs a
    paired entity's raw/view split from two explicit allowlists
    (`_ENTITY_LEVEL_DATA_KEYS` / `_VIEW_LEVEL_CONFIG_KEYS`) -- any key not on
    either list is silently dropped, not copied through by default. When
    `x-scheduled-task` was first added to generate.py/validate.py, it was
    never added to `_ENTITY_LEVEL_DATA_KEYS`, so the key vanished before
    generate.py ever saw it for any *paired* entity (e.g. inventory_reservation,
    which carries x-generate). This test pins that the key survives the raw/
    view split so this cannot silently regress again."""

    def test_x_scheduled_task_survives_raw_view_split(self):
        models = parse_prisma_schema(PRISMA_SCHEMA_PATH)
        model = models["role"]
        entry = {
            "fields": {"name": {"minLength": 1}},
            "x-generate": {"list": True, "view": True, "new": True, "edit": True, "delete": True},
            "x-scheduled-task": {
                "task_id": "role_expire",
                "filter": {"status_in": ["pending"]},
                "handler": "afterExpire",
                "interval": "*/15 * * * *",
            },
        }
        raw, _view = _build_raw_and_view("role", entry, models)
        assert raw.get("x-scheduled-task") == entry["x-scheduled-task"]


class TestXReadonlyFieldsScope:
    """cmd_874 subtask_874d: `x-readonly-fields` moved from
    `_ENTITY_LEVEL_DATA_KEYS` to `_VIEW_LEVEL_CONFIG_KEYS` in
    build_user_schema.py -- it must land on the reconstructed VIEW entity,
    not the shared RAW entity. Before this fix it landed on `raw`, so
    build_context.py (which reads the raw entity for entity-level
    annotations) saw one view's declaration applied to every other view of
    the same Prisma model -- a proxy view like `setting` (a second view of
    the `user` model) could not declare a readonly field without also
    making it readonly on the `user` view itself. See
    build_context.py's `_ro_from_entity` for the read-side half of this
    fix."""

    def test_x_readonly_fields_lands_on_view_not_raw(self):
        models = parse_prisma_schema(PRISMA_SCHEMA_PATH)
        model = models["role"]
        entry = {
            "fields": {"name": {"minLength": 1}},
            "x-generate": {"list": True, "view": True, "new": True, "edit": True, "delete": True},
            "x-readonly-fields": ["name"],
        }
        raw, view = _build_raw_and_view("role", entry, models)
        assert "x-readonly-fields" not in raw, (
            "x-readonly-fields must NOT be copied onto the raw entity -- "
            "that is the shared entity every view of this model resolves "
            "to, so anything placed there leaks across views"
        )
        assert view.get("x-readonly-fields") == ["name"]
