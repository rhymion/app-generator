"""
Detail view (FormView) of an x-reservation mode:item entity.

The allocated foreign key (result.allocatedField, e.g. room_reservation.room_id)
is an ordinary relationship field, so the generic field path already renders it
once, as a labelled relation link. The template used to append a second,
raw-id text field for it whose label key ('room_id') has no entry in the Fields
messages, so the page showed the literal "Fields.room_id" next to the related
record. The edit form never had the extra field.

These tests render the real template and assert the allocated FK appears
exactly once in the detail view, and that the edit form is unaffected.
"""
import re

from build_context import build_context
from generate import _make_env, _render
from generators import form_upsert_context, form_view_context
from tests.test_daterange_pair_test_values import _entity_cfg, _room_reservation_schema


def _entity(model: str) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": model,
        "children": [],
        "generate_config": _entity_cfg(),
    }


def _render_view(schema: dict, model: str) -> str:
    ctx = build_context(_entity(model), schema)
    return _render(_make_env(), "form_view.tsx.jinja2", {**ctx, **form_view_context(ctx, schema)})


def _render_upsert(schema: dict, model: str) -> str:
    ctx = build_context(_entity(model), schema)
    return _render(_make_env(), "form_upsert.tsx.jinja2", {**ctx, **form_upsert_context(ctx, schema)})


class TestItemReservationAllocatedFkInDetailView:
    def test_allocated_fk_is_rendered_once_as_a_relation(self):
        out = _render_view(_room_reservation_schema(), "room_reservation")
        assert out.count("label={tf('room')}") == 1
        assert "/room/view/${src.room_id}" in out

    def test_no_raw_id_field_with_untranslated_label(self):
        out = _render_view(_room_reservation_schema(), "room_reservation")
        assert "tf('room_id')" not in out
        assert not re.search(r"String\(\(src as Record<string, unknown>\)\.room_id", out)

    def test_edit_form_unchanged(self):
        out = _render_upsert(_room_reservation_schema(), "room_reservation")
        assert "tf('room_id')" not in out
        assert out.count("label={tf('room')}") == 1
