#!/usr/bin/env python3
"""
cleanup.py — Remove files and entries created by the code generator.

For fully overwritten files: deletes them entirely.
For appended files (messages/*.json, lib/site-config.ts,
app/[locale]/@sidebar/page.tsx): removes only the generated entries,
preserving manual content.

Stubs (form_validation.ts, service_validation.ts) are deleted unless
--keep-stubs is passed, since they may contain user customizations.
service_after_create.ts is generated write-once; cleanup deletes it only
when the file still matches the original stub template output.

--prune-orphans sweeps files that are generator-shaped but no longer
expected by the current schema (e.g., a column_def.tsx left behind after
an entity's children were removed). The regular pass is schema-driven and
only knows about today's entities/gates, so prior-schema artefacts linger
without this mode.

Usage (run from code_generator/):
    python cleanup.py <schema.yaml> <output-dir> [--keep-stubs] [--prune-orphans]

Examples:
    python cleanup.py json_schema_db_table.yaml ..
    python cleanup.py json_schema_db_table.yaml .. --keep-stubs
    python cleanup.py json_schema_db_table.yaml .. --prune-orphans
"""
import json
import re
import sys
from pathlib import Path

import yaml

from generate_types import extract_entities
from helpers.naming import to_camel_case
from helpers.schema_helpers import filter_fields
from manifest import MANIFEST_FILENAME, sha256_file

_SYSTEM_PROPS = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'}

# Handwritten files that happen to look like generator-shaped paths.
# prune_orphans() will never delete these, even if no schema entity matches.
HANDWRITTEN_ALLOWLIST: frozenset[str] = frozenset([
    # register pages (handwritten auth flow)
    "app/[locale]/register/page.tsx",
    "app/[locale]/register/page.test.tsx",
    # mobile layout test (handwritten e2e)
    "cypress/e2e/mobile/layout.cy.ts",
    # setting page (handwritten; coexists with generated edit/view)
    "app/[locale]/setting/page.tsx",
    # docs layout (handwritten)
    "app/[locale]/docs/layout.tsx",
    # login pages
    "app/[locale]/login/page.tsx",
    "app/[locale]/login/page.test.tsx",
])

# Boilerplate content of service_after_create.ts as emitted by
# templates/service_after_create_stub.ts.jinja2. Mirror the template output
# exactly (including trailing newline) so the equality check below stays
# tight — any user customization, even reformatting, will preserve the file.
_SERVICE_AFTER_CREATE_BOILERPLATE = (
    "export async function afterCreate(\n"
    "  _tx: unknown,\n"
    "  _created: Record<string, unknown>,\n"
    "  _data: Record<string, unknown>,\n"
    "): Promise<void> {}\n"
)


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------

def _delete(path: Path) -> None:
    if path.exists():
        path.unlink()
        print(f'  Deleted {path}')


def _delete_if_boilerplate(path: Path, expected: str) -> None:
    """Delete `path` only when its content exactly matches `expected`.

    Used for hook-stub files that the generator emits via _write_stub (i.e.
    written once, never overwritten). If the user has customized the file,
    its content will differ from the stub template's output and we preserve
    it; otherwise it's safe to delete on cleanup.
    """
    if not path.exists():
        return
    if path.read_text(encoding='utf-8') == expected:
        path.unlink()
        print(f'  Deleted {path} (boilerplate)')
    else:
        print(f'  Kept {path} (customized)')


_GENERATED_MARKER = 'AUTO-GENERATED'


def _delete_if_generated(path: Path, marker: str = _GENERATED_MARKER) -> None:
    """Delete `path` only while it still carries the generator's marker.

    Schema-global files (dashboard catalog/aggregate route, attachment actions)
    are fully regenerated each run and carry an `AUTO-GENERATED` header, so they
    are not meant for hand edits. But a user who deliberately forks one will
    strip that header; the marker check lets us delete the untouched generated
    file while preserving a customized copy. Unlike _delete_if_boilerplate this
    works for files whose body is schema-dependent (can't be matched exactly).
    """
    if not path.exists():
        return
    head = ''.join(path.read_text(encoding='utf-8').splitlines(keepends=True)[:5])
    if marker in head:
        path.unlink()
        print(f'  Deleted {path} (generated)')
    else:
        print(f'  Kept {path} (no {marker} marker — treated as customized)')


def _try_rmdir(path: Path) -> None:
    """Remove directory if it exists and is empty."""
    try:
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
            print(f'  Removed empty dir {path}')
    except Exception:
        pass


def _rmdir_tree(path: Path) -> None:
    """Recursively remove empty directories bottom-up."""
    if not path.is_dir():
        return
    for child in list(path.iterdir()):
        if child.is_dir():
            _rmdir_tree(child)
    _try_rmdir(path)


def _clean_from_manifest(out: Path, keep_stubs: bool = False) -> bool:
    """Delete files listed in <out>/.generated-manifest.json, hash-guarded.

    Authoritative when present: generate.py records every file it writes (with a
    content hash), so we remove exactly those — no path re-derivation, no drift.
    A listed file is deleted ONLY when its current bytes still hash to the
    recorded value; if the user edited it since generation we keep it. Appended
    files are never in the manifest, so they are untouched here. Returns True
    when a manifest was found and processed (callers then skip the legacy
    schema-derived sweep).
    """
    manifest_path = out / MANIFEST_FILENAME
    if not manifest_path.exists():
        return False

    print(f'\nDeleting generated files from {manifest_path}...')
    data = json.loads(manifest_path.read_text(encoding='utf-8'))

    dirs: set[Path] = set()
    for entry in data.get('files', []):
        rel = entry['path']
        path = out / rel
        for parent in Path(rel).parents:
            if parent != Path('.'):
                dirs.add(out / parent)
        if keep_stubs and entry.get('mode') == 'stub':
            print(f'  Kept {path} (stub, --keep-stubs)')
            continue
        if not path.exists():
            continue
        if sha256_file(path) == entry.get('sha256'):
            path.unlink()
            print(f'  Deleted {path}')
        else:
            print(f'  Kept {path} (modified since generation)')

    # Prune now-empty generated directories, deepest first.
    for d in sorted(dirs, key=lambda p: len(p.parts), reverse=True):
        _try_rmdir(d)

    manifest_path.unlink()
    print(f'  Deleted {manifest_path}')
    return True


# ---------------------------------------------------------------------------
# Key collection (mirrors generators_i18n.py)
# ---------------------------------------------------------------------------

def _collect_field_keys(entities: list, schema: dict) -> set:
    from generators_i18n import _CUSTOM_COMPONENT_FIELD_KEYS
    keys = set()
    for entity in entities:
        model = entity['model']
        gen_cfg = entity['generate_config']
        model_def = schema['definitions'].get(model, {})
        props = filter_fields(model_def.get('properties', {}), gen_cfg.get('fields'))
        for prop_name, prop in props.items():
            if prop_name in _SYSTEM_PROPS:
                continue
            rel = prop.get('x-relationship', {})
            if rel.get('type') == 'many-to-one':
                base = prop_name[:-3] if prop_name.endswith('_id') else prop_name
                keys.add(to_camel_case(base))
            elif rel.get('type') == 'one-to-one':
                continue  # internal bridge model, not user-facing
            else:
                keys.add(to_camel_case(prop_name))
        for child in entity.get('children', []):
            keys.add(to_camel_case(child['property_name']))
        # Custom component keys (entity-level x-custom-components is a list).
        def_key = entity.get('definition_key', '')
        custom_comps = schema['definitions'].get(def_key, {}).get('x-custom-components') or []
        if isinstance(custom_comps, list):
            for custom_comp in custom_comps:
                if not isinstance(custom_comp, dict):
                    continue
                comp_name = custom_comp.get('name', '')
                keys.update(_CUSTOM_COMPONENT_FIELD_KEYS.get(comp_name, {}).keys())
    return keys


# ---------------------------------------------------------------------------
# Appended-file cleaners
# ---------------------------------------------------------------------------

def _clean_messages(path: Path, entity_label_keys: set, nav_keys: set, field_keys: set) -> None:
    if not path.exists():
        return
    with open(path, encoding='utf-8') as f:
        data = json.load(f)

    changed = False
    for section, keys in [
        ('EntityLabel', entity_label_keys),
        ('Nav',         nav_keys),
        ('Fields',      field_keys),
    ]:
        if section not in data:
            continue
        for key in list(data[section].keys()):
            if key in keys:
                del data[section][key]
                changed = True
        if not data[section]:
            del data[section]

    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        print(f'  Cleaned {path}')
    else:
        print(f'  No changes: {path}')


def _clean_site_config(path: Path, nav_hrefs: list) -> None:
    if not path.exists():
        return
    content = path.read_text(encoding='utf-8')
    original = content
    for href in nav_hrefs:
        # Matches: { label: "...", href: "/parent" },  (with leading whitespace / newline)
        content = re.sub(
            r'[ \t]*\{ label: "[^"]*", href: "' + re.escape(href) + r'" \},\n?',
            '',
            content,
        )
    if content != original:
        path.write_text(content, encoding='utf-8')
        print(f'  Cleaned {path}')
    else:
        print(f'  No changes: {path}')


def _clean_sidebar(path: Path, nav_hrefs: list) -> None:
    if not path.exists():
        return
    content = path.read_text(encoding='utf-8')
    original = content
    for href in nav_hrefs:
        # Matches:   "/parent": "camelKey",  (with leading whitespace / newline)
        content = re.sub(
            r'[ \t]*"' + re.escape(href) + r'":\s*"[^"]+",\n?',
            '',
            content,
        )
    if content != original:
        path.write_text(content, encoding='utf-8')
        print(f'  Cleaned {path}')
    else:
        print(f'  No changes: {path}')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _prune_orphans(out: Path, entities: list) -> None:
    """Sweep generator-shaped files that the current schema no longer expects.

    The regular cleanup pass is schema-driven: it walks `entities` from the
    current schema and deletes only files those entities would still
    produce. When a schema gate flips off (e.g., an entity loses its
    children list, or is renamed/removed entirely), the file generated
    under the old gate is invisible to that pass and lingers forever.

    Today this handles one orphan class:

    - **components/<entity>/column_def.tsx** — generated only when an entity
      has children AND (can_view OR can_edit). When children are removed
      (e.g., after refactoring attachment/image lists onto the `attachable`
      bridge model), the file stays on disk. Also caught: entities that no
      longer exist in the schema at all.

    Add new orphan classes here as they're identified. Each pattern should
    match a specific path and re-evaluate the original generation gate
    against the current schema before deleting.
    """
    print('\nPruning orphans...')
    entities_by_parent = {e['parent']: e for e in entities}

    def _is_protected(path: Path) -> bool:
        rel = str(path.relative_to(out))
        if rel in HANDWRITTEN_ALLOWLIST:
            print(f'  PROTECTED (allowlist): {rel}')
            return True
        return False

    components_root = out / 'components'
    if components_root.is_dir():
        for col_def in sorted(components_root.glob('*/column_def.tsx')):
            parent = col_def.parent.name
            entity = entities_by_parent.get(parent)
            if entity is None:
                # Whole entity gone from schema — definitely an orphan.
                if not _is_protected(col_def):
                    _delete(col_def)
                    _try_rmdir(col_def.parent)
                continue
            gen_cfg  = entity.get('generate_config', {})
            children = entity.get('children', [])
            can_view = gen_cfg.get('view', True)
            can_edit = gen_cfg.get('edit', True)
            # Mirror generate.py:191 — column_def.tsx is only emitted when
            # the entity has children AND at least one read/edit page that
            # consumes the column functions.
            if not (children and (can_view or can_edit)):
                if not _is_protected(col_def):
                    _delete(col_def)

    # cypress/support/<entity>/*.ts — test helpers for removed entities.
    # Sweep any AUTO-GENERATED file in an entity sub-dir with no schema match.
    cypress_support = out / 'cypress' / 'support'
    if cypress_support.is_dir():
        for ts_file in sorted(cypress_support.glob('*/*.ts')):
            parent = ts_file.parent.name
            if entities_by_parent.get(parent) is None:
                if not _is_protected(ts_file):
                    _delete_if_generated(ts_file)
                    _try_rmdir(ts_file.parent)

    # app/[locale]/docs/<entity>/page.mdx — doc pages for removed entities.
    docs_app_root = out / 'app' / '[locale]' / 'docs'
    if docs_app_root.is_dir():
        for page in sorted(docs_app_root.glob('*/page.mdx')):
            parent = page.parent.name
            if entities_by_parent.get(parent) is None:
                if not _is_protected(page):
                    _delete(page)
                    _try_rmdir(page.parent)

    # docs/generated/<entity>.md — generated markdown for removed entities.
    docs_gen_root = out / 'docs' / 'generated'
    if docs_gen_root.is_dir():
        for doc in sorted(docs_gen_root.glob('*.md')):
            parent = doc.stem
            if entities_by_parent.get(parent) is None:
                if not _is_protected(doc):
                    _delete(doc)


def cleanup(schema_path: str, output_dir: str, keep_stubs: bool = False, prune_orphans: bool = False) -> None:
    with open(schema_path) as f:
        schema = yaml.safe_load(f)

    entities = extract_entities(schema)
    if not entities:
        print('No entities found in schema.', file=sys.stderr)
        return

    out = Path(output_dir)
    test_entities = [e for e in entities if e['generate_config'].get('test')]

    print(f'Found {len(entities)} entities in {schema_path}')

    # Manifest-driven deletion is authoritative when present: generate.py records
    # every file it writes (with a content hash), so cleanup removes exactly those
    # — no path re-derivation, no drift. The schema-derived sweep is a fallback
    # for trees generated before manifests existed.
    if not _clean_from_manifest(out, keep_stubs):
        _clean_schema_driven(out, entities, test_entities, keep_stubs)

    _clean_appended_files(out, entities, schema)

    if prune_orphans:
        _prune_orphans(out, entities)

    print('\nCleanup complete!')


def _clean_schema_driven(out: Path, entities: list, test_entities: list,
                         keep_stubs: bool) -> None:
    """Legacy fallback: delete generated files by re-deriving their paths from
    the schema. Used only when no .generated-manifest.json is present. This is
    best-effort and subject to path drift — the manifest path is exact."""
    # -------------------------------------------------------------------------
    # Per-entity file deletion
    # -------------------------------------------------------------------------
    for entity in entities:
        parent     = entity['parent']
        gen_cfg    = entity.get('generate_config', {})
        children   = entity.get('children', [])

        can_list   = gen_cfg.get('list', True)
        can_view   = gen_cfg.get('view', True)
        can_new    = gen_cfg.get('new', True)
        can_edit   = gen_cfg.get('edit', True)
        can_delete = gen_cfg.get('delete', True)
        can_api    = gen_cfg.get('api', False)
        can_test   = gen_cfg.get('test', False)

        lib_dir        = out / 'lib'        / parent
        components_dir = out / 'components' / parent
        app_dir        = out / 'app' / '[locale]' / parent
        api_dir        = out / 'app' / 'api' / parent

        print(f'\nCleaning: {parent}')

        # lib/
        _delete(lib_dir / 'types.ts')
        _delete(lib_dir / 'getters.ts')
        if can_new or can_edit or can_delete:
            _delete(lib_dir / 'service.ts')
            _delete(lib_dir / 'actions.ts')
            if not keep_stubs:
                _delete(lib_dir / 'service_validation.ts')
        # service_after_create.ts is generated with _write_stub (write-once,
        # never overwritten — user may customize it). Delete only when the
        # file still matches the original stub template output.
        if can_new:
            _delete_if_boilerplate(
                lib_dir / 'service_after_create.ts',
                _SERVICE_AFTER_CREATE_BOILERPLATE,
            )
        _delete(lib_dir / 'chart-getters.ts')  # safe if not present

        # components/
        if can_new or can_edit:
            _delete(components_dir / 'FormUpsert.tsx')
            if not keep_stubs:
                _delete(components_dir / 'form_validation.ts')
        if can_view:
            _delete(components_dir / 'FormView.tsx')
        if children and (can_view or can_edit):
            _delete(components_dir / 'column_def.tsx')

        # app/[locale]/ pages. Mirror generate.py's per-page conditions so we
        # never delete a hand-authored page the generator does not emit. The
        # list page.tsx is only written when `list: true`; an entity with
        # `list: false` (e.g. `setting`) owns its page.tsx manually.
        if can_list:
            _delete(app_dir / 'page.tsx')
        _delete(app_dir / 'chart' / 'page.tsx')
        if can_new:
            _delete(app_dir / 'new' / 'page.tsx')
        if can_edit:
            _delete(app_dir / 'edit' / '[id]' / 'page.tsx')
        if can_view:
            _delete(app_dir / 'view' / '[id]' / 'page.tsx')

        # app/api/
        if can_api:
            _delete(api_dir / 'route.ts')
            _delete(api_dir / '[id]' / 'route.ts')
            _delete(api_dir / 'bulk' / 'route.ts')

        # docs/
        _delete(out / 'docs' / 'generated' / f'{parent}.md')
        _delete(out / 'app' / '[locale]' / 'docs' / parent / 'page.mdx')

        # Cypress tests
        if can_test:
            _delete(out / 'cypress' / 'support' / parent / 'helper.ts')
            _delete(out / 'cypress' / 'e2e' / f'{parent}.cy.ts')
            _delete(out / 'cypress' / 'e2e' / 'mobile' / f'{parent}.cy.ts')
            if can_api:
                _delete(out / 'cypress' / 'e2e' / 'api' / f'{parent}.cy.ts')
            # Reservation API spec + helper. generate.py emits these only for
            # x-reservation count-mode entities (guarded by reservation_spec_context,
            # not by can_api); _delete is a no-op when absent, so we attempt them
            # for every test entity. The `_gen` suffix keeps these generated files
            # distinct from a hand-written `<parent>_reservation.cy.ts` /
            # `reservation_helper.ts`, which cleanup must never touch.
            _delete(out / 'cypress' / 'support' / parent / 'reservation_gen_helper.ts')
            _delete(out / 'cypress' / 'e2e' / 'api' / f'{parent}_reservation_gen.cy.ts')

        # Remove empty entity directories
        _rmdir_tree(lib_dir)
        _rmdir_tree(components_dir)
        _rmdir_tree(app_dir)
        if can_api:
            _rmdir_tree(api_dir)
        _rmdir_tree(out / 'app' / '[locale]' / 'docs' / parent)
        if can_test:
            _rmdir_tree(out / 'cypress' / 'support' / parent)

    # -------------------------------------------------------------------------
    # Once-only files
    # -------------------------------------------------------------------------
    print('\nCleaning once-only files...')
    _delete(out / 'docs' / 'generated' / 'index.md')
    _delete(out / 'app' / '[locale]' / 'docs' / 'page.mdx')
    if test_entities:
        _delete(out / 'cypress' / 'support' / 'generated-tasks.ts')

    # Schema-wide auto-generated files. generate.py emits these only when at
    # least one entity opts in (`x-display.dashboard: true` for the dashboard
    # catalog + aggregate route, `attachable_id` for the attachment bridge
    # actions). They carry an AUTO-GENERATED marker and are rewritten every run,
    # so cleanup removes them via _delete_if_generated: an untouched generated
    # file is swept (so dropping the last contributing entity leaves nothing
    # stale behind), while a user who stripped the marker to fork the file keeps
    # their copy rather than silently losing it.
    _delete_if_generated(out / 'lib' / 'dashboard' / 'catalog.ts')
    _try_rmdir(out / 'lib' / 'dashboard')
    # Dashboard aggregate REST endpoint — emitted alongside the catalog, but it
    # lives under the schema-wide app/api/dashboard/ tree rather than any
    # per-entity api dir, so the per-entity loop above never touches it.
    _delete_if_generated(out / 'app' / 'api' / 'dashboard' / 'aggregate' / 'route.ts')
    _try_rmdir(out / 'app' / 'api' / 'dashboard' / 'aggregate')
    _try_rmdir(out / 'app' / 'api' / 'dashboard')
    _delete_if_generated(out / 'lib' / 'attachment' / 'actions.ts')
    _try_rmdir(out / 'lib' / 'attachment')

    _try_rmdir(out / 'docs' / 'generated')
    _try_rmdir(out / 'app' / '[locale]' / 'docs')


def _clean_appended_files(out: Path, entities: list, schema: dict) -> None:
    """Remove only the generator-injected ENTRIES from files that are appended on
    top of user-owned content: messages/*.json, lib/site-config.ts, and
    app/[locale]/@sidebar/page.tsx. These files are never deleted outright and are
    deliberately absent from the manifest, so this runs in both manifest and
    fallback modes."""
    print('\nCleaning appended files...')

    nav_entities = [
        e for e in entities
        if e['parent'] == e['model'] and e['generate_config'].get('list', True)
    ]
    entity_label_keys = {to_camel_case(e['parent']) for e in entities}
    nav_keys          = {to_camel_case(e['parent']) for e in nav_entities}
    field_keys        = _collect_field_keys(entities, schema)
    nav_hrefs         = [f'/{e["parent"]}' for e in nav_entities]

    for lang_file in sorted((out / 'messages').glob('*.json')):
        _clean_messages(lang_file, entity_label_keys, nav_keys, field_keys)

    _clean_site_config(out / 'lib' / 'site-config.ts', nav_hrefs)
    _clean_sidebar(out / 'app' / '[locale]' / '@sidebar' / 'page.tsx', nav_hrefs)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    flags = [a for a in sys.argv[1:] if a.startswith('-')]

    if len(args) < 2:
        print('Usage: python cleanup.py <schema.yaml> <output-dir> [--keep-stubs] [--prune-orphans]')
        print('Example: python cleanup.py json_schema_db_table.yaml ..')
        sys.exit(1)

    cleanup(
        args[0],
        args[1],
        keep_stubs='--keep-stubs' in flags,
        prune_orphans='--prune-orphans' in flags,
    )
