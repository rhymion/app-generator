"""Tests for x-scheduled-task entity-level validation
(cmd_750 / subtask_741a, Section 15 of validate_schema).

x-scheduled-task is a generic recurring-execution mechanism -- entity-level,
same design language as x-ledger-source -- with expires_at-based release as
its first user, not a special case baked into the generator. These tests
pin the schema-level contract independently of any concrete consumer entity
(inventory_reservation, the first user, lives in a consumer schema, not this
generator's own default one -- see subtask_750c correction_0730).
"""
import pytest
from validate import validate_schema, SchemaValidationError


def _schema(entity: str, x_scheduled_task: dict, extra_props: dict | None = None) -> dict:
    props = {'name': {'type': 'string'}}
    if extra_props:
        props.update(extra_props)
    return {
        'definitions': {
            entity: {
                'properties': props,
                'x-scheduled-task': x_scheduled_task,
            },
        },
    }


_VALID_EXPIRES = {
    'task_id': 'widget_expire',
    'filter': {'expires_at_before_now': True},
    'handler': 'afterExpire',
    'interval': '*/15 * * * *',
}


class TestValidDeclarationPasses:
    def test_expires_at_before_now_with_expires_at_field_passes(self):
        schema = _schema(
            'widget', _VALID_EXPIRES,
            extra_props={'expires_at': {'type': 'string', 'format': 'date-time'}},
        )
        validate_schema(schema)  # must not raise

    def test_status_in_with_status_field_passes(self):
        schema = _schema(
            'widget',
            {
                'task_id': 'widget_timeout',
                'filter': {'status_in': ['pending', 'active']},
                'handler': 'afterTimeout',
                'interval': '0 * * * *',
            },
            extra_props={'status': {'type': 'string', 'enum': ['pending', 'active', 'expired']}},
        )
        validate_schema(schema)  # must not raise

    def test_both_filter_conditions_together_pass(self):
        schema = _schema(
            'widget',
            {
                'task_id': 'widget_expire',
                'filter': {'expires_at_before_now': True, 'status_in': ['pending', 'active']},
                'handler': 'afterExpire',
                'interval': '*/15 * * * *',
            },
            extra_props={
                'expires_at': {'type': 'string', 'format': 'date-time'},
                'status': {'type': 'string', 'enum': ['pending', 'active', 'expired']},
            },
        )
        validate_schema(schema)  # must not raise

    def test_no_x_scheduled_task_passes(self):
        schema = {'definitions': {'widget': {'properties': {'name': {'type': 'string'}}}}}
        validate_schema(schema)  # must not raise


class TestTaskIdRequiredAndUnique:
    def test_missing_task_id_rejected(self):
        bad = dict(_VALID_EXPIRES)
        del bad['task_id']
        schema = _schema('widget', bad, extra_props={'expires_at': {'type': 'string'}})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'task_id' in str(exc_info.value)

    def test_duplicate_task_id_across_entities_rejected(self):
        schema = {
            'definitions': {
                'widget': {
                    'properties': {'expires_at': {'type': 'string'}},
                    'x-scheduled-task': dict(_VALID_EXPIRES, task_id='dup_task'),
                },
                'gadget': {
                    'properties': {'expires_at': {'type': 'string'}},
                    'x-scheduled-task': dict(_VALID_EXPIRES, task_id='dup_task'),
                },
            },
        }
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert 'dup_task' in msg
        assert 'widget' in msg
        assert 'gadget' in msg


class TestHandlerAndIntervalRequired:
    def test_missing_handler_rejected(self):
        bad = dict(_VALID_EXPIRES)
        del bad['handler']
        schema = _schema('widget', bad, extra_props={'expires_at': {'type': 'string'}})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'handler' in str(exc_info.value)

    def test_handler_not_valid_identifier_rejected(self):
        bad = dict(_VALID_EXPIRES, handler='not a valid identifier')
        schema = _schema('widget', bad, extra_props={'expires_at': {'type': 'string'}})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'handler' in str(exc_info.value)

    def test_missing_interval_rejected(self):
        bad = dict(_VALID_EXPIRES)
        del bad['interval']
        schema = _schema('widget', bad, extra_props={'expires_at': {'type': 'string'}})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'interval' in str(exc_info.value)


class TestFilterShapeAndFieldExistence:
    def test_empty_filter_rejected(self):
        bad = dict(_VALID_EXPIRES, filter={})
        schema = _schema('widget', bad, extra_props={'expires_at': {'type': 'string'}})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'filter' in str(exc_info.value)

    def test_expires_at_before_now_without_expires_at_field_rejected(self):
        """Deviation injection: expires_at_before_now:true declared on an
        entity with no expires_at property must be rejected, not silently
        generate a query referencing a nonexistent column."""
        schema = _schema('widget', _VALID_EXPIRES)  # no expires_at prop
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert 'expires_at' in msg

    def test_status_in_without_status_field_rejected(self):
        bad = {
            'task_id': 'widget_timeout',
            'filter': {'status_in': ['pending']},
            'handler': 'afterTimeout',
            'interval': '0 * * * *',
        }
        schema = _schema('widget', bad)  # no status prop
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'status' in str(exc_info.value)

    def test_status_in_empty_list_rejected(self):
        bad = {
            'task_id': 'widget_timeout',
            'filter': {'status_in': []},
            'handler': 'afterTimeout',
            'interval': '0 * * * *',
        }
        schema = _schema('widget', bad, extra_props={'status': {'type': 'string'}})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'status_in' in str(exc_info.value)


class TestVercelCronCountLimit:
    """cmd_781 AC5: Vercel's 100-cron-jobs-per-project limit (all plans,
    docs/knowledge/scheduled-task-operations.md) must fail generation loudly
    -- not silently truncate vercel.json's `crons` array at deploy time."""

    @staticmethod
    def _many_entities_schema(count: int, x_cloud: dict | None = None) -> dict:
        defs = {}
        for i in range(count):
            defs[f'widget_{i}'] = {
                'properties': {
                    'name': {'type': 'string'},
                    'status': {'type': 'string', 'enum': ['pending', 'active']},
                },
                'x-scheduled-task': {
                    'task_id': f'widget_{i}_timeout',
                    'filter': {'status_in': ['pending']},
                    'handler': 'afterTimeout',
                    'interval': '0 * * * *',
                },
            }
        schema = {'definitions': defs}
        if x_cloud is not None:
            schema['x-cloud'] = x_cloud
        return schema

    def test_101_entities_rejected(self):
        schema = self._many_entities_schema(101)
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert '100' in msg
        assert '101' in msg

    def test_100_entities_passes(self):
        schema = self._many_entities_schema(100)
        validate_schema(schema)  # must not raise

    def test_101_entities_under_gcp_cloud_passes(self):
        """GCP deployments don't write vercel.json crons at all (Cloud
        Scheduler instead) -- the Vercel-specific limit must not apply."""
        schema = self._many_entities_schema(
            101, x_cloud={'enabled': True, 'provider': 'gcp'},
        )
        validate_schema(schema)  # must not raise

    def test_limit_counts_bulk_and_entity_level_together(self):
        """The 100-cron limit is a single shared budget: one entity-level
        task plus 100 bulk tasks (101 total) must be rejected."""
        schema = self._many_entities_schema(1)
        schema['x-scheduled-tasks'] = [
            {'task_id': f'bulk_{i}', 'handler': 'runBulk', 'interval': '0 3 * * *'}
            for i in range(100)
        ]
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert '100' in msg
        assert '101' in msg


_VALID_BULK = {
    'task_id': 'demo_reset',
    'handler': 'resetDemo',
    'interval': '0 3 * * *',
}


class TestBulkScheduledTasksValidDeclarationPasses:
    """x-scheduled-tasks (cmd_790): top-level, entity-agnostic bulk mode --
    no row selection, no `filter`, calls its handler once per run."""

    def test_valid_bulk_task_passes(self):
        schema = {'definitions': {}, 'x-scheduled-tasks': [dict(_VALID_BULK)]}
        validate_schema(schema)  # must not raise

    def test_multiple_bulk_tasks_pass(self):
        schema = {
            'definitions': {},
            'x-scheduled-tasks': [
                dict(_VALID_BULK),
                dict(_VALID_BULK, task_id='nightly_cleanup', handler='nightlyCleanup'),
            ],
        }
        validate_schema(schema)  # must not raise

    def test_absent_key_passes(self):
        schema = {'definitions': {'widget': {'properties': {'name': {'type': 'string'}}}}}
        validate_schema(schema)  # must not raise (no x-scheduled-tasks at all)

    def test_bulk_and_entity_level_coexist(self):
        schema = _schema('widget', _VALID_EXPIRES, extra_props={'expires_at': {'type': 'string'}})
        schema['x-scheduled-tasks'] = [dict(_VALID_BULK)]
        validate_schema(schema)  # must not raise


class TestBulkScheduledTasksShapeAndRequiredFields:
    def test_not_a_list_rejected(self):
        schema = {'definitions': {}, 'x-scheduled-tasks': {'task_id': 'demo_reset'}}
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'x-scheduled-tasks' in str(exc_info.value)

    def test_item_not_a_mapping_rejected(self):
        schema = {'definitions': {}, 'x-scheduled-tasks': ['demo_reset']}
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'x-scheduled-tasks[0]' in str(exc_info.value)

    def test_missing_task_id_rejected(self):
        bad = dict(_VALID_BULK)
        del bad['task_id']
        schema = {'definitions': {}, 'x-scheduled-tasks': [bad]}
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'task_id' in str(exc_info.value)

    def test_missing_handler_rejected(self):
        bad = dict(_VALID_BULK)
        del bad['handler']
        schema = {'definitions': {}, 'x-scheduled-tasks': [bad]}
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'handler' in str(exc_info.value)

    def test_handler_not_valid_identifier_rejected(self):
        bad = dict(_VALID_BULK, handler='not a valid identifier')
        schema = {'definitions': {}, 'x-scheduled-tasks': [bad]}
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'handler' in str(exc_info.value)

    def test_missing_interval_rejected(self):
        bad = dict(_VALID_BULK)
        del bad['interval']
        schema = {'definitions': {}, 'x-scheduled-tasks': [bad]}
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'interval' in str(exc_info.value)

    def test_filter_key_rejected(self):
        """Bulk mode has no row selection -- `filter` is an entity-level-only
        concept and must not be silently accepted/ignored here."""
        bad = dict(_VALID_BULK, filter={'status_in': ['pending']})
        schema = {'definitions': {}, 'x-scheduled-tasks': [bad]}
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert 'filter' in msg
        assert 'unknown key' in msg


class TestBulkScheduledTasksTaskIdNamespaceSharedWithEntityLevel:
    def test_duplicate_task_id_within_bulk_list_rejected(self):
        schema = {
            'definitions': {},
            'x-scheduled-tasks': [
                dict(_VALID_BULK),
                dict(_VALID_BULK, handler='otherHandler'),
            ],
        }
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'demo_reset' in str(exc_info.value)

    def test_duplicate_task_id_against_entity_level_rejected(self):
        """cmd_790: entity-level x-scheduled-task and top-level
        x-scheduled-tasks share one task_id namespace (both feed the same
        TASK_REGISTRY / /api/scheduled-tasks/[task] route)."""
        schema = _schema(
            'widget', dict(_VALID_EXPIRES, task_id='shared_task'),
            extra_props={'expires_at': {'type': 'string'}},
        )
        schema['x-scheduled-tasks'] = [dict(_VALID_BULK, task_id='shared_task')]
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert 'shared_task' in str(exc_info.value)
