"""
cmd_571 (supersedes cmd_563): labelField keeps its default of 'name' --
what needed fixing was never the default itself, only whether the existing
"target has no resolvable label field" rule in validate_schema() actually
reaches an undeclared relationship once schema_deriver.py has already
substituted the 'name' default for it.

cmd_563 made `labelField` mandatory everywhere, at the cost of ~30 call
sites, 8 schema declarations that were purely decorative (the target
already had `name`), and a documented consumer migration for downstream
projects that this cmd retires as unnecessary (see an earlier report
item 4). The actual, narrower concern was whether a declaration meant for
display purposes was being repurposed for a non-display use elsewhere --
a separate, still-open question this file does not attempt to resolve.

Empirical finding (this file's real point, per task item 2/3): running the
actual `build_user_schema.py` -> `validate_schema()` pipeline with a
deviation-injected target that has NO usable label field -- declared or
defaulted -- proves the *existing* rule already rejects it. No reordering
of injection vs. validation was needed: `_derive_relationship()` always
runs (via `build_user_schema.py`) before `validate_schema()` ever sees the
schema, so by validation time an undeclared `labelField` has already
become the literal string `'name'` -- validate_schema()'s existing
`resolve_label_paths()` call (section 2c) evaluates that resolved value
unconditionally, whether it came from an explicit declaration or the
default, and raises exactly the same "not a property of" error either way.

What genuinely can't be caught by any static check -- and is NOT what this
file tests -- is a target that has an unrelated 'name' field (so resolution
"succeeds") that isn't actually the intended display field. That's a
semantic authoring concern, not a validation-reachability bug.
"""
import pytest

from schema_deriver import derive_property, parse_prisma_schema
from build_user_schema import build_intermediate_schema
from validate import validate_schema, SchemaValidationError


# ---------------------------------------------------------------------------
# Root cause revisited: schema_deriver.py DOES default labelField to 'name'
# (restored -- this is intentional, not the bug).
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


def test_derive_relationship_defaults_labelfield_to_name(prisma_models):
    """An undeclared labelField comes out of derivation as 'name', not None
    -- this is what makes it reach validate_schema() already resolved, not
    a hole for validate_schema() to separately special-case."""
    prop = derive_property(prisma_models["permission"], "role_id", {"x-relationship": {}})
    assert prop["x-relationship"]["labelField"] == "name"


def test_derive_relationship_preserves_declared_labelfield(prisma_models):
    prop = derive_property(
        prisma_models["permission"], "role_id",
        {"x-relationship": {"labelField": "name"}},
    )
    assert prop["x-relationship"]["labelField"] == "name"


# ---------------------------------------------------------------------------
# Real pipeline (build_user_schema.py -> validate_schema()), section 2:
# single x-relationship (m2o/o2o/o2o_bridge). This is the surface cmd_563
# claimed was unreachable; the RED case below proves it is not.
# ---------------------------------------------------------------------------

FOO_BAR_PRISMA = """
model foo {{
  id    String @id @default(cuid())
  {label_col} String
}}

model bar {{
  id     String @id @default(cuid())
  foo_id String?
  foo    foo?   @relation(fields: [foo_id], references: [id])
}}
"""


def _build(tmp_path, label_col: str, declare_labelfield: str | None):
    prisma_path = tmp_path / "schema.prisma"
    prisma_path.write_text(FOO_BAR_PRISMA.format(label_col=label_col), encoding="utf-8")
    prisma_models = parse_prisma_schema(prisma_path)

    rel = {"type": "many-to-one", "target": "foo"}
    if declare_labelfield is not None:
        rel["labelField"] = declare_labelfield

    user_schema = {
        "definitions": {
            "foo": {"fields": {label_col: {}}},
            "bar": {"fields": {"foo_id": {"x-relationship": rel}}},
        },
    }
    return build_intermediate_schema(user_schema, prisma_models)


class TestSingleRelationshipDefaultResolution:
    def test_red_unresolvable_default_rejected(self, tmp_path):
        """RED (deviation injection): target's only string field is
        'title', not 'name'; labelField is left undeclared so it defaults
        to 'name'. The default does not resolve on 'foo' --
        validate_schema() must reject this, proving the existing rule
        reaches an auto-defaulted (not just explicitly declared) value."""
        schema = _build(tmp_path, label_col="title", declare_labelfield=None)
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert "bar" in msg
        assert "foo_id" in msg
        assert "foo" in msg
        assert "name" in msg

    def test_green_default_resolves_when_target_has_name(self, tmp_path):
        """GREEN: target's label field genuinely is 'name' -- the common
        case -- and labelField is left undeclared. Must pass without
        requiring a purely decorative `labelField: name` declaration."""
        schema = _build(tmp_path, label_col="name", declare_labelfield=None)
        validate_schema(schema)  # must not raise

    def test_green_explicit_labelfield_overrides_default(self, tmp_path):
        """GREEN: target's label field is 'title'; an explicit labelField
        declaration resolves it correctly -- declaring is still fully
        supported, just never required when the default already works."""
        schema = _build(tmp_path, label_col="title", declare_labelfield="title")
        validate_schema(schema)  # must not raise

    def test_red_explicit_labelfield_still_validated(self, tmp_path):
        """RED: an explicitly declared labelField that doesn't resolve is
        still rejected (unchanged pre-existing behavior, section 2c)."""
        schema = _build(tmp_path, label_col="title", declare_labelfield="nonexistent_field")
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        assert "nonexistent_field" in str(exc_info.value)


# ---------------------------------------------------------------------------
# validate_schema() section 3: x-relationships. These entries are never
# routed through schema_deriver.py (build_user_schema.py copies
# `x-relationships` through verbatim as view-level config) -- there is no
# injection-ordering question here at all; the pre-existing
# declared-or-target-has-'name' check was always directly reachable.
#
# Note: this check only ever covered `many-to-many`, not `one-to-many` --
# that asymmetry predates cmd_563 and is unchanged by this revert; closing
# it is out of scope here (see an earlier report item 4).
# ---------------------------------------------------------------------------

def _schema_x_relationships(rel_type: str, rel_info: dict, target_has_name: bool = True) -> dict:
    target_props = {"name": {"type": "string"}} if target_has_name else {"title": {"type": "string"}}
    return {
        "definitions": {
            "user": {
                "x-relationships": {"roles": {"type": rel_type, "target": "role", **rel_info}},
                "properties": {
                    "roles": {"type": "array", "items": {"$ref": "#/definitions/role"}},
                },
            },
            "role": {"properties": target_props},
        },
    }


class TestXRelationshipsDefaultResolution:
    def test_red_many_to_many_unresolvable_default_rejected(self):
        schema = _schema_x_relationships("many-to-many", {}, target_has_name=False)
        with pytest.raises(SchemaValidationError) as exc_info:
            validate_schema(schema)
        msg = str(exc_info.value)
        assert "user" in msg
        assert "roles" in msg

    def test_green_many_to_many_default_resolves_when_target_has_name(self):
        schema = _schema_x_relationships("many-to-many", {}, target_has_name=True)
        validate_schema(schema)  # must not raise

    def test_green_declared_labelfield_accepted(self):
        schema = _schema_x_relationships("many-to-many", {"labelField": "name"}, target_has_name=True)
        validate_schema(schema)  # must not raise
