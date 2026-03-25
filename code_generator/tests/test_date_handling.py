"""
Tests for date-only field (format: date / @db.Date) handling across the generator.

Covers three areas where timezone-safe patterns are required:

1. generators_test.prisma_value / _get_dep_populate_fields
   - format: date  → Date.UTC to avoid local-midnight timezone shift in test data
   - format: date-time / time → unchanged (local new Date())

2. generators_test helper context
   - External optional-FK list children (e.g. feature.bugs) must NOT be added to
     populateDependencies — they are populated separately via db:populate{Target}.
   - M2M external children (e.g. user.roles) ARE still added to deps.
   - Self-referential optional-FK children ARE still added to deps.

3. generators.form_upsert_context / form_view_context
   - FormView date_time expr uses new Date(...).toISOString().slice(0,10)+'T00:00:00'
   - FormUpsert state init uses dayjs(...toISOString().slice(0,10)+'T00:00:00')
   - FormData set uses .format('YYYY-MM-DD') not .toISOString()
"""
import pytest
from build_context import build_context
from generators import form_upsert_context
from generators_test import (
    prisma_value,
    _get_dep_populate_fields,
    _get_dep_extra_required_fields,
    test_helper_context as _test_helper_context,
    get_child_render_type,
    analyze_children,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _date_field(fmt: str, nullable: bool = True) -> dict:
    t = ["string", "null"] if nullable else "string"
    return {"type": t, "format": fmt}


def _text_field() -> dict:
    return {"type": "string"}


def _fk_field(target: str, nullable: bool = True) -> dict:
    t = ["string", "null"] if nullable else "string"
    return {
        "type": t,
        "pattern": "^c[a-z0-9]{24,}$",
        "x-relationship": {"type": "many-to-one", "target": target, "labelField": "name"},
    }


def _make_field_meta(prop_name: str, fmt: str) -> dict:
    """Minimal field meta dict as produced by get_field_metas."""
    return {
        'prop_name': prop_name,
        'label': prop_name.replace('_', ' ').title(),
        'category': 'datetime',
        'format': fmt,
        'required': False,
        'min': None,
        'max': None,
        'enum_values': None,
        'dep_target': None,
    }


# ---------------------------------------------------------------------------
# 1. prisma_value — Date.UTC for format: date
# ---------------------------------------------------------------------------

class TestPrismaValueDateFormat:
    def test_date_format_uses_date_utc(self):
        field = _make_field_meta('due_date', 'date')
        result = prisma_value(field, 'i', 'Task')
        assert 'Date.UTC' in result, "format:date must use Date.UTC to avoid timezone shift"
        assert 'toISOString' in result

    def test_datetime_format_uses_local_new_date(self):
        field = _make_field_meta('start_time', 'date-time')
        result = prisma_value(field, 'i', 'Task')
        assert 'Date.UTC' not in result, "format:date-time must not use Date.UTC"
        assert 'new Date(2025' in result

    def test_time_format_uses_local_new_date(self):
        field = _make_field_meta('open_time', 'time')
        result = prisma_value(field, 'i', 'Task')
        assert 'Date.UTC' not in result

    def test_date_format_end_field_still_uses_date_utc(self):
        field = _make_field_meta('end_date', 'date')
        result = prisma_value(field, 'i', 'Task')
        assert 'Date.UTC' in result


# ---------------------------------------------------------------------------
# 2. _get_dep_populate_fields — Date.UTC for format: date
# ---------------------------------------------------------------------------

class TestDepPopulateFieldsDateFormat:
    def _schema_with_date(self, fmt: str) -> dict:
        return {
            "definitions": {
                "task": {
                    "type": "object",
                    "required": ["id", "name", "due_date"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "due_date": {"type": "string", "format": fmt},
                        "creator_id": {"type": "string"},
                        "updater_id": {"type": "string"},
                    },
                }
            }
        }

    def test_date_format_dep_field_uses_date_utc(self):
        schema = self._schema_with_date('date')
        fields = _get_dep_populate_fields('task', 'task', 'Task', schema)
        date_field = next((f for f in fields if f['prop_name'] == 'due_date'), None)
        assert date_field is not None
        assert 'Date.UTC' in date_field['prisma_val']

    def test_datetime_format_dep_field_uses_local_new_date(self):
        schema = self._schema_with_date('date-time')
        fields = _get_dep_populate_fields('task', 'task', 'Task', schema)
        dt_field = next((f for f in fields if f['prop_name'] == 'due_date'), None)
        assert dt_field is not None
        assert 'Date.UTC' not in dt_field['prisma_val']
        assert 'new Date(2025' in dt_field['prisma_val']


# ---------------------------------------------------------------------------
# 3. _get_dep_extra_required_fields — Date.UTC for format: date
# ---------------------------------------------------------------------------

class TestDepExtraRequiredFieldsDateFormat:
    def _schema(self, fmt: str) -> dict:
        return {
            "definitions": {
                "booking": {
                    "type": "object",
                    "required": ["id", "check_in"],
                    "properties": {
                        "id": {"type": "string"},
                        "check_in": {"type": "string", "format": fmt},
                        "creator_id": {"type": "string"},
                        "updater_id": {"type": "string"},
                    },
                }
            }
        }

    def test_date_format_uses_date_utc(self):
        schema = self._schema('date')
        fields = _get_dep_extra_required_fields('booking', schema)
        check_in = next((f for f in fields if f['prop_name'] == 'check_in'), None)
        assert check_in is not None
        assert 'Date.UTC' in check_in['prisma_val']

    def test_datetime_format_uses_local_new_date(self):
        schema = self._schema('date-time')
        fields = _get_dep_extra_required_fields('booking', schema)
        check_in = next((f for f in fields if f['prop_name'] == 'check_in'), None)
        assert check_in is not None
        assert 'Date.UTC' not in check_in['prisma_val']


# ---------------------------------------------------------------------------
# 4. test_helper_context — external optional-FK list children excluded from deps
# ---------------------------------------------------------------------------

def _entity(model: str, children: list = None) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": children or [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": True, "fields": None,
        },
    }


def _call_test_helper_context(entity: dict, schema: dict) -> dict:
    """Adapter: call test_helper_context with individual params from entity dict."""
    return _test_helper_context(
        parent=entity["parent"],
        children=entity["children"],
        schema=schema,
        model_name=entity["model"],
        definition_key=entity["definition_key"],
        generate_config=entity["generate_config"],
    )


class TestHelperContextDepsExclusion:
    """
    External optional-FK reverse list children (e.g. feature.bugs where bug has
    optional feature_id) must NOT be added to populateDependencies — they are
    populated separately so the test can use the standard 'Bug 1' naming.
    M2M external children (e.g. user.roles) and self-ref children ARE included.
    """

    def _feature_schema(self) -> dict:
        """Feature with required epic FK and optional-FK reverse bugs list."""
        return {
            "definitions": {
                "feature": {
                    "type": "object",
                    "required": ["id", "name", "epic_id"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "epic_id": _fk_field("epic", nullable=False),
                        "creator_id": {"type": "string"},
                        "updater_id": {"type": "string"},
                    },
                },
                "feature_detail": {
                    "type": "object",
                    "allOf": [{"required": ["epic_id"]}],
                    "properties": {},
                },
                "epic": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "creator_id": {"type": "string"},
                        "updater_id": {"type": "string"},
                    },
                },
                "bug": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        # optional FK back to feature
                        "feature_id": _fk_field("feature", nullable=True),
                        "creator_id": {"type": "string"},
                        "updater_id": {"type": "string"},
                    },
                },
            }
        }

    def _bugs_child(self) -> dict:
        return {
            "name": "bug",
            "property_name": "bugs",
            "output_type": "list",
            "file_type": None,
            "relationship": None,
        }

    def _epic_child(self) -> dict:
        return {
            "name": "epic",
            "property_name": "epics",
            "output_type": None,
            "file_type": None,
            "relationship": None,
        }

    def test_optional_fk_reverse_child_excluded_from_deps(self):
        """bug has optional feature_id → rendered as editable-list-autocomplete,
        but must NOT appear in populateFeatureDependencies."""
        schema = self._feature_schema()
        children = [self._bugs_child()]
        entity = _entity("feature", children)
        ctx = _call_test_helper_context(entity, schema)
        dep_targets = [d["target"] for d in ctx["deps"]]
        assert "bug" not in dep_targets, (
            "External optional-FK reverse list child 'bug' must not be a dep; "
            "it should be populated via db:populateBug"
        )

    def _user_schema_with_m2m_roles(self) -> dict:
        return {
            "definitions": {
                "user_account": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "creator_id": {"type": "string"},
                        "updater_id": {"type": "string"},
                    },
                },
                "user_account_detail": {
                    "type": "object",
                    "properties": {},
                },
                "role": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "creator_id": {"type": "string"},
                        "updater_id": {"type": "string"},
                    },
                },
            }
        }

    def _roles_m2m_child(self) -> dict:
        return {
            "name": "role",
            "property_name": "roles",
            "output_type": "list",
            "file_type": None,
            "relationship": {"type": "many-to-many", "target": "role"},
        }

    def test_m2m_external_child_included_in_deps(self):
        """M2M child pointing to external entity (user.roles → role) IS a dep
        because the join requires the related entity to exist."""
        schema = self._user_schema_with_m2m_roles()
        children = [self._roles_m2m_child()]
        entity = _entity("user_account", children)
        ctx = _call_test_helper_context(entity, schema)
        dep_targets = [d["target"] for d in ctx["deps"]]
        assert "role" in dep_targets, (
            "M2M external child 'role' must remain in deps"
        )


# ---------------------------------------------------------------------------
# 5. form_upsert_context — date-only field state init and formData serialization
# ---------------------------------------------------------------------------

def _base_props(extra: dict = None) -> dict:
    props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
    }
    props.update(extra or {})
    return props


def _build_upsert_ctx(model: str, extra_props: dict, schema_extra: dict = None) -> dict:
    schema = {
        "definitions": {
            model: {
                "type": "object",
                "required": ["id", "name"],
                "properties": _base_props(extra_props),
            },
            f"{model}_detail": {"type": "object", "properties": {}},
        }
    }
    if schema_extra:
        schema["definitions"].update(schema_extra)
    entity = {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }
    ctx = build_context(entity, schema)
    return form_upsert_context(ctx, schema)


class TestFormUpsertDateOnlyField:
    def _ctx(self) -> dict:
        return _build_upsert_ctx("task", {
            "due_date": {"type": ["string", "null"], "format": "date"},
        })

    def test_state_init_uses_toiso_slice_local_midnight(self):
        """State initialization must use toISOString().slice(0,10)+'T00:00:00'
        so the dayjs value is parsed as local midnight, not UTC midnight."""
        ctx = self._ctx()
        states: str = ctx["all_states"]
        assert "toISOString().slice(0, 10) + 'T00:00:00'" in states
        assert "dayjs(" in states

    def test_state_init_does_not_use_bare_dayjs_src(self):
        """Must not use dayjs(src.due_date) directly — that applies timezone offset."""
        ctx = self._ctx()
        states: str = ctx["all_states"]
        assert "dayjs(src.due_date)" not in states

    def test_formdata_set_uses_format_yyyy_mm_dd(self):
        """FormData serialization must use .format('YYYY-MM-DD'), not .toISOString(),
        so the server receives a date-only string parsed as UTC midnight."""
        ctx = self._ctx()
        form_data_sets: str = ctx["parent_form_data_sets"]
        assert "format('YYYY-MM-DD')" in form_data_sets
        assert "toISOString()" not in form_data_sets

    def test_datetime_field_still_uses_toiso(self):
        """format:date-time fields must continue using .toISOString()."""
        ctx = _build_upsert_ctx("event", {
            "start_time": {"type": ["string", "null"], "format": "date-time"},
        })
        form_data_sets: str = ctx["parent_form_data_sets"]
        assert "toISOString()" in form_data_sets
        assert "format('YYYY-MM-DD')" not in form_data_sets

    def test_datetime_state_init_uses_bare_dayjs_src(self):
        """format:date-time state init uses dayjs(src.field) — no slice needed."""
        ctx = _build_upsert_ctx("event", {
            "start_time": {"type": ["string", "null"], "format": "date-time"},
        })
        states: str = ctx["all_states"]
        assert "dayjs(src.start_time)" in states


# ---------------------------------------------------------------------------
# 6. form_view_context — date_time expression uses local-midnight conversion
# ---------------------------------------------------------------------------

from generators import form_view_context


def _build_view_ctx(model: str, extra_props: dict) -> dict:
    schema = {
        "definitions": {
            model: {
                "type": "object",
                "required": ["id", "name"],
                "properties": _base_props(extra_props),
            },
            f"{model}_detail": {"type": "object", "properties": {}},
        }
    }
    entity = {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }
    ctx = build_context(entity, schema)
    return form_view_context(ctx)


class TestFormViewDateOnlyField:
    def _ctx(self) -> dict:
        return _build_view_ctx("task", {
            "due_date": {"type": ["string", "null"], "format": "date"},
        })

    def test_date_field_uses_toiso_slice_local_midnight(self):
        """FormView date_time prop must convert the UTC-midnight Date from Prisma to
        local midnight via toISOString().slice(0,10)+'T00:00:00' so dayjs() displays
        the correct calendar date in all timezones."""
        ctx = self._ctx()
        jsx: str = ctx["all_parent_fields"]
        assert "toISOString().slice(0, 10) + 'T00:00:00'" in jsx

    def test_date_field_does_not_pass_src_directly(self):
        """Must not pass src.due_date directly — that is UTC midnight and shifts the
        displayed date in western timezones."""
        ctx = self._ctx()
        jsx: str = ctx["all_parent_fields"]
        assert "date_time={src.due_date}" not in jsx

    def test_datetime_field_passes_src_directly(self):
        """format:date-time passes src field directly — no conversion needed."""
        ctx = _build_view_ctx("event", {
            "start_time": {"type": ["string", "null"], "format": "date-time"},
        })
        jsx: str = ctx["all_parent_fields"]
        assert "date_time={src.start_time}" in jsx
