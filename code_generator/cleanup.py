#!/usr/bin/env python3
"""
cleanup.py — Remove files and entries created by the code generator.

For fully overwritten files: deletes them entirely.
For appended files (lib/site-config.ts, app/[locale]/@sidebar/page.tsx):
removes only the generated entries, preserving manual content.

messages/*.json (en.json, ja.json, ...) are never touched by this script.
Their Fields/EntityLabel/Nav entries can carry human-translated content
(e.g. ja.json), and this script has no way to distinguish "entity genuinely
removed from the project" from "entity still in the schema, but this cleanup
run happens to also be tearing down an unrelated temp fixture" -- deleting by
current-schema-membership treated both cases the same and previously wiped
translations wholesale (cmd_560). See docs/knowledge/i18n-locale-routing.md.

Stubs (form_validation.ts, service_validation.ts) are deleted unless
--keep-stubs is passed, since they may contain user customizations.
service_after_create.ts is generated write-once; cleanup deletes it only
when the file still matches the original stub template output.

--prune-orphans sweeps files that are generator-shaped but no longer
expected by the current schema (e.g., a column_def.tsx left behind after
an entity's children were removed). The regular pass is schema-driven and
only knows about today's entities/gates, so prior-schema artefacts linger
without this mode.

<schema.yaml> must be the *built* schema (code_generator/.generated/json_schema.yaml,
produced by build_user_schema.py) -- the same one generate.py consumes during
`npm run generate-code`. The hand-authored code_generator/json_schema.yaml lacks
the '__'-prefixed raw entities that split synthesizes, so extract_entities()
finds nothing in it; `npm run cleanup` builds .generated/json_schema.yaml first
for this reason.

Usage (run from code_generator/):
    python cleanup.py <built-schema.yaml> <output-dir> [--keep-stubs] [--prune-orphans]

Examples:
    python cleanup.py .generated/json_schema.yaml .. --keep-stubs
    python cleanup.py .generated/json_schema.yaml .. --prune-orphans
"""
import json
import re
import sys
import time
from pathlib import Path

import yaml

from generate_types import extract_entities
from manifest import MANIFEST_FILENAME, sha256_file
from nav_config import build_nav_config, nav_list_entities

_SYSTEM_PROPS = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'}

# generate-code -> cleanup (wrong order) leaves every just-written file
# pristine (hash-matching), so it reads as safe-to-delete even though none
# of it was actually stale.
_MANIFEST_FRESH_THRESHOLD_S = 60

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

    manifest_age_s = time.time() - manifest_path.stat().st_mtime
    if manifest_age_s < _MANIFEST_FRESH_THRESHOLD_S:
        print(
            f'\nWARNING: {MANIFEST_FILENAME} was updated {manifest_age_s:.0f}s ago.\n'
            'Running cleanup immediately after generate-code will delete all just-generated '
            'files (they all hash-match, so they are all pristine-deletable).\n'
            'Correct order: cleanup -> generate-code (clean-slate), not generate-code -> cleanup.\n'
            'Continuing in 3 seconds -- Ctrl-C to abort.',
            file=sys.stderr,
        )
        time.sleep(3)

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
# Appended-file cleaners
# ---------------------------------------------------------------------------

def _clean_site_config(path: Path, nav_hrefs: list, nav_group_slugs: list) -> None:
    if not path.exists():
        return
    content = path.read_text(encoding='utf-8')
    original = content
    for href in nav_hrefs:
        # Matches: { label: "...", href: "/parent" },  or, when the entity is
        # nested under a nav group: { label: "...", href: "/parent", group: "slug", order: N },
        # (with leading whitespace / newline)
        content = re.sub(
            r'[ \t]*\{ label: "[^"]*", href: "' + re.escape(href)
            + r'"(?:, group: "[^"]*", order: -?\d+)? \},\n?',
            '',
            content,
        )
    for slug in nav_group_slugs:
        # Matches: { slug: "...", labelKey: "...", order: N[, icon: "..."][, parent: "..."] },
        content = re.sub(
            r'[ \t]*\{ slug: "' + re.escape(slug) + r'".*? \},\n?',
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

def _prune_orphans(out: Path, entities: list, keep_stubs: bool = False) -> None:
    """Sweep generator-shaped files that the current schema no longer expects.

    The regular cleanup pass is schema-driven: it walks `entities` from the
    current schema and deletes only files those entities would still
    produce. When a schema gate flips off (e.g., an entity loses its
    children list, or is renamed/removed entirely), the file generated
    under the old gate is invisible to that pass and lingers forever.

    Handles two orphan classes:

    - **Per-entity boilerplate** (lib/<entity>/ and components/<entity>/) for
      entities that have been removed from the schema entirely. Detected by the
      presence of generator-specific filenames (types.ts / getters.ts for lib,
      FormUpsert.tsx / FormView.tsx for components).

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

    # lib/<entity>/ — per-entity boilerplate for entities removed from the schema.
    # Identified by the presence of generator-specific filenames (types.ts or
    # getters.ts); system lib dirs (authz, prisma, normalize, etc.) don't carry
    # these names and are therefore skipped.
    lib_root = out / 'lib'
    if lib_root.is_dir():
        for lib_dir in sorted(d for d in lib_root.iterdir() if d.is_dir()):
            parent = lib_dir.name
            if entities_by_parent.get(parent) is not None:
                continue  # entity still in schema
            if not any((lib_dir / f).exists() for f in ('types.ts', 'getters.ts')):
                continue  # not an entity lib dir
            for fname in ('types.ts', 'getters.ts', 'actions.ts', 'service.ts', 'chart-getters.ts'):
                f = lib_dir / fname
                if not _is_protected(f):
                    _delete(f)
            if not keep_stubs:
                f = lib_dir / 'service_validation.ts'
                if not _is_protected(f):
                    _delete(f)
            sac = lib_dir / 'service_after_create.ts'
            if not _is_protected(sac):
                _delete_if_boilerplate(sac, _SERVICE_AFTER_CREATE_BOILERPLATE)
            _rmdir_tree(lib_dir)

    # components/<entity>/ — FormUpsert/FormView/form_validation for removed entities.
    # Identified by the presence of FormUpsert.tsx or FormView.tsx. column_def.tsx
    # is swept by the loop above; this pass covers the remaining per-entity component
    # boilerplate.
    if components_root.is_dir():
        for comp_dir in sorted(d for d in components_root.iterdir() if d.is_dir()):
            parent = comp_dir.name
            if entities_by_parent.get(parent) is not None:
                continue  # entity still in schema
            if not any((comp_dir / f).exists() for f in ('FormUpsert.tsx', 'FormView.tsx')):
                continue  # not an entity component dir
            for fname in ('FormUpsert.tsx', 'FormView.tsx'):
                f = comp_dir / fname
                if not _is_protected(f):
                    _delete(f)
            if not keep_stubs:
                f = comp_dir / 'form_validation.ts'
                if not _is_protected(f):
                    _delete(f)
            _rmdir_tree(comp_dir)


def cleanup(schema_path: str, output_dir: str, keep_stubs: bool = False, prune_orphans: bool = False) -> None:
    schema_path_obj = Path(schema_path)
    if not schema_path_obj.exists():
        print(
            f'ERROR: Schema not found at {schema_path}\n'
            'This script expects the built schema (code_generator/.generated/json_schema.yaml), '
            'the same file generate.py consumes. Run it via `npm run cleanup` / `npm run '
            'cleanup:all`, which build it automatically -- or, if invoking cleanup.py directly, '
            'run `python3 code_generator/build_user_schema.py code_generator/json_schema.yaml '
            'prisma/schema.prisma --out code_generator/.generated/json_schema.yaml` first.',
            file=sys.stderr,
        )
        sys.exit(1)

    with open(schema_path) as f:
        schema = yaml.safe_load(f)

    entities = extract_entities(schema)
    if not entities:
        print(
            f'ERROR: no entities found in {schema_path}.\n'
            "This is almost always a sign that a hand-authored schema (no '__'-prefixed "
            'raw entities) was passed instead of the built schema. Pass the output of '
            'build_user_schema.py (code_generator/.generated/json_schema.yaml) -- the '
            'same file generate.py consumes -- not the source json_schema.yaml. '
            "Refusing to run rather than silently cleaning up nothing.",
            file=sys.stderr,
        )
        sys.exit(1)

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
        _prune_orphans(out, entities, keep_stubs)

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
    _delete_if_generated(out / 'lib' / 'attachment' / 'bridge_actions.ts')
    _try_rmdir(out / 'lib' / 'attachment')

    _try_rmdir(out / 'docs' / 'generated')
    _try_rmdir(out / 'app' / '[locale]' / 'docs')


def _clean_appended_files(out: Path, entities: list, schema: dict) -> None:
    """Remove only the generator-injected ENTRIES from files that are appended on
    top of user-owned content: lib/site-config.ts and
    app/[locale]/@sidebar/page.tsx. These files are never deleted outright and are
    deliberately absent from the manifest, so this runs in both manifest and
    fallback modes.

    messages/*.json is deliberately NOT touched here. Unlike site-config.ts/
    sidebar (pure nav href/label pairs, always re-derivable byte-for-byte from
    the schema), messages/*.json Fields/EntityLabel/Nav entries carry
    human-translated content (e.g. ja.json). Deleting a key "because this
    schema's entities still need it" (the only signal available here — this
    function has no notion of "entity that used to exist" vs. "entity still in
    the schema, but the run happens to include a throwaway fixture too")
    previously deleted translations wholesale whenever cleanup ran against a
    schema that still listed real production entities alongside a temp
    fixture, and a subsequent generate-code re-added them as English
    placeholders — see docs/knowledge/i18n-locale-routing.md "cleanup.py must
    never delete messages/*.json entries" (cmd_560). generators_i18n.py's own
    `_update_json` already treats these files as append-only (never removes an
    existing key); cleanup.py now honors the same invariant by not touching
    them at all.
    """
    print('\nCleaning appended files...')

    # Must retract the same nav entries generate added — shared with
    # generators_i18n.py's own generate-side filter, see
    # nav_config.nav_list_entities (cmd_817).
    nav_entities = nav_list_entities(entities)
    nav_hrefs = [f'/{e["parent"]}' for e in nav_entities]

    # Nav groups clean by their own rules (independent of nav_entities' list
    # gate) — build_nav_config is intentionally re-run here rather than
    # threaded through from generate.py, mirroring how nav_entities itself is
    # recomputed locally rather than passed in.
    nav_group_slugs = [g['slug'] for g in build_nav_config(entities, schema)['groups']]

    _clean_site_config(out / 'lib' / 'site-config.ts', nav_hrefs, nav_group_slugs)
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
