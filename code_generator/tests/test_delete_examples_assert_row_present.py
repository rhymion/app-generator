"""
Generated delete examples (4.1, 4.2, 4.3) assert the targeted rows exist
before deleting, also for an entity whose list has no unique primary link.

With a unique primary link the examples check `cy.contains(...)` visibility
before the delete and `not.exist` after it. Without one, only the closing
row-count check was emitted, so an example that found nothing to delete had
no explicit precondition. The no-unique branch now asserts the populated row
count before it deletes.
"""
import re

from generate import _make_env, _render
from generators_test import spec_context

from test_e2e_context import _entity, _string_enum_primary_schema


def _rendered(unique: bool) -> str:
    schema = _string_enum_primary_schema()
    ctx = spec_context(
        "task_item", [], schema, "task_item", "task_item_detail",
        _entity("task_item")["generate_config"],
    )
    ctx["list_id_is_unique"] = unique
    return _render(_make_env(), "test_spec.cy.ts.jinja2", ctx)


def _example(rendered: str, number: str) -> str:
    m = re.search(rf"it\('{re.escape(number)} .*?\n    \}}\);", rendered, re.S)
    assert m, f"example {number} not found in rendered spec"
    return m.group(0)


def test_no_unique_primary_link_asserts_row_count_before_delete():
    rendered = _rendered(unique=False)
    for number, count in (("4.1", 2), ("4.2", 3)):
        body = _example(rendered, number)
        pre = f"getDataGridTotalRowCount().should('eq', {count});"
        assert pre in body
        assert body.index(pre) < body.index("Delete Selected")
    body = _example(rendered, "4.3")
    pre = "getDataGridTotalRowCount().should('eq', 1);"
    assert pre in body
    assert body.index(pre) < body.index("clickButton('Delete")


def test_unique_primary_link_keeps_its_visibility_precondition():
    rendered = _rendered(unique=True)
    for number in ("4.1", "4.2"):
        body = _example(rendered, number)
        assert ".should('be.visible')" in body
        assert ".should('not.exist')" in body
        assert "getDataGridTotalRowCount().should('eq', 2)" not in body
