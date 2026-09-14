"""
Regression tests for issue #538, a generators_test.py-side gap in
the "Otsu" ruling (issue #520/PR#528, PR#530).

Background
----------
PR#530 taught the UI generator (build_context.py's
`write_ch`, generators.py's `form_upsert_context()`) that an INDEPENDENT
datagrid child (one with its own `x-generate` -- own list/view/new/edit/
delete pages) renders READ-ONLY from the parent: no "Add"/edit/delete
controls, just a `FieldsViewGrid` display gated on `isEdit`. Only the
child's own CRUD route may write it. Follow-up fixes (see
`test_normalize_child_refs_import_and_readonly_grid_props.py`,
`test_datagrid_child_selfref_shared_fk_target_var_name.py`) confirm this
live against proj_g's asn/goods_receipt/purchase_order/sales_order/shipment
entities.

Nothing in that work ever touched generators_test.py's
`get_child_render_type()` (the CYPRESS TEST generator's own child
classifier). It still classified such a child as plain `'datagrid'` --
the same render type as an ordinary, fully-editable embedded child (e.g.
`dashboard.widgets`) -- so the generated New/Edit e2e spec still tried to
click an "Add {Child}" button and fill/edit grid rows for a child the real
UI no longer renders as writable at all. Confirmed live: proj_g's
`goods_receipt.cy.ts` (desktop UI e2e), 7/13 tests failing on a missing
`button[aria-label="Add Goods Receipt Lines"]`.

Fix (this file's subject): `get_child_render_type()` now returns
`'readonly-datagrid'` (a new value, not `'datagrid'`) for such a child, so
every `datagrid_children = [c for c in child_metas if c['render_type'] ==
'datagrid']` call site (helper_context/spec_context/tasks_registry_context)
automatically stops generating write-flow test code for it -- no per-call-
site changes needed. The self-referencing case (`child['name'] ==
parent_model_name`, e.g. a self-ref FK on the SAME entity type) is
deliberately excluded from this narrowing, mirroring build_context.py's own
`use_connect` gate (`child_name == model`), which keeps such a child in the
writable `write_ch` on the UI generator side too.

Per-instruction rewrite, not deletion: removing the write-flow assertions
alone would have silenced the 7 failures without replacing their test
value. `spec_context()` now also emits `readonly_datagrid_children_data`
(title only) and `test_spec.cy.ts.jinja2`'s "3.1 adds optional data and
child items" test renders one negative assertion per such child --
`cy.get('button[aria-label="Add {title}"]').should('not.exist');` --
directly encoding the FieldsViewGrid-no-add-control fact confirmed by
reading generators.py's `readonly_indep_grid_ch` JSX. This is a real
regression guard: if a future change ever restores editable rendering for
these children (reverting issue #520/PR#528/PR#530), this assertion fails.
"""
from generators_test import get_child_render_type, analyze_children, spec_context


def _child_entry(name: str, prop: str, output_type=None, relationship=None) -> dict:
    return {
        "name": name,
        "property_name": prop,
        "output_type": output_type,
        "file_type": None,
        "relationship": relationship,
    }


def _independent_child_schema() -> dict:
    """`parent.lines` embeds `line`, an INDEPENDENT entity (own x-generate)
    -- mirrors goods_receipt/goods_receipt_line exactly (required one-to-many,
    non-'list' output_type, child has its own full CRUD)."""
    return {
        "definitions": {
            "parent": {
                "type": "object",
                "required": ["id", "name", "lines"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "lines": {"type": "array", "items": {"$ref": "#/definitions/line"}},
                },
            },
            "line": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": True,
                },
                "type": "object",
                "required": ["id", "parent_id", "label"],
                "properties": {
                    "id": {"type": "string"},
                    "parent_id": {"type": "string"},
                    "label": {"type": "string"},
                },
            },
        }
    }


def _non_independent_child_schema() -> dict:
    """`parent.lines` embeds `line`, an ordinary embedded-only child with NO
    `x-generate` of its own -- mirrors dashboard/dashboard_widget."""
    schema = _independent_child_schema()
    del schema["definitions"]["line"]["x-generate"]
    return schema


def _self_ref_independent_child_schema() -> dict:
    """`doc.lines` embeds `doc_line`, which is ALSO independent (own
    x-generate) but is the SAME entity type as the parent being rendered
    (self-referencing) -- mirrors any self-ref FK-bearing independent
    datagrid child. build_context.py's `use_connect` (`child_name == model`)
    keeps this case OUT of the read-only narrowing; the test generator must
    match."""
    return {
        "definitions": {
            "doc_line": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": True,
                },
                "type": "object",
                "required": ["id", "parent_doc_line_id", "label"],
                "properties": {
                    "id": {"type": "string"},
                    "parent_doc_line_id": {"type": ["string", "null"]},
                    "label": {"type": "string"},
                },
            },
        }
    }


class TestGetChildRenderTypeReadonlyDatagrid:
    def test_independent_child_is_readonly_datagrid(self):
        schema = _independent_child_schema()
        child = _child_entry("line", "lines")
        assert get_child_render_type(child, schema, "parent") == "readonly-datagrid"

    def test_non_independent_child_stays_plain_datagrid(self):
        """Regression guard: an ordinary embedded child (dashboard.widgets
        shape) with no x-generate of its own must keep the normal,
        fully-editable 'datagrid' render type."""
        schema = _non_independent_child_schema()
        child = _child_entry("line", "lines")
        assert get_child_render_type(child, schema, "parent") == "datagrid"

    def test_self_referencing_independent_child_stays_plain_datagrid(self):
        """A self-referencing independent child (child['name'] ==
        parent_model_name) is excluded from the read-only narrowing on the
        UI generator side (build_context.py's use_connect gates on
        `child_name == model`) -- the test generator must not narrow it
        either."""
        schema = _self_ref_independent_child_schema()
        child = _child_entry("doc_line", "lines")
        assert get_child_render_type(child, schema, "doc_line") == "datagrid"

    def test_many_to_many_independent_child_is_unaffected(self):
        """The many-to-many check runs before the independent-child check --
        an independent m2m child (e.g. user.roles) must keep its existing
        'editable-list-autocomplete' classification, not fall into the new
        read-only-datagrid branch."""
        schema = _independent_child_schema()
        child = _child_entry("line", "lines", relationship={"type": "many-to-many"})
        assert get_child_render_type(child, schema, "parent") == "editable-list-autocomplete"

    def test_no_schema_falls_back_to_plain_datagrid(self):
        """schema=None (some call sites omit it) must not crash -- falls
        back to the pre-existing 'datagrid' behavior, same as the
        pre-existing output_type == 'list' branch already does."""
        child = _child_entry("line", "lines")
        assert get_child_render_type(child, None, "parent") == "datagrid"


class TestAnalyzeChildrenReadonlyDatagridExclusion:
    def test_independent_child_excluded_from_datagrid_filter(self):
        """The exact filter every call site (helper_context/spec_context/
        tasks_registry_context) uses -- `[c for c in child_metas if
        c['render_type'] == 'datagrid']` -- must no longer include an
        independent child, so no Add-button-click / fillDataGridRow test
        code is generated for it."""
        schema = _independent_child_schema()
        children = [_child_entry("line", "lines")]
        child_metas = analyze_children(children, schema, "parent")
        datagrid_children = [c for c in child_metas if c["render_type"] == "datagrid"]
        readonly_datagrid_children = [c for c in child_metas if c["render_type"] == "readonly-datagrid"]
        assert datagrid_children == []
        assert len(readonly_datagrid_children) == 1
        assert readonly_datagrid_children[0]["names"]["title"]

    def test_non_independent_child_still_in_datagrid_filter(self):
        """dashboard.widgets-shape regression guard at the analyze_children
        level too, not just get_child_render_type in isolation."""
        schema = _non_independent_child_schema()
        children = [_child_entry("line", "lines")]
        child_metas = analyze_children(children, schema, "parent")
        datagrid_children = [c for c in child_metas if c["render_type"] == "datagrid"]
        assert len(datagrid_children) == 1


def _generate_config() -> dict:
    return {
        "list": True, "view": True, "new": True, "edit": True,
        "delete": True, "api": True, "test": True, "fields": None,
    }


def _spec_ctx_schema(child_has_x_generate: bool) -> dict:
    """parent1.lines -> line, mirroring goods_receipt/goods_receipt_line
    (required one-to-many) when child_has_x_generate=True, or
    dashboard/dashboard_widget (plain embedded, no x-generate of its own)
    when False."""
    line_def = {
        "type": "object",
        "required": ["id", "parent1_id", "label"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "parent1_id": {"type": "string"},
            "label": {"type": "string"},
        },
    }
    if child_has_x_generate:
        line_def["x-generate"] = _generate_config()
    return {
        "definitions": {
            "parent1": {
                "type": "object",
                "required": ["id", "name", "lines"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                    "lines": {"type": "array", "items": {"$ref": "#/definitions/line"}},
                },
            },
            "parent1_detail": {
                "x-generate": _generate_config(),
                "allOf": [{"$ref": "#/definitions/parent1"}],
            },
            "line": line_def,
        }
    }


def _lines_child() -> list:
    return [_child_entry("line", "lines")]


class TestSpecContextReadonlyDatagridChildren:
    """spec_context()'s own output -- the actual data the jinja2 template
    consumes -- must move an independent child's data from
    `datagrid_children_data` (write-flow, e.g. 'Add {title}' click +
    fillDataGridRow) to `readonly_datagrid_children_data` (title only, feeds
    the negative 'Add {title} does not exist' assertion instead)."""

    def test_independent_child_moves_to_readonly_list(self):
        schema = _spec_ctx_schema(child_has_x_generate=True)
        ctx = spec_context("parent1", _lines_child(), schema, "parent1", "parent1_detail", _generate_config())
        assert ctx["datagrid_children_data"] == []
        assert ctx["readonly_datagrid_children_data"] == [{"title": "Lines"}]
        assert ctx["has_datagrid_children"] is False
        assert ctx["has_children"] is True

    def test_non_independent_child_stays_in_writable_list(self):
        schema = _spec_ctx_schema(child_has_x_generate=False)
        ctx = spec_context("parent1", _lines_child(), schema, "parent1", "parent1_detail", _generate_config())
        assert ctx["readonly_datagrid_children_data"] == []
        assert len(ctx["datagrid_children_data"]) == 1
        assert ctx["datagrid_children_data"][0]["title"] == "Lines"
        assert ctx["has_datagrid_children"] is True
