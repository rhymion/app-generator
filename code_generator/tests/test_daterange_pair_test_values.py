"""
cmd_577: date-range pair (x-reservation item-mode dateRange, e.g.
room_reservation's check_in/check_out) test-value generation.

Before this fix, all four value generators (prisma_value, cypress_create_value,
cypress_edit_value, api_value) picked a "range-end" field purely by a
name-keyword match ('end'/'logout'/'finish'). That heuristic is fragile and
consumer-specific — 'check_out' matches none of those keywords — so a
generated test creating a room_reservation could set check_in == check_out.
The product's own start<end validation (reserve{Entity}Core in
service.ts.jinja2) correctly rejects that, so a passing product surfaced as a
failing generated test (殿実測, cmd_569 ④ → cmd_577).

The fix threads the schema's own x-reservation.request.criteria.dateRange
declaration (start/end field names) through get_field_metas() as an
is_range_end flag, so the four value generators use a schema-driven signal
instead of guessing from the field name. A generated API boundary test
(5.2, in test_api_spec.cy.ts.jinja2) proves the opposite direction still
fails correctly: start == end must be rejected.
"""
from generators_test import (
    _date_range_fields,
    get_field_metas,
    prisma_value,
    cypress_create_value,
    cypress_edit_value,
    api_value,
    helper_context as _test_helper_context,
    api_spec_context,
)


def _room_reservation_schema() -> dict:
    return {
        "definitions": {
            "room": {
                "type": "object",
                "required": ["id", "room_no"],
                "properties": {
                    "id": {"type": "string"},
                    "room_no": {"type": "string"},
                },
                "x-display": {"table": [{"room_no": {"primary": True}}]},
            },
            "room_reservation": {
                "type": "object",
                "required": ["id", "guest_name", "room_id", "check_in", "check_out"],
                "properties": {
                    "id": {"type": "string"},
                    "guest_name": {"type": "string"},
                    "room_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "room", "labelField": "room_no"},
                    },
                    "check_in": {"type": "string", "format": "date"},
                    "check_out": {"type": "string", "format": "date"},
                    "creator_id": {"type": "string"},
                    "updater_id": {"type": "string"},
                },
                "x-display": {"table": [{"guest_name": {"primary": True}}]},
                "x-reservation": {
                    "mode": "item",
                    "pool": {"entity": "room"},
                    "request": {
                        "criteria": {
                            "room_id": "room_id",
                            "dateRange": {"start": "check_in", "end": "check_out"},
                        },
                    },
                    "policy": {"availabilitySource": "overlap"},
                    "result": {"allocatedField": "room_id"},
                },
            },
            "room_reservation_detail": {"type": "object", "properties": {}},
        }
    }


def _entity_cfg() -> dict:
    return {
        "list": True, "view": True, "new": True, "edit": True,
        "delete": True, "api": True, "test": True, "fields": None,
    }


# ---------------------------------------------------------------------------
# 1. _date_range_fields — extraction from x-reservation
# ---------------------------------------------------------------------------

class TestDateRangeFieldsExtraction:
    def test_returns_none_when_no_x_reservation(self):
        assert _date_range_fields({"properties": {}}) is None

    def test_returns_none_when_mode_is_not_item(self):
        model_def = {"x-reservation": {"mode": "count", "lines": "lines_prop"}}
        assert _date_range_fields(model_def) is None

    def test_extracts_start_end_from_criteria_daterange(self):
        model_def = _room_reservation_schema()["definitions"]["room_reservation"]
        assert _date_range_fields(model_def) == {"start": "check_in", "end": "check_out"}

    def test_extracts_start_end_from_legacy_request_level_daterange(self):
        model_def = {
            "x-reservation": {
                "mode": "item",
                "request": {"dateRange": {"start": "from_date", "end": "to_date"}},
            }
        }
        assert _date_range_fields(model_def) == {"start": "from_date", "end": "to_date"}

    def test_returns_none_when_item_mode_has_no_daterange(self):
        model_def = {"x-reservation": {"mode": "item", "request": {"criteria": {}}}}
        assert _date_range_fields(model_def) is None


# ---------------------------------------------------------------------------
# 2. get_field_metas — is_range_end tagging
# ---------------------------------------------------------------------------

class TestGetFieldMetasRangeEndTagging:
    def test_end_field_tagged_is_range_end(self):
        props = {
            "check_in": {"type": "string", "format": "date"},
            "check_out": {"type": "string", "format": "date"},
        }
        metas = get_field_metas(props, ["check_in", "check_out"], [], range_end_field="check_out")
        check_in = next(f for f in metas if f["prop_name"] == "check_in")
        check_out = next(f for f in metas if f["prop_name"] == "check_out")
        assert check_in["is_range_end"] is False
        assert check_out["is_range_end"] is True

    def test_no_range_end_field_defaults_false(self):
        props = {"due_date": {"type": "string", "format": "date"}}
        metas = get_field_metas(props, ["due_date"], [])
        assert metas[0]["is_range_end"] is False


# ---------------------------------------------------------------------------
# 3. Value generators — is_range_end produces a distinct, later value
# ---------------------------------------------------------------------------

class TestValueGeneratorsRangeEndValues:
    """Each of the four test-value generators must produce a value for the
    range-end field that differs from the (unmarked) start field, driven by
    is_range_end — not a name-keyword guess. 'check_out' is the concrete
    regression case: it matches none of ('end', 'logout', 'finish')."""

    def _pair(self, fmt: str):
        start = {"prop_name": "check_in", "category": "datetime", "format": fmt, "is_range_end": False}
        end = {"prop_name": "check_out", "category": "datetime", "format": fmt, "is_range_end": True}
        return start, end

    def test_prisma_value_date_format_differs(self):
        start, end = self._pair("date")
        start_val = prisma_value(start, "1", "Room Reservation")
        end_val = prisma_value(end, "1", "Room Reservation")
        assert start_val != end_val
        assert "Date.UTC(2025, 0, 1)" in start_val
        assert "Date.UTC(2025, 0, 1 + 1)" in end_val

    def test_prisma_value_loop_index_still_differs(self):
        start, end = self._pair("date")
        assert prisma_value(start, "i", "Room Reservation") != prisma_value(end, "i", "Room Reservation")

    def test_cypress_create_value_differs(self):
        start, end = self._pair("date")
        assert cypress_create_value(start, "Room Reservation") != cypress_create_value(end, "Room Reservation")

    def test_cypress_edit_value_differs(self):
        """Regression: cypress_edit_value's 'date' branch previously ignored the
        field entirely, always returning the same literal for every date field
        — so editing both fields of a pair produced check_in == check_out too."""
        start, end = self._pair("date")
        assert cypress_edit_value(start, "Room Reservation") != cypress_edit_value(end, "Room Reservation")

    def test_api_value_differs(self):
        start, end = self._pair("date")
        assert api_value(start, "Room Reservation") != api_value(end, "Room Reservation")

    def test_unmarked_check_out_matches_check_in_without_the_fix(self):
        """Documents the actual bug: absent is_range_end, a field literally
        named 'check_out' is indistinguishable from 'check_in' to every
        legacy keyword-based branch — proving the keyword heuristic alone
        could never have covered this consumer's naming."""
        unmarked_end = {"prop_name": "check_out", "category": "datetime", "format": "date", "is_range_end": False}
        start = {"prop_name": "check_in", "category": "datetime", "format": "date", "is_range_end": False}
        assert prisma_value(unmarked_end, "1", "X") == prisma_value(start, "1", "X")
        assert api_value(unmarked_end, "X") == api_value(start, "X")


# ---------------------------------------------------------------------------
# 4. helper_context — end-to-end: check_in/check_out get distinct prisma values
# ---------------------------------------------------------------------------

class TestHelperContextEndToEnd:
    def test_check_in_check_out_get_distinct_prisma_values(self):
        schema = _room_reservation_schema()
        ctx = _test_helper_context(
            "room_reservation", [], schema, "room_reservation", "room_reservation_detail", _entity_cfg(),
        )
        fields = {f["prop_name"]: f for f in ctx["all_fields_prisma"]}
        assert fields["check_in"]["prisma_val"] != fields["check_out"]["prisma_val"]
        assert fields["check_in"]["prisma_val_fixed"] != fields["check_out"]["prisma_val_fixed"]


# ---------------------------------------------------------------------------
# 5. api_spec_context — end-to-end: create body differs, boundary body matches
# ---------------------------------------------------------------------------

class TestApiSpecContextEndToEnd:
    def test_post_body_create_check_in_and_check_out_differ(self):
        schema = _room_reservation_schema()
        ctx = api_spec_context(
            "room_reservation", [], schema, "room_reservation", "room_reservation_detail", _entity_cfg(),
        )
        lines = ctx["post_body_create"]
        check_in_val = next(ln for ln in lines if ln.strip().startswith("check_in:")).split("check_in:", 1)[1]
        check_out_val = next(ln for ln in lines if ln.strip().startswith("check_out:")).split("check_out:", 1)[1]
        assert check_in_val != check_out_val

    def test_date_range_boundary_context_populated(self):
        schema = _room_reservation_schema()
        ctx = api_spec_context(
            "room_reservation", [], schema, "room_reservation", "room_reservation_detail", _entity_cfg(),
        )
        assert ctx["date_range_boundary"] == {"start_field": "check_in", "end_field": "check_out"}

    def test_boundary_post_body_sets_end_field_equal_to_start_field(self):
        """The generated boundary test's request body must actually violate the
        rule under test (check_in == check_out) — proves the template exercises
        the real validation, not a value that happens to already differ."""
        schema = _room_reservation_schema()
        ctx = api_spec_context(
            "room_reservation", [], schema, "room_reservation", "room_reservation_detail", _entity_cfg(),
        )
        lines = ctx["post_body_daterange_boundary"]
        check_in_val = next(ln for ln in lines if ln.strip().startswith("check_in:")).split("check_in:", 1)[1]
        check_out_val = next(ln for ln in lines if ln.strip().startswith("check_out:")).split("check_out:", 1)[1]
        assert check_in_val == check_out_val

    def test_no_boundary_context_when_entity_has_no_date_range(self):
        schema = {
            "definitions": {
                "task": {
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
                    "x-display": {"table": [{"name": {"primary": True}}]},
                },
                "task_detail": {"type": "object", "properties": {}},
            }
        }
        ctx = api_spec_context("task", [], schema, "task", "task_detail", _entity_cfg())
        assert ctx["date_range_boundary"] is None
        assert ctx["post_body_daterange_boundary"] == ctx["post_body_create"]
