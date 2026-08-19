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
