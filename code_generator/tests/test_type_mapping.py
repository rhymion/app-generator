"""Tests for helpers/type_mapping.py — JSON Schema → TypeScript type mapping."""
import pytest
from helpers.type_mapping import get_ts_type


class TestPrimitiveTypes:
    def test_string(self):
        assert get_ts_type({"type": "string"}) == "string"

    def test_integer(self):
        assert get_ts_type({"type": "integer"}) == "number"

    def test_number(self):
        assert get_ts_type({"type": "number"}) == "number"

    def test_boolean(self):
        assert get_ts_type({"type": "boolean"}) == "boolean"

    def test_unknown_type_falls_back_to_any(self):
        assert get_ts_type({"type": "object"}) == "any"

    def test_missing_type_falls_back_to_any(self):
        assert get_ts_type({}) == "any"


class TestNumberForViewProps:
    def test_required_integer_for_view_props_is_nullable(self):
        # number fields default to null in FormUpsert, so view props expose number | null
        assert get_ts_type({"type": "integer"}, for_view_props=True) == "number | null"

    def test_required_number_for_view_props_is_nullable(self):
        assert get_ts_type({"type": "number"}, for_view_props=True) == "number | null"

    def test_required_integer_without_for_view_props_is_plain_number(self):
        assert get_ts_type({"type": "integer"}) == "number"

    def test_required_number_without_for_view_props_is_plain_number(self):
        assert get_ts_type({"type": "number"}) == "number"


class TestNullableTypes:
    def test_nullable_string(self):
        assert get_ts_type({"type": ["string", "null"]}) == "string | null"

    def test_nullable_integer(self):
        assert get_ts_type({"type": ["integer", "null"]}) == "number | null"

    def test_nullable_boolean(self):
        assert get_ts_type({"type": ["boolean", "null"]}) == "boolean | null"

    def test_null_listed_first(self):
        assert get_ts_type({"type": ["null", "string"]}) == "null | string"


class TestDateTimeTypes:
    def test_date_time_format(self):
        assert get_ts_type({"type": "string", "format": "date-time"}) == "Date"

    def test_date_format(self):
        assert get_ts_type({"type": "string", "format": "date"}) == "Date"

    def test_time_format(self):
        assert get_ts_type({"type": "string", "format": "time"}) == "Date"

    def test_nullable_date_time(self):
        assert get_ts_type({"type": ["string", "null"], "format": "date-time"}) == "Date | null"

    def test_date_for_view_props(self):
        # for_view_props=True always returns Date | null for date types
        assert get_ts_type({"type": "string", "format": "date-time"}, for_view_props=True) == "Date | null"

    def test_non_nullable_date_without_for_view_props(self):
        assert get_ts_type({"type": "string", "format": "date"}, for_view_props=False) == "Date"


class TestArrayType:
    def test_array_type_returns_any_array(self):
        assert get_ts_type({"type": "array"}) == "any[]"


class TestUriFormat:
    def test_uri_is_plain_string(self):
        # uri format does not map to a special TS type — stays as string
        assert get_ts_type({"type": "string", "format": "uri"}) == "string"


class TestPrismaNativeEnumUnion:
    """cmd_446 pilot: a Prisma nativeEnum-backed field (schema_deriver's
    `_prisma_native_enum_type` marker) emits a string-literal union matching
    Prisma's generated client type, instead of plain `string`."""

    def test_native_enum_emits_literal_union(self):
        prop = {
            "type": "string",
            "enum": ["pending", "rejected"],
            "_prisma_native_enum_type": "InventoryMovementStatus",
        }
        assert get_ts_type(prop) == "'pending' | 'rejected'"

    def test_native_enum_for_view_props_is_nullable_union(self):
        prop = {
            "type": "string",
            "enum": ["pending", "rejected"],
            "_prisma_native_enum_type": "InventoryMovementStatus",
        }
        assert get_ts_type(prop, for_view_props=True) == "'pending' | 'rejected' | null"

    def test_enum_without_native_marker_stays_plain_string(self):
        # A json-schema `enum:` constraint alone (no Prisma nativeEnum
        # backing) must NOT change the emitted type -- this keeps every
        # other entity's generated output byte-identical (golden diff = 0
        # outside inventory_movement.status).
        prop = {"type": "string", "enum": ["pending", "rejected"]}
        assert get_ts_type(prop) == "string"

    def test_native_enum_marker_without_enum_key_stays_plain_string(self):
        prop = {"type": "string", "_prisma_native_enum_type": "InventoryMovementStatus"}
        assert get_ts_type(prop) == "string"
