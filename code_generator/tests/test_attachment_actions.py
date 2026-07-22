"""
Regression tests for the attachable-bridge actions generator.

Three surfaces are covered:

  1. `build_attachable_owners` — discovery of base entities that declare
     an `attachable_id` field with x-relationship.target: attachable.

  2. The rendered `lib/attachment/actions.ts` — one select / revalidate
     branch per owner. Drives the template through Jinja2 so format
     regressions (missing imports, malformed `creatorId` chain) fail here
     rather than at `demo:generate` time.

  3. cleanup deletes the file via the AUTO-GENERATED marker guard. Generate
     emits it only when at least one owner exists; cleanup must collect the
     orphan when the schema later drops the last owner, while preserving a
     user-forked copy that has had the marker stripped.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from generators import build_attachable_owners
from cleanup import cleanup

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'


# ---------------------------------------------------------------------------
# Schema fixtures
# ---------------------------------------------------------------------------

def _attachable_owner(name: str) -> dict:
    return {
        'type': 'object',
        'required': ['id', 'attachable_id'],
        'properties': {
            'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
            'attachable_id': {
                'type': 'string',
                'x-relationship': {
                    'type': 'one-to-one_bridge',
                    'target': 'attachable',
                    'labelField': 'id',
                },
            },
        },
    }


def _non_owner() -> dict:
    # Same FK column name, wrong relationship target — must not be picked up.
    return {
        'type': 'object',
        'properties': {
            'id': {'type': 'string'},
            'attachable_id': {
                'type': 'string',
                'x-relationship': {
                    'type': 'many-to-one',
                    'target': 'something_else',
                },
            },
        },
    }


def _schema(*owner_names: str, extras: dict | None = None) -> dict:
    # x-relationship (attachable_id) lives on the raw entity — '__'-prefixed.
    defs = {f'__{name}': _attachable_owner(name) for name in owner_names}
    if extras:
        defs.update(extras)
    return {'definitions': defs}


# ---------------------------------------------------------------------------
# build_attachable_owners
# ---------------------------------------------------------------------------

def test_build_attachable_owners_empty_schema():
    assert build_attachable_owners({'definitions': {}}) == []


def test_build_attachable_owners_picks_one_owner():
    schema = _schema('resource')
    assert build_attachable_owners(schema) == [{'name': 'resource'}]


def test_build_attachable_owners_sorts_by_name():
    """Generator output is deterministic — owners come back alphabetised."""
    schema = _schema('resource', 'product')
    assert build_attachable_owners(schema) == [{'name': 'product'}, {'name': 'resource'}]


def test_build_attachable_owners_skips_view_definitions():
    """The bare view (`resource`) carries x-generate flags but never the FK
    itself — walking the raw ('__'-prefixed) entities is enough, and
    including the view too would double-count owners under the same name."""
    schema = _schema('resource', extras={
        'resource': _attachable_owner('resource'),
    })
    assert build_attachable_owners(schema) == [{'name': 'resource'}]


def test_build_attachable_owners_ignores_wrong_target():
    """A field named `attachable_id` pointing at a different model is not
    an owner — only the actual bridge relationship counts."""
    schema = _schema(extras={'__misnamed': _non_owner()})
    assert build_attachable_owners(schema) == []


# ---------------------------------------------------------------------------
# Rendered template
# ---------------------------------------------------------------------------

def _render(owners: list[dict]) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True,
    )
    return env.get_template('attachment_actions.ts.jinja2').render(owners=owners)


def test_template_emits_select_branch_per_owner():
    out = _render([{'name': 'resource'}, {'name': 'product'}])
    assert 'resource: { select: { creator_id: true } }' in out
    assert 'product: { select: { creator_id: true } }' in out
    assert 'resource: { select: { id: true } }' in out
    assert 'product: { select: { id: true } }' in out


def test_template_emits_creator_chain_terminated_with_null():
    out = _render([{'name': 'resource'}, {'name': 'product'}])
    # The chain must end in `?? null` so the variable resolves to null when
    # every owner lookup is undefined, not to `undefined` (which would skip
    # the permission gate inside `if (creatorId && …)`).
    assert 'owner.resource?.creator_id ??' in out
    assert 'owner.product?.creator_id ??' in out
    # `?? null;` may be split across lines; collapse whitespace before checking.
    collapsed = ' '.join(out.split())
    assert '?? null;' in collapsed
    assert '????' not in collapsed
    assert '??;' not in collapsed


def test_template_emits_revalidate_paths_per_owner():
    out = _render([{'name': 'resource'}])
    assert "revalidatePath(`/[locale]/resource/view/${row.resource.id}`, 'page')" in out
    assert "revalidatePath(`/[locale]/resource/edit/${row.resource.id}`, 'page')" in out


def test_template_with_no_owners_still_renders():
    """When the schema has no attachable owners the file shouldn't be emitted
    at all (see generate.py), but the template must still render to valid
    TypeScript so a future caller that does emit it can rely on the shape."""
    out = _render([])
    # creatorId resolves to null statically — no chain, no syntax error.
    assert 'const creatorId = null;' in out
    # No branches in the select clauses.
    assert ': { select: { creator_id: true } }' not in out


# ---------------------------------------------------------------------------
# cleanup — deletes lib/attachment/actions.ts and lib/dashboard/catalog.ts
# ---------------------------------------------------------------------------

def test_cleanup_deletes_generated_catalogs(tmp_path: Path):
    """The two schema-wide catalogs are emitted by generate.py only when
    at least one contributing entity exists. With no manifest present cleanup
    falls back to the schema-driven sweep, which collects them via the
    AUTO-GENERATED marker guard — so a schema drop doesn't leave stale code on
    disk, while a user-forked copy (marker stripped) would be preserved."""
    out = tmp_path
    (out / 'lib' / 'attachment').mkdir(parents=True)
    (out / 'lib' / 'dashboard').mkdir(parents=True)
    # Real generated catalogs carry this marker; the guard keys off it.
    marker = '// AUTO-GENERATED - DO NOT EDIT\n'
    (out / 'lib' / 'attachment' / 'actions.ts').write_text(marker + '// stale\n')
    (out / 'lib' / 'dashboard' / 'catalog.ts').write_text(marker + '// stale\n')

    # Minimal schema — one entity so cleanup() has something to iterate.
    schema_path = tmp_path / 'schema.yaml'
    schema_path.write_text(
        'definitions:\n'
        '  __thing:\n'
        '    type: object\n'
        '    properties:\n'
        '      id: {type: string}\n'
        '      name: {type: string}\n'
        '  thing:\n'
        '    x-generate: {list: true, view: true, new: true, edit: true,'
        ' delete: true, api: true, test: false}\n'
        '    allOf: [{$ref: "#/definitions/__thing"}]\n'
    )

    cleanup(str(schema_path), str(out))

    assert not (out / 'lib' / 'attachment' / 'actions.ts').exists()
    assert not (out / 'lib' / 'dashboard' / 'catalog.ts').exists()
    # And the now-empty parent dirs are pruned (rmdir attempts the parent;
    # leaves siblings alone — but here both dirs are empty after cleanup).
    assert not (out / 'lib' / 'attachment').exists()
    # `lib/dashboard/` would still hold the per-entity files if the dashboard
    # entity were in the schema. The minimal fixture above has only `thing`,
    # so lib/dashboard is empty and gets pruned too.
    assert not (out / 'lib' / 'dashboard').exists()
