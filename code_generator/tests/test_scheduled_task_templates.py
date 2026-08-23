"""Rendering tests for the x-scheduled-task generic mechanism templates
(cmd_750 / subtask_741a).

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
}

_TIMEOUT_ENTITY = {
    'snake_name': 'approval_request',
    'pascal_name': 'ApprovalRequest',
    'task_id': 'approval_request_timeout_release',
    'handler': 'afterTimeout',
    'interval': '0 * * * *',
    'expires_at_before_now': False,
    'status_in': ['pending'],
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
        by db:seed-tenant, so there is nothing to separately configure."""
        rendered = _ENV.get_template('scheduled_task_route.ts.jinja2').render()
        assert "from '@/lib/scheduled-tasks/system-actor'" in rendered
        assert 'SCHEDULED_TASK_ACTOR_EMAIL' in rendered
        # The old env var name may still appear in a "here's what this
        # replaces" comment -- what must be gone is any functional read of it.
        assert 'process.env.SCHEDULED_TASK_ACTOR_ID' not in rendered


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
