"""
cmd_563: labelField is mandatory, never defaulted to 'name'.

Every generator site that renders a relationship's display label used to
fall back to `'name'` when `x-relationship`/`x-relationships`/`x-bridge`
didn't declare `labelField` -- even for a consumer whose target entity's
display field isn't named `name` at all. The fallback was silent: a
schema author who forgot the declaration got a generated app that quietly
rendered the wrong field (or an empty label), with nothing in the gate
telling them why.

cmd_563 removes the default at its root (`schema_deriver.py`'s
`_derive_relationship`, which used to inject `labelField: 'name'` into
every undeclared relationship before `validate_schema()` ever saw it --
making the pre-existing "target has no 'name' field" check unreachable
for the far more common case: a target that *does* have an unrelated
`name` field, silently mislabeled) and makes `validate_schema()` require
`labelField` unconditionally on every declaration surface. The RED/GREEN
pairs below are the deviation-injection proof (cmd_476 method): each RED
case is a schema that generated silently before cmd_563 and must now be
rejected with a message naming the entity/field and what to declare;
each GREEN case is the same schema with `labelField` added, which must
pass cleanly.
"""
import pytest

from schema_deriver import derive_property, parse_prisma_schema
from validate import validate_schema, SchemaValidationError


# ---------------------------------------------------------------------------
# Root cause: schema_deriver.py no longer injects a 'name' default
# ---------------------------------------------------------------------------

PRISMA_FIXTURE = """
model role {
  id   String @id @default(cuid())
  name String
}

model permission {
  id      String  @id @default(cuid())
  name    String
  role_id String?
  role    role?   @relation(fields: [role_id], references: [id])
}
"""


@pytest.fixture()
def prisma_models(tmp_path):
    path = tmp_path / "schema.prisma"
    path.write_text(PRISMA_FIXTURE, encoding="utf-8")
    return parse_prisma_schema(path)


def test_derive_relationship_no_longer_defaults_labelfield(prisma_models):
    """Deviation injection at the root: an undeclared labelField must come
    out of derivation as None, not 'name' -- this is what previously made
    the target-has-'name' loophole in validate_schema() unreachable for
    every relationship going through the standard build_user_schema.py
    pipeline (i.e. every relationship in a real json_schema.yaml)."""
    prop = derive_property(prisma_models["permission"], "role_id", {"x-relationship": {}})
    assert prop["x-relationship"]["labelField"] is None


def test_derive_relationship_preserves_declared_labelfield(prisma_models):
    """GREEN: an explicitly declared labelField passes through untouched."""
    prop = derive_property(
        prisma_models["permission"], "role_id",
        {"x-relationship": {"labelField": "name"}},
    )
    assert prop["x-relationship"]["labelField"] == "name"


# ---------------------------------------------------------------------------
# validate_schema() section 2: single x-relationship (m2o/o2o/o2o_bridge)
# ---------------------------------------------------------------------------

def _schema_single_rel(rel: dict, target_has_name: bool = True) -> dict:
    target_props = {"name": {"type": "string"}} if target_has_name else {"id": {"type": "string"}}
    return {
        "definitions": {
            "goods_receipt_line": {
                "properties": {
                    "purchase_order_id": {"type": "string", "x-relationship": rel},
                },
            },
            "target": {"properties": target_props},
        },
    }


class TestSingleRelationshipLabelFieldMandatory:
    def test_red_no_labelfield_rejected_even_when_target_has_name(self):
        """RED: before cmd_563 this schema generated silently (target has a
        'name' field, so the old carve-out let the missing declaration
        through). It must now be rejected -- a target having 'name' is not
        the same as the schema author having declared it."""
        schema = _schema_single_rel({"type": "many-to-one", "target": "target"}, target_has_name=True)
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert "goods_receipt_line" in msg
        assert "purchase_order_id" in msg
        assert "labelField" in msg

    def test_red_no_labelfield_rejected_when_target_has_no_name(self):
        """RED: the pre-existing case (target has no 'name' field either) --
        must still be rejected, now with the mandatory-labelField message
        rather than the retired name-fallback message."""
        schema = _schema_single_rel({"type": "many-to-one", "target": "target"}, target_has_name=False)
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert "labelField" in str(exc_info.value)

    def test_green_declared_labelfield_accepted(self):
        """GREEN: declaring labelField explicitly passes."""
        schema = _schema_single_rel({"type": "many-to-one", "target": "target", "labelField": "name"})
        validate_schema(schema)  # must not raise


# ---------------------------------------------------------------------------
# validate_schema() section 3: x-relationships (many-to-many / one-to-many)
# ---------------------------------------------------------------------------

def _schema_x_relationships(rel_type: str, rel_info: dict) -> dict:
    return {
        "definitions": {
            "user": {
                "x-relationships": {"roles": {"type": rel_type, "target": "role", **rel_info}},
                "properties": {
                    "roles": {"type": "array", "items": {"$ref": "#/definitions/role"}},
                },
            },
            "role": {"properties": {"name": {"type": "string"}}},
        },
    }


class TestXRelationshipsLabelFieldMandatory:
    def test_red_many_to_many_no_labelfield_rejected(self):
        """RED: before cmd_563, a m2m target with a 'name' field (role.name
        here) generated silently. Now rejected."""
        schema = _schema_x_relationships("many-to-many", {})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert "user" in msg
        assert "roles" in msg
        assert "labelField" in msg

    def test_red_one_to_many_no_labelfield_rejected(self):
        """RED: cmd_563 extends the same requirement to one-to-many
        x-relationships entries (e.g. list-output entity-picker children) --
        generate_types.py reads labelField off these uniformly regardless
        of type, so leaving one-to-many unchecked would have kept the
        silent-'name'-default defect alive for that type."""
        schema = _schema_x_relationships("one-to-many", {})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert "labelField" in str(exc_info.value)

    def test_green_many_to_many_declared_labelfield_accepted(self):
        schema = _schema_x_relationships("many-to-many", {"labelField": "name"})
        validate_schema(schema)  # must not raise


# ---------------------------------------------------------------------------
# validate_schema() section 6: x-bridge parents
# ---------------------------------------------------------------------------

def _schema_x_bridge(parent_entry: dict) -> dict:
    return {
        "definitions": {
            "commentable": {"properties": {}},
            "comment": {
                "x-bridge": {
                    "name": "commentable",
                    "child": "comment",
                    "parents": [{"role": "channel_hub", "target": "channel", **parent_entry}],
                },
                "properties": {},
            },
            "channel": {"properties": {"name": {"type": "string"}}},
        },
    }


class TestXBridgeParentsLabelFieldMandatory:
    def test_red_no_labelfield_rejected(self):
        """RED: bridge_direction.py used to default an undeclared parent
        labelField to 'name' the same way single/x-relationships did --
        x-bridge parents had no validate_schema() coverage for this at all
        before cmd_563. Now rejected."""
        schema = _schema_x_bridge({})
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert "comment" in msg
        assert "channel" in msg
        assert "labelField" in msg

    def test_green_declared_labelfield_accepted(self):
        schema = _schema_x_bridge({"labelField": "name"})
        validate_schema(schema)  # must not raise
