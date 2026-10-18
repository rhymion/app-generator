"""Unified `properties:` in the user schema, and `x-view-of` proxy views.

An entity lists its Prisma columns and its relation embeds together under
`properties:`; the builder asks Prisma what each name is (never the entry's own
shape) and hands columns and relations to the same derivation as before. An
entity that is not a Prisma model names the model it is a view of with
`x-view-of`, and the builder rebuilds the `allOf` wrapper the generator reads.
"""
import pytest

from build_user_schema import UserSchemaError, build_intermediate_schema
from schema_deriver import parse_prisma_enums, parse_prisma_schema

PRISMA = """
enum Kind {
  a
  b
}

model node {
  id             String   @id @default(cuid())
  name           String
  kind           Kind     @default(a)
  note           String?
  parent_id      String?
  parent         node?    @relation("NodeParent", fields: [parent_id], references: [id])
  children       node[]   @relation("NodeParent")
  reversal_of_id String?  @unique
  reversal_of    node?    @relation("NodeReversal", fields: [reversal_of_id], references: [id])
  reversed_by    node?    @relation("NodeReversal")
  peer_id        String?
  peer           node?    @relation("NodePeer", fields: [peer_id], references: [id])
  peered_by      node[]   @relation("NodePeer")
  owner_id       String
  owner          owner    @relation(fields: [owner_id], references: [id])
}

model owner {
  id      String @id @default(cuid())
  name    String
  nodes   node[]
  single_id String? @unique
  single  single? @relation(fields: [single_id], references: [id])
}

model single {
  id     String @id @default(cuid())
  name   String
  owners owner[]
}
"""

REF = lambda name: {"$ref": f"#/definitions/{name}"}  # noqa: E731
LIST = lambda name: {"type": "array", "x-outputType": "list", "items": REF(name)}  # noqa: E731


@pytest.fixture(scope="module")
def prisma(tmp_path_factory):
    path = tmp_path_factory.mktemp("prisma") / "schema.prisma"
    path.write_text(PRISMA)
    return parse_prisma_schema(path), parse_prisma_enums(path)


def _build(prisma, definitions):
    models, enums = prisma
    return build_intermediate_schema({"definitions": definitions}, models, enums)["definitions"]


# --- T2: classification by Prisma field kind ---------------------------------------------------


def test_columns_and_relations_in_one_map_land_where_the_old_two_maps_did(prisma):
    out = _build(prisma, {
        "owner": {"properties": {"name": {}}},
        "node": {
            "x-generate": {"list": True},
            "required": ["owner"],
            "properties": {
                "name": {"x-pii": "direct"},
                "kind": {},
                "owner_id": {"x-relationship": {}},
                "owner": REF("owner"),
                "children": LIST("node"),
            },
        },
    })
    raw, view = out["__node"], out["node"]
    assert list(raw["properties"]) == ["id", "name", "kind", "owner_id"]
    assert raw["properties"]["name"]["x-pii"] == "direct"
    assert raw["properties"]["kind"]["_prisma_native_enum_type"] == "Kind"
    second = view["allOf"][1]
    assert list(second["properties"]) == ["owner", "children"]
    assert second["required"] == ["owner"]


def test_scalar_entry_with_a_type_is_still_a_column(prisma):
    out = _build(prisma, {
        "owner": {"properties": {"name": {}}},
        "node": {"properties": {"name": {"type": "string", "maxLength": 20}}},
    })
    assert out["node"]["properties"]["name"]["maxLength"] == 20
    assert "owner" not in out["node"]["properties"]


def test_back_relation_list_is_a_relation_not_a_column(prisma):
    out = _build(prisma, {
        "node": {"x-generate": {"list": True}, "properties": {"name": {}, "children": LIST("node")}},
    })
    assert "children" in out["node"]["allOf"][1]["properties"]
    assert "children" not in out["__node"]["properties"]


def test_relation_entry_without_a_ref_is_still_a_relation(prisma):
    out = _build(prisma, {
        "node": {"x-generate": {"list": True}, "properties": {"name": {}, "children": {"type": "array"}}},
    })
    assert out["node"]["allOf"][1]["properties"]["children"] == {"type": "array"}


def test_name_unknown_to_prisma_is_an_error(prisma):
    with pytest.raises(UserSchemaError, match="not_a_column"):
        _build(prisma, {"node": {"properties": {"not_a_column": {}}}})


def test_residual_fields_key_is_an_error_naming_the_migration_script(prisma):
    with pytest.raises(UserSchemaError, match="migrate_fields_into_properties"):
        _build(prisma, {"node": {"fields": {"name": {}}}})


def test_relation_entry_may_not_carry_x_relationship(prisma):
    with pytest.raises(UserSchemaError, match="x-relationship"):
        _build(prisma, {"node": {"properties": {"owner": {**REF("owner"), "x-relationship": {}}}}})


def test_relation_ref_must_match_the_prisma_target(prisma):
    with pytest.raises(UserSchemaError, match="Prisma relates it to 'owner'"):
        _build(prisma, {"owner": {"properties": {}}, "single": {"properties": {}}, "node": {"properties": {"owner": REF("single")}}})


# --- T3: explicit foreign keys win over automatic completion -----------------------------------


def test_foreign_key_is_added_for_a_relation_that_omits_it(prisma):
    out = _build(prisma, {"owner": {"properties": {"name": {}}}, "node": {"properties": {"name": {}, "owner": REF("owner")}}})
    assert out["node"]["properties"]["owner_id"]["x-relationship"]["target"] == "owner"


def test_explicit_one_to_one_foreign_key_is_not_replaced_by_the_default(prisma):
    out = _build(prisma, {
        "single": {"properties": {"name": {}}},
        "owner": {"properties": {"name": {}, "single_id": {"x-relationship": {"type": "one-to-one"}}, "single": REF("single")}},
    })
    assert out["owner"]["properties"]["single_id"]["x-relationship"]["type"] == "one-to-one"


def test_unannotated_foreign_key_column_stays_a_plain_column(prisma):
    out = _build(prisma, {"node": {"properties": {"name": {}, "parent_id": {}}}})
    assert "x-relationship" not in out["node"]["properties"]["parent_id"]


# --- T4: self reference -----------------------------------------------------------------------


def test_self_reference_keeps_each_column_and_embed_apart_in_written_order(prisma):
    out = _build(prisma, {
        "node": {
            "x-generate": {"list": True},
            "properties": {
                "name": {},
                "parent_id": {"x-relationship": {}},
                "peer_id": {"x-relationship": {}},
                "parent": REF("node"),
                "children": LIST("node"),
                "peered_by": LIST("node"),
            },
        },
    })
    raw = list(out["__node"]["properties"])
    assert raw.index("parent_id") < raw.index("peer_id")
    assert list(out["node"]["allOf"][1]["properties"]) == ["parent", "children", "peered_by"]


def test_one_to_one_self_reference_by_foreign_key_and_back_reference(prisma):
    out = _build(prisma, {
        "node": {
            "properties": {
                "name": {},
                "reversal_of_id": {"x-relationship": {"type": "one-to-one"}},
                "reversal_of": REF("node"),
                "reversed_by": REF("node"),
            },
        },
    })
    assert out["node"]["properties"]["reversal_of_id"]["x-relationship"]["type"] == "one-to-one"
    assert {"reversal_of", "reversed_by"} <= set(out["node"]["properties"])


def test_two_self_foreign_keys_keep_their_declared_column_order(prisma):
    for order in (["parent_id", "peer_id"], ["peer_id", "parent_id"]):
        out = _build(prisma, {"node": {"properties": {"name": {}, **{c: {"x-relationship": {}} for c in order}}}})
        cols = [c for c in out["node"]["properties"] if c in order]
        assert cols == order


# --- T5: x-view-of ----------------------------------------------------------------------------


def _with_view(**view):
    return {
        "owner": {"properties": {"name": {}}},
        "node": {"properties": {"name": {}, "owner": REF("owner")}},
        "stub": view,
    }


def test_view_of_is_rebuilt_as_an_all_of_wrapper_in_place(prisma):
    out = _build(prisma, _with_view(**{"x-view-of": "node", "x-self-only": {"admin_bypass": True},
                                       "required": ["children"], "properties": {"children": LIST("node")}}))
    stub = out["stub"]
    assert "x-view-of" not in stub
    assert stub["allOf"] == [REF("node"), {"type": "object", "required": ["children"], "properties": {"children": LIST("node")}}]
    assert stub["x-self-only"] == {"admin_bypass": True}
    assert list(stub)[0] == "allOf"


def test_view_of_reference_is_the_canonical_view_never_the_raw_entity(prisma):
    out = _build(prisma, _with_view(**{"x-view-of": "node"}))
    assert out["stub"]["allOf"][0]["$ref"] == "#/definitions/node"


def test_view_of_without_embeds_has_a_single_branch(prisma):
    assert len(_build(prisma, _with_view(**{"x-view-of": "node"}))["stub"]["allOf"]) == 1


@pytest.mark.parametrize("entity, match", [
    ({"node": {"x-view-of": "owner", "properties": {}}}, "cannot carry"),
    ({"stub": {"x-view-of": "node", "allOf": [REF("node")]}}, "allOf"),
    ({"stub": {"x-generate": {"list": True}}}, "no 'x-view-of'"),
    ({"stub": {"x-view-of": "missing"}}, "missing"),
])
def test_invalid_view_declarations_are_errors(prisma, entity, match):
    base = {"owner": {"properties": {"name": {}}}, "node": {"properties": {"name": {}}}}
    with pytest.raises(UserSchemaError, match=match):
        _build(prisma, {**base, **entity})


def test_a_column_in_a_view_is_an_error(prisma):
    with pytest.raises(UserSchemaError, match="relation embeds only"):
        _build(prisma, _with_view(**{"x-view-of": "node", "properties": {"name": {}}}))


def test_a_view_may_be_embedded_where_the_model_is_expected(prisma):
    out = _build(prisma, {
        "owner": {"properties": {"name": {}}},
        "owner_view": {"x-view-of": "owner"},
        "node": {"x-generate": {"list": True}, "properties": {"name": {}, "owner": REF("owner_view")}},
    })
    assert "owner" in out["node"]["allOf"][1]["properties"]
