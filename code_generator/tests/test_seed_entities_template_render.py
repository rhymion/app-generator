"""
Regression test: seed_entities.ts.jinja2 rendered
`seed_entity_grants[entity].update` using Jinja2's `.` attribute accessor.
Jinja2 resolves `.` by trying `getattr()` before falling back to
`__getitem__()` -- and Python dicts have their own built-in `update()`
method, so `some_dict.update` resolves to that bound method object (always
truthy) instead of the dict's `'update'` key. Every entity's grant was
rendered as `update: true` in the generated TypeScript regardless of the
actual computed value, silently defeating the whole point of this fix for
exactly the one operation (`x-generate.edit` -> `update`) the fix exists to
scope correctly.

This went undetected by test_seed_entities_context.py (which only tests
the Python context-builder function, never the template render) and by
this repo's own generate-code + build gate (this repo's own schema has no
SEED_ENTITIES-eligible entity with x-generate.edit: false -- only
x-generate.new/delete are ever false here, on 'user'). It surfaced only
when generating a real consumer schema (inventory-app's 'purchase_order',
x-generate.edit: false) and reading the actual rendered output text, not
just calling seed_entities_context() directly.

`create`/`read`/`delete`/`import` do not collide with any dict method
name, so they rendered correctly even with the same accessor style; only
`update` was ever silently wrong. The fix (and this test) uses explicit
`['key']` item access for all five fields, both to fix `update` and to
remove the same latent risk from the other four.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'


def _render(seed_entity_names: list[str], seed_entity_grants: dict) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    return env.get_template('seed_entities.ts.jinja2').render(
        seed_entity_names=seed_entity_names,
        seed_entity_grants=seed_entity_grants,
    )


def test_update_false_renders_as_false_not_true() -> None:
    """The exact regression: an entity whose x-generate.edit is False must
    render `update: false,` in the generated TypeScript, not `update:
    true,` -- proving the rendered TEXT matches the computed grant, not
    just the Python dict the template was handed."""
    rendered = _render(
        ['purchase_order'],
        {'purchase_order': {
            'create': True, 'read': True, 'update': False,
            'delete': False, 'import': True,
        }},
    )
    assert "update: false," in rendered, (
        "update rendered as true (or missing) despite the computed grant "
        "being False -- the Jinja2 `.update` / dict.update() method-name "
        "collision has regressed"
    )
    assert "update: true," not in rendered


def test_update_true_still_renders_as_true() -> None:
    """Sanity counterpart: when update really is True, it must still
    render true -- the fix must not have flipped the polarity instead of
    fixing the accessor."""
    rendered = _render(
        ['role'],
        {'role': {
            'create': True, 'read': True, 'update': True,
            'delete': True, 'import': True,
        }},
    )
    assert "update: true," in rendered
    assert "update: false," not in rendered


def test_all_five_operations_render_their_own_computed_value() -> None:
    """Every field independently reflects its own computed boolean, not a
    blanket true -- covers the same accessor-collision risk for every key,
    not just `update`."""
    grant = {
        'create': True, 'read': False, 'update': False,
        'delete': True, 'import': False,
    }
    rendered = _render(['widget'], {'widget': grant})
    assert "create: true," in rendered
    assert "read: false," in rendered
    assert "update: false," in rendered
    assert "delete: true," in rendered
    assert "import: false," in rendered
