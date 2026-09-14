"""
Regression test for cmd_1047i (PR#530/subtask_1047g real-schema regression,
independent of that PR itself -- see summary below).

Background
----------
`helper_context()`'s "Extend deps to include FK deps needed by datagrid
children" loop (generators_test.py) adds one dep per FK field of a datagrid
child. Each dep's own var_name uses prop-stem naming
(`to_camel_case(re.sub('_id$', '', field['prop_name']))`), so a field like
`destination_bin_id` (target `bin`) gets a dep named `destinationBin`, not
`bin` -- this differs from the target entity's own name whenever the FK
field's name differs from `<target>_id` (multi-FK-to-same-target,
prop-stem-renamed FKs, etc.).

When the SAME loop processes a *different* field of the same datagrid child
whose own target is itself (a self-referencing FK, e.g.
`parent_doc_line_id -> doc_line`), it builds that new self-ref dep's
`fk_deps` by walking the target entity's OWN relations
(`get_parent_relationships(target_def, schema)`) and assigning each one
`dep_var_name: to_camel_case(r['target'])` -- i.e. it *re-derives* a var name
from the target's raw entity name instead of looking up the var name the dep
for that target was ACTUALLY registered under. For `destination_bin_id ->
bin`, this produces `dep_var_name: 'bin'`, but no dep named `bin` exists --
only `destinationBin` does (added earlier in the very same loop, for the
sibling `destination_bin_id` field). The generated test helper then declares
`const destinationBin = ...` but reads an undefined `bin` variable
(`bin_id: bin.id`, `destination_bin_id: bin.id`) -- a ReferenceError at
runtime, confirmed live on proj_g's `goods_receipt_line`/`bin` (26/35 API
e2e spec failures, cmd_1047h/i).

This is a PRE-EXISTING defect in generators_test.py, not something
subtask_1047g/PR#530 introduced -- PR#530 never touched generators_test.py
or test_helper.ts.jinja2. It was empirically confirmed to reproduce
identically against app-generator commit 827d494a^ (the parent of PR#530's
merge commit) using the exact same real schema: byte-identical generated
`cypress/support/goods_receipt/helper.ts` with and without PR#530's changes.
It was simply never triggered before because no dogfood/consumer schema
exercised "self-referencing datagrid child" + "another sibling FK field to a
shared target under a prop-stem-renamed var name" at the same time until
proj_g's schema grew to include it.

Fix (PR#530-adjacent, since superseded for the self-ref case -- see cmd_1050
update below): look up each relation's ALREADY-REGISTERED dep var_name from
the current `deps` list (a `{target: var_name}` map) instead of
re-deriving it.

cmd_1050 update: this fix's own `fk_deps` construction only ran for a
self-referencing datagrid-child FK (`parent_doc_line_id -> doc_line`)
because, at the time, walking into a self-ref target's own relations to
build a `fk_deps` list was still happening at all. cmd_1050 found a
separate, deeper defect in that same self-ref walk (it also pulled in the
OUTER model as an independent, org-blind dependency -- see
`test_datagrid_child_selfref_grandparent_backref_ordering.py`'s cmd_1050
update) and fixed it by skipping a datagrid-child field's `dep_target`
entirely whenever it equals the child's own type, before any resolution
(including this file's `fk_deps`-var-name-lookup fix) ever runs. The
self-ref dep (`doc_line`) this file's remaining two tests looked up no
longer exists at all -- there is nothing left to build `fk_deps` for, so
the ReferenceError shape this file guards against cannot recur (the
generated helper never declares a self-ref var to misuse in the first
place). The ordinary, non-self-ref case this fix was really about --
multiple sibling FK fields on a datagrid child sharing a target under
prop-stem-renamed var names -- is unaffected and still covered by
`test_bin_dep_registered_under_prop_stem_var_name` below.
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
    `doc.lines` embeds `doc_line`, a non-list datagrid child that carries
    TWO many-to-one FKs:
      - `destination_bin_id` -> `bin` (a differently-named prop pointing at
        a target entity -- gets a prop-stem-renamed dep var, `destinationBin`,
        not `bin`), processed FIRST (property order matters: it must be
        registered as a dep before the self-ref field below is processed).
      - `parent_doc_line_id` -> `doc_line` (self-referencing) -- this
        entity's own relations (walked when building the self-ref dep's
        fk_deps) include `destination_bin_id -> bin` too.
    Mirrors proj_g's `goods_receipt_line` shape exactly (destination_bin_id +
    parent_goods_receipt_line_id).
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
                    "doc_id": {"type": "string"},
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


def test_bin_dep_registered_under_prop_stem_var_name():
    """Sanity check on the test fixture itself: destination_bin_id's own dep
    must be registered as `destinationBin`, not the naive `bin`."""
    ctx = _ctx()
    var_names = {d["var_name"] for d in ctx["deps"]}
    assert "destinationBin" in var_names
    assert "bin" not in var_names


def test_selfref_dep_is_not_created_at_all():
    """cmd_1050: a self-referencing FK on the datagrid child's own type
    (parent_doc_line_id -> doc_line) is now skipped entirely -- no dep
    named `doc_line` (or any var_name derived from it, e.g. parentDocLine)
    is registered, so there is no fk_deps list left to build var names for
    in the first place. The sibling destination_bin_id -> bin FK is
    unaffected: its dep is still registered under its prop-stem var name
    (destinationBin), covered by test_bin_dep_registered_under_prop_stem_var_name
    above."""
    ctx = _ctx()
    deps_by_target = {d["target"]: d for d in ctx["deps"]}
    assert "doc_line" not in deps_by_target
    var_names = {d["var_name"] for d in ctx["deps"]}
    assert "parentDocLine" not in var_names
    assert "destinationBin" in var_names
