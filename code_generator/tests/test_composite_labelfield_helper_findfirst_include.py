"""
Regression test for cmd_615a: when a find-or-create dep in a generated test
helper resolves its label from a composite labelField (e.g.
`labelField: [product.name, id]`), `build_context.py`/`generators_test.py`
compute a Prisma `include` (`prisma_include_str`) so the label expression can
read the included relation off the record. `test_helper.ts.jinja2` spliced
that `include` into the dep's `create()` call but not into the paired
`findFirst()` call that precedes it in the same find-or-create block. Since
the dep variable is declared via `let x = await ...findFirst(...)`, its
TypeScript type is fixed to the (relation-less) findFirst result; the later
label expression (`xRecord.product?.name`) reads a property that exists only
on the create() branch's type, producing an inescapable TS2339/TS2551 error
that no current gate catches (cypress/ is excluded from tsconfig.json's
`next build` type-check, and `cypress run` transpiles support files without
type-checking) — until the field is actually opened in an editor or a
dedicated `tsc --noEmit` pass runs over cypress/, at which point it hard
fails. Root cause + fix: `code_generator/templates/test_helper.ts.jinja2`
(the findFirst call for every `dep.prisma_include_str`-bearing, lookup-keyed
dep must carry the same `include` as its create() counterpart).
"""
from generate import _make_env
from generators_test import helper_context


def _entity(model: str) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": True, "fields": None,
        },
    }


def _schema() -> dict:
    return {
        "definitions": {
            "product": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "inventory": {
                "type": "object",
                "required": ["id", "name", "product_id"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "product_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "product", "labelField": "name"},
                    },
                },
            },
            "inventory_movement": {
                "type": "object",
                "required": ["id", "from_inventory_id"],
                "properties": {
                    "id": {"type": "string"},
                    "from_inventory_id": {
                        "type": "string",
                        "x-relationship": {
                            "type": "many-to-one",
                            "target": "inventory",
                            # Composite labelField: resolving it needs `product`
                            # included on the `inventory` row, exactly like
                            # goods_receipt_line's FK to purchase_order_line
                            # (labelField: [purchase_order.po_number, item.sku]).
                            "labelField": ["product.name", "id"],
                        },
                    },
                },
            },
            "inventory_movement_detail": {"allOf": [{"$ref": "#/definitions/inventory_movement"}]},
        },
    }


def _render_helper() -> str:
    schema = _schema()
    ctx = helper_context(
        "inventory_movement", [], schema, "inventory_movement", "inventory_movement_detail",
        _entity("inventory_movement")["generate_config"],
    )
    return _make_env().get_template('test_helper.ts.jinja2').render(**ctx)


def test_composite_labelfield_dep_has_include_in_context():
    schema = _schema()
    ctx = helper_context(
        "inventory_movement", [], schema, "inventory_movement", "inventory_movement_detail",
        _entity("inventory_movement")["generate_config"],
    )
    dep = next(d for d in ctx["deps"] if d["target"] == "inventory")
    # Sanity check that this fixture actually exercises both preconditions of
    # the bug: a lookup-keyed find-or-create dep whose label needs an include.
    assert dep["lookup_field"] == "name"
    assert dep["prisma_include_str"], "fixture must produce a composite-labelField include"


def test_composite_labelfield_dep_findfirst_include_matches_create():
    out = _render_helper()
    # The dep's find-or-create block: `let inventoryRecord = await
    # prisma.inventory.findFirst({...})` immediately followed by
    # `if (!inventoryRecord) { inventoryRecord = await
    # prisma.inventory.create({..., include: {...}}); }`. Both must carry the
    # SAME include, or accessing `inventoryRecord.product` after the
    # find-or-create is a TS error on the findFirst-only branch.
    find_first_block, _, rest = out.partition('prisma.inventory.findFirst({')
    assert rest, "expected a findFirst call against the inventory dep"
    find_first_body, _, after_find_first = rest.partition('});')
    assert 'include: { product: true }' in find_first_body, (
        "findFirst() for a composite-labelField dep must include the same "
        "relations as its create() counterpart (cmd_615a regression); got:\n"
        f"{find_first_body}"
    )

    create_body, _, _ = after_find_first.partition('});')
    assert 'include: { product: true }' in create_body, (
        "fixture regressed: create() no longer carries the composite-"
        "labelField include this test depends on"
    )
