"""
Regression test for cmd_1047k (goods_receipt.cy.ts, all 26 API e2e tests
failing with ReferenceError: goodsReceipt is not defined at helper.ts:219,
surfaced only after PR#533 fixed the unrelated `bin` ReferenceError that had
been masking this one -- see
queue/reports/subtask_1047j_pr533_realschema_verification_checkpoint_ashigaru5.yaml).

Background
----------
helper_context()'s "Extend deps to include FK deps needed by datagrid
children" loop (generators_test.py) calls resolve_dependencies(target,
schema) for a datagrid child's own self-referencing FK target (e.g.
goods_receipt_line.parent_goods_receipt_line_id -> goods_receipt_line).
That nested call only excludes the entity it is directly resolving
(goods_receipt_line) from the transitive walk -- it has no notion of the
outer model_name ('goods_receipt') the whole helper_context() call is for.
When the child entity itself carries a required FK back to that outer model
(goods_receipt_line.goods_receipt_id -> goods_receipt, the ordinary
parent-of-child relationship), resolve_dependencies() walks straight
through it and returns a dep entry {'target': 'goods_receipt', 'var_name':
'goodsReceipt', ...} -- structurally indistinguishable from a genuine
self-referencing FK dep, because its target happens to equal the outer
model_name.

Downstream, the self-ref/non-self split classified ANY dep with
target == model_name as a self-ref dep, deferring its creation to
populateXxxDependencies() (rendered AFTER _createXxxBaseDeps() returns) --
while the datagrid child's own dep (e.g. parentGoodsReceiptLine) that
references it via fk_deps is a genuinely non-self dep, rendered INSIDE
_createXxxBaseDeps(), BEFORE the self-ref creation ever runs. The generated
helper then reads goodsReceipt.id before const goodsReceipt = ... is ever
declared -- a ReferenceError at runtime, not a compile-time error, so it
surfaces only when the generated test actually executes.

Fix (PR#531/#534, since superseded -- see cmd_1050 update below): classify
self-ref deps by an explicit is_self_ref_dep tag set only by the two
deliberate self-ref-injection blocks (direct self-ref FK fields,
editable-list-autocomplete self-ref children), not by target == model_name
alone. A dep that reaches target == model_name via nested transitive
resolution (this case) was treated as an ordinary non-self dep, rendered in
the same function, in the same list-order position it was appended at --
which is always before the datagrid-child dep that needs it, since Python
list order is preserved through to template rendering. This fixed the
ReferenceError, but left the underlying transitive walk in place: the
datagrid child's OWN self-referencing FK (`parent_doc_line_id -> doc_line`)
still triggered `resolve_dependencies('doc_line', schema)`, which still
walked through `doc_line`'s own `doc_id -> doc` FK and registered `doc` (the
OUTER model itself) as an independent, org-blind extra dependency --
inflating `populateXxxDependencies()`'s created-row count outside any org
scope (cmd_1050, three symptoms: goods_receipt.cy.ts's "1.2 returns page
with items" and "N3 only returns rows from the caller's own organization").

cmd_1050 update: the root problem was never the ORDERING of this dep (what
PR#531/#534 fixed) -- it was that a self-referencing FK on the datagrid
child's own type should never trigger dependency resolution at all. The
referenced row is a sibling of the same collection being populated, never a
separate fixture; walking into it to pull in the child's own transitive
deps (here, its parent `doc`) is never correct, regardless of ordering. The
`helper_context()` loop now skips a datagrid-child field's `dep_target`
entirely when it equals the child's own type
(`target == child_meta['child']['name']`), before any resolution happens --
so `doc` is never registered as a dep of any kind (self-ref or non-self),
and the self-ref dep itself (`doc_line` / `parentDocLine`) no longer exists
either. This is a strictly narrower behavior than the ordering fix: it does
not reintroduce the ReferenceError (there is nothing left to misorder) and
it removes the org-blind extra-row creation this file's tests originally
missed because they only checked ordering, not whether the dep should exist
in the first place.
"""
from generators_test import helper_context


def _entity(model: str, children: list) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": model,
        "children": children,
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": True, "fields": None,
        },
    }


def _child_entry(name: str, prop: str) -> dict:
    return {
        "name": name,
        "property_name": prop,
        "output_type": None,
        "file_type": None,
        "relationship": None,
    }


def _schema() -> dict:
    """
    doc.lines embeds doc_line, a datagrid child that carries:
      - doc_id -> doc (required FK back to the OUTER model -- mirrors
        goods_receipt_line.goods_receipt_id -> goods_receipt).
      - destination_bin_id -> bin (an ordinary sibling FK).
      - parent_doc_line_id -> doc_line (self-referencing on the CHILD
        itself -- mirrors goods_receipt_line.parent_goods_receipt_line_id).

    Processing parent_doc_line_id triggers resolve_dependencies('doc_line',
    schema), which transitively walks doc_id -> doc and injects a dep
    entry with target == the OUTER model_name ('doc') -- the exact shape
    that was misclassified as a self-ref dep of doc itself, even though
    doc has no self-referencing FK property of its own.
    """
    return {
        "definitions": {
            "doc": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "bin": {
                "type": "object",
                "required": ["id", "code"],
                "properties": {"id": {"type": "string"}, "code": {"type": "string"}},
            },
            "doc_line": {
                "type": "object",
                "required": ["id", "doc_id", "destination_bin_id"],
                "properties": {
                    "id": {"type": "string"},
                    "doc_id": {
                        "type": "string",
                        "x-relationship": {
                            "type": "many-to-one", "target": "doc", "labelField": "name",
                        },
                    },
                    "destination_bin_id": {
                        "type": "string",
                        "x-relationship": {
                            "type": "many-to-one", "target": "bin", "labelField": "code",
                        },
                    },
                    "parent_doc_line_id": {
                        "type": ["string", "null"],
                        "x-relationship": {
                            "type": "many-to-one", "target": "doc_line", "labelField": "id",
                        },
                    },
                },
            },
        }
    }


def _ctx() -> dict:
    entity = _entity("doc", children=[_child_entry("doc_line", "lines")])
    return helper_context("doc", entity["children"], _schema(), "doc", "doc", entity["generate_config"])


def test_grandparent_backref_dep_is_not_classified_as_self_ref():
    """doc has no self-referencing FK property of its own -- a dep entry
    for target doc that only arose via the datagrid child's nested
    transitive resolution must NOT be treated as a self-ref dep (which would
    defer its creation to AFTER _createDocBaseDeps() already needs it)."""
    ctx = _ctx()
    assert ctx["has_self_ref_deps"] is False
    self_ref_targets = {d["target"] for d in ctx["self_ref_deps"]}
    assert "doc" not in self_ref_targets


def test_grandparent_backref_and_selfref_dep_are_not_created_at_all():
    """cmd_1050: a self-referencing FK on the datagrid child's own type
    (parent_doc_line_id -> doc_line) must be skipped entirely -- neither the
    self-ref dep itself (doc_line / parentDocLine) nor the outer model it
    would have transitively pulled in (doc, via doc_line's own doc_id FK)
    may appear anywhere in deps/non_self_deps/self_ref_deps. The ordering
    fix this test previously checked (doc before parentDocLine) is now
    moot: neither var_name is created."""
    ctx = _ctx()
    all_var_names = [d["var_name"] for d in ctx["deps"]]
    assert "doc" not in all_var_names
    assert "parentDocLine" not in all_var_names
    non_self_var_names = [d["var_name"] for d in ctx["non_self_deps"]]
    assert "doc" not in non_self_var_names
    assert "parentDocLine" not in non_self_var_names
    # the ordinary sibling FK (destination_bin_id -> bin) is untouched
    assert "destinationBin" in non_self_var_names


def test_no_non_self_dep_fk_references_a_self_ref_only_var_name():
    """General invariant: since the template always renders ALL non_self_deps
    (inside _createXxxBaseDeps()) before ANY self_ref_deps (inside
    populateXxxDependencies(), which calls _createXxxBaseDeps() first), no
    non_self_dep's fk_deps may reference a var_name that belongs exclusively
    to self_ref_deps -- that shape is always a forward reference
    (ReferenceError) regardless of which code path produced it."""
    ctx = _ctx()
    non_self_var_names = {d["var_name"] for d in ctx["non_self_deps"]}
    self_ref_only_var_names = {
        d["var_name"] for d in ctx["self_ref_deps"]
    } - non_self_var_names
    for dep in ctx["non_self_deps"]:
        for fk in dep.get("fk_deps") or []:
            assert fk["dep_var_name"] not in self_ref_only_var_names, (
                f"non-self dep '{dep['var_name']}' fk_deps references "
                f"'{fk['dep_var_name']}', which is only created later, in "
                f"populateXxxDependencies() (self-ref decoy) -- forward "
                f"reference / ReferenceError shape (fk: {fk})"
            )
