"""
Regression tests for cmd_1047 "Otsu" ruling (subtask_1047g, issue #520/
PR#528 follow-up).

Background
----------
PR#528 (cmd's own #520) allowed an INDEPENDENT child (one with its own
`x-generate` -- own list/view/new/edit/delete pages) to be embedded in a
parent's form with a non-'list' `x-outputType` (a grid-style read-only
embed), verifying only that the parent's *read* display (FormView.tsx's
`FieldsViewGrid` + `use{Prop}Columns(false)`) renders it correctly. It did
not audit the parent's *write* path.

Two write-path generators were never updated to match:
1. `build_context.py`'s `is_independent` flag was gated on
   `output_type == 'list'` -- a harmless simplification before PR#528 (that
   combination was impossible), but silently wrong afterward: an
   independent, non-'list' child was computed as `is_independent=False`.
2. `build_context.py`'s `embedded_ch` (feeding `child_nested_create`/
   `child_nested_update`/the add-update param signatures) therefore treated
   such a child as a normal writable embedded child of the parent.
3. `generators.py`'s `form_upsert_context()` rendered it as an EDITABLE
   DataGrid (add/edit/delete, `EntityAutocompleteCellConfig` FK pickers) --
   the exact opposite of "independent, own CRUD route is the only writer".

Confirmed live on proj_g: once x-outputType: list was removed from
goods_receipt_line (x-approval + self-referencing FK, still independent),
`lib/goods_receipt/service.ts`'s generic nested-create body did not supply
the `item`/`approvable` fields Prisma's own
`goods_receipt_lineCreateWithoutGoods_receiptInput` requires -- TS2322.

The fix (this commit): `is_independent` no longer gates on
`output_type == 'list'`; `build_context.py` narrows a NEW `write_ch` (used
for every write-path site) that unconditionally excludes an independent,
non-connect child regardless of output_type, while the broader
`embedded_ch`/`ctx['non_comment_ch']` (needed by `column_def_context`'s
column-hook generation and by `form_upsert_context`'s own read-only
rendering) is left unchanged; `form_upsert_context()` renders such a child
via a read-only `FieldsViewGrid` + `use{Prop}Columns(false)` (no
`EntityAutocompleteCellConfig`, mirroring FormView.tsx's own read-only
rendering) instead of the editable DataGrid.
"""
from build_context import build_context
from generators import form_upsert_context, column_def_context


def _base_props(extra: dict | None = None) -> dict:
    props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
    }
    props.update(extra or {})
    return props


def _fk_field(target: str, nullable: bool = False, label_field: str = "name") -> dict:
    t = ["string", "null"] if nullable else "string"
    return {
        "type": t,
        "pattern": "^c[a-z0-9]{24,}$",
        "x-relationship": {"type": "many-to-one", "target": target, "labelField": label_field},
    }


def _entity(model: str, children: list) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": model,
        "children": children,
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }


def _child_entry(name: str, prop: str, output_type: str | None = None) -> dict:
    return {
        "name": name,
        "property_name": prop,
        "output_type": output_type,
        "file_type": None,
        "relationship": None,
    }


def _schema_with_independent_grid_child() -> dict:
    """`purchase_doc` (parent) embeds `purchase_doc_line`, an INDEPENDENT
    child (own x-generate list/view/new/edit/delete) with no x-outputType
    (resolves to a non-'list' grid embed) -- proj_g's goods_receipt_line
    shape, minus x-approval (not needed to exercise the write-path fix)."""
    return {
        "definitions": {
            "organization": {
                "type": "object",
                "required": ["id", "name"],
                "properties": _base_props(),
            },
            "purchase_doc": {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": False, "test": False},
                "type": "object",
                "required": ["id", "name", "organization_id"],
                "properties": {
                    **_base_props(),
                    "organization_id": _fk_field("organization"),
                },
            },
            "purchase_doc_line": {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": False, "test": False},
                "type": "object",
                "required": ["id", "purchase_doc_id", "organization_id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "quantity": {"type": "number"},
                    "purchase_doc_id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    # Shared FK name with the parent (Bug A's own trigger shape).
                    "organization_id": _fk_field("organization"),
                    # Self-referencing FK (Bug B's own trigger shape).
                    "parent_line_id": _fk_field("purchase_doc_line", nullable=True, label_field="quantity"),
                },
            },
        }
    }


def _ctx():
    schema = _schema_with_independent_grid_child()
    entity = _entity("purchase_doc", children=[
        _child_entry("purchase_doc_line", "purchase_doc_lines"),
    ])
    return build_context(entity, schema)


class TestWritePathExcludesIndependentChild:
    """build_context.py: the independent child must never appear in any
    write-path plumbing, regardless of its non-'list' output_type."""

    def test_not_in_nested_create(self):
        ctx = _ctx()
        assert "purchase_doc_lines" not in ctx["child_nested_create"]

    def test_not_in_nested_update(self):
        ctx = _ctx()
        assert "purchase_doc_lines" not in ctx["child_nested_update"]

    def test_not_in_add_params(self):
        ctx = _ctx()
        assert "purchaseDocLine" not in ctx["child_params_for_add"]

    def test_not_in_update_params(self):
        ctx = _ctx()
        assert "purchaseDocLine" not in ctx["child_params_for_update"]

    def test_not_in_service_call_args(self):
        ctx = _ctx()
        assert "purchase_doc_lines" not in ctx["service_args_for_create"]
        assert "purchase_doc_lines" not in ctx["service_args_for_update"]

    def test_not_in_api_body_fields(self):
        ctx = _ctx()
        assert "purchase_doc_lines" not in ctx["all_body_fields_create"]

    def test_not_in_staleness_snapshot(self):
        ctx = _ctx()
        assert "purchase_doc_lines" not in ctx["snapshot_child_mappings"]
        assert "purchase_doc_lines" not in ctx["snapshot_include_props"]

    def test_still_in_non_comment_ch_for_column_hook_generation(self):
        """Column hooks must still be generated for it -- FormView.tsx (and
        FormUpsert's own read-only rendering) both call use{Prop}Columns."""
        ctx = _ctx()
        names = {c["name"] for c in ctx["non_comment_ch"]}
        assert "purchase_doc_line" in names


class TestFormUpsertRendersIndependentChildReadOnly:
    """generators.py's form_upsert_context(): the independent child renders
    via the same read-only path FormView.tsx uses, never the editable grid."""

    def _fu_ctx(self):
        return form_upsert_context(_ctx(), _schema_with_independent_grid_child())

    def test_readonly_columns_hook_called_with_false(self):
        ctx = self._fu_ctx()
        assert "usePurchaseDocLinesColumns(false)" in ctx["child_grid_setup"]

    def test_no_editable_columns_hook_with_true(self):
        ctx = self._fu_ctx()
        assert "usePurchaseDocLinesColumns(true" not in ctx["child_grid_setup"]

    def test_no_create_new_row_factory(self):
        """No createNew{Child}() -- that machinery only exists for a
        writable embedded grid child."""
        ctx = self._fu_ctx()
        assert "createNewPurchaseDocLines" not in ctx["child_grid_setup"]

    def test_no_entity_autocomplete_cell_config(self):
        """No FK picker config is built at all for a read-only child --
        column_def_context's own ternary already falls back to a plain
        labelField-valued read-only column when no {prop}Config is passed."""
        ctx = self._fu_ctx()
        assert "organizationIdConfig" not in ctx["child_entity_rel_opt"]

    def test_fields_view_grid_rendered(self):
        ctx = self._fu_ctx()
        assert "FieldsViewGrid" in ctx["indep_list_readonly_jsx"]
        assert "purchaseDocLinesColumns" in ctx["indep_list_readonly_jsx"]
        assert "usePurchaseDocLinesColumns(false)" in ctx["child_grid_setup"]

    def test_readonly_grid_guarded_by_is_edit(self):
        ctx = self._fu_ctx()
        assert "{isEdit && (" in ctx["indep_list_readonly_jsx"]

    def test_fields_view_grid_import_included(self):
        ctx = self._fu_ctx()
        assert "FieldsViewGrid" in ctx["child_imports"]

    def test_no_editable_grid_component_for_this_child(self):
        """child_grid_components carries the editable DataGrid/toolbar JSX --
        must not reference this child at all."""
        ctx = self._fu_ctx()
        assert "purchaseDocLines" not in ctx["child_grid_components"]


class TestNonIndependentSiblingStillWritable:
    """Regression guard: a plain (non-independent) embedded grid child must
    be completely unaffected by this fix -- still fully editable via the
    parent, same as before cmd_1047."""

    def _schema(self) -> dict:
        return {
            "definitions": {
                "purchase_doc": {
                    "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                                   "delete": True, "api": False, "test": False},
                    "type": "object",
                    "required": ["id", "name"],
                    "properties": _base_props(),
                },
                # No x-generate on note_line -- non-independent.
                "note_line": {
                    "type": "object",
                    "required": ["id", "purchase_doc_id"],
                    "properties": {
                        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "purchase_doc_id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                        "note": {"type": "string"},
                    },
                },
            }
        }

    def _ctx(self):
        entity = _entity("purchase_doc", children=[_child_entry("note_line", "note_lines")])
        return build_context(entity, self._schema())

    def test_still_in_nested_create(self):
        ctx = self._ctx()
        assert "note_lines" in ctx["child_nested_create"]

    def test_still_in_add_params(self):
        ctx = self._ctx()
        assert "noteLine" in ctx["child_params_for_add"]

    def test_form_upsert_still_renders_editable_grid(self):
        ctx = form_upsert_context(self._ctx(), self._schema())
        assert "useNoteLinesColumns(true" in ctx["child_grid_setup"]
        assert "createNewNoteLines" in ctx["child_grid_setup"]


class TestReadOnlyGridColumnDisplay:
    """cmd_1047 "Otsu" ruling command (ii): the embedded read-only table must
    not surface system-managed technical columns (id groups, audit columns,
    internal bridge FKs like approvable_id), and a shown FK column must
    display its labelField-resolved value, never the raw id.

    column_def_context() itself is unmodified by this fix -- it already
    generically excludes id/{model}_id/created_at/updated_at/creator_id,
    any `one-to-one_bridge` relation, and any *able_id-suffixed field with
    no x-relationship (approvable_id, inventory_transactionable_id, ...),
    and already falls back to a labelField-valued read-only column whenever
    no {prop}Config is passed in -- exactly the case for the new read-only
    rendering path (see TestFormUpsertRendersIndependentChildReadOnly).
    This class only confirms that pre-existing, generic behavior actually
    fires for the same independent-grid-child schema shape used above."""

    def _schema(self) -> dict:
        schema = _schema_with_independent_grid_child()
        # A technical bridge FK with no x-relationship, matching approvable_id's
        # own shape (`*able_id` suffix) -- must never become a plain column.
        schema["definitions"]["purchase_doc_line"]["properties"]["approvable_id"] = {
            "type": "string", "pattern": "^c[a-z0-9]{24,}$",
        }
        schema["definitions"]["purchase_doc_line"]["required"].append("approvable_id")
        return schema

    def _cols_ctx(self):
        schema = self._schema()
        entity = _entity("purchase_doc", children=[
            _child_entry("purchase_doc_line", "purchase_doc_lines"),
        ])
        ctx = build_context(entity, schema)
        return column_def_context(ctx, schema)

    def test_technical_bridge_fk_column_excluded(self):
        ctx = self._cols_ctx()
        [fn_code] = [c["fn_code"] for c in ctx["column_children"]]
        assert "approvable_id" not in fn_code

    def test_structural_parent_fk_column_excluded(self):
        ctx = self._cols_ctx()
        [fn_code] = [c["fn_code"] for c in ctx["column_children"]]
        assert "purchase_doc_id" not in fn_code

    def test_shared_name_fk_column_shows_labelfield_when_no_config(self):
        """organization_id's read-only branch must read the included
        relation's labelField ('name'), not the raw FK column value."""
        ctx = self._cols_ctx()
        [fn_code] = [c["fn_code"] for c in ctx["column_children"]]
        assert "row.organization?.name" in fn_code
        # Both branches are always present in source (runtime picks one via
        # the ?organizationIdConfig ternary) -- the editable branch existing
        # too is not a bug, see TestFormUpsertRendersIndependentChildReadOnly
        # for proof no Config is ever passed for this child.
        assert "organizationIdConfig" in fn_code

    def test_self_ref_fk_column_present_with_own_labelfield(self):
        ctx = self._cols_ctx()
        [fn_code] = [c["fn_code"] for c in ctx["column_children"]]
        assert "parent_line_id" in fn_code
        assert "row.parent_line?.quantity" in fn_code
