"""
Regression test for Issue #1155.

On the REST PUT route an omitted write-only field (password, api_key, ...)
used to reach the service as `null` (`password ?? null`), which the update
wrote as an explicit clear. The Server Action path treats an empty value as
"leave unchanged" (`password === '' ? undefined : password`), so the REST
update now passes `''` for an omitted write-only field and the service's
own normalization turns it into `undefined` (Prisma omits the column).
"""
from build_context import build_context


def _schema() -> dict:
    secret = {
        "type": ["string", "null"],
        "x-custom-component": {"target": ["upsert"]},
    }
    return {
        "definitions": {
            "account": {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": True, "test": False},
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                    "note": {"type": ["string", "null"]},
                    "password": dict(secret),
                    "api_key": dict(secret),
                },
            },
        }
    }


def _ctx() -> dict:
    entity = {
        "parent": "account",
        "model": "account",
        "definition_key": "account",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }
    return build_context(entity, _schema())


class TestRestUpdateWriteOnlyOmitted:
    def test_update_passes_empty_sentinel_for_write_only_fields(self):
        args = _ctx()["service_args_for_update"]
        assert "password ?? ''" in args
        assert "apiKey ?? ''" in args
        assert "password ?? null" not in args
        assert "apiKey ?? null" not in args

    def test_update_keeps_null_default_for_ordinary_nullable_field(self):
        assert "note ?? null" in _ctx()["service_args_for_update"]

    def test_create_is_unchanged(self):
        args = _ctx()["service_args_for_create"]
        assert "password ?? null" in args
        assert "apiKey ?? null" in args

    def test_service_maps_empty_write_only_value_to_omitted_column(self):
        ctx = _ctx()
        assert "password === '' ? undefined : password" in ctx["parent_data_obj_update"]
        assert "apiKey === '' ? undefined : apiKey" in ctx["parent_data_obj_update"]
