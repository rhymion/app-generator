"""Tests for cleanup.py — HANDWRITTEN_ALLOWLIST protection in prune_orphans."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import cleanup


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_generated_ts(path: Path, content: str = '') -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'// AUTO-GENERATED\n{content}')


# ---------------------------------------------------------------------------
# HANDWRITTEN_ALLOWLIST — prune_orphans must not delete protected paths
# ---------------------------------------------------------------------------

def test_prune_orphans_skips_allowlisted_file(tmp_path: Path) -> None:
    """A docs/generated file whose path is in HANDWRITTEN_ALLOWLIST is kept."""
    gen_docs = tmp_path / 'docs' / 'generated'
    gen_docs.mkdir(parents=True)
    protected = gen_docs / 'register.md'
    protected.write_text('# docs\n')

    patched_allowlist = frozenset(['docs/generated/register.md'])
    with patch.object(cleanup, 'HANDWRITTEN_ALLOWLIST', patched_allowlist):
        cleanup._prune_orphans(tmp_path, [])  # no entities → everything looks orphaned

    assert protected.exists(), 'Allowlisted file must not be deleted by prune_orphans'


def test_prune_orphans_skips_allowlisted_docs_page(tmp_path: Path) -> None:
    """An app/[locale]/docs page whose path is in HANDWRITTEN_ALLOWLIST is kept."""
    docs_root = tmp_path / 'app' / '[locale]' / 'docs' / 'layout'
    docs_root.mkdir(parents=True)
    protected = docs_root / 'page.mdx'
    protected.write_text('# layout docs\n')

    patched_allowlist = frozenset(['app/[locale]/docs/layout/page.mdx'])
    with patch.object(cleanup, 'HANDWRITTEN_ALLOWLIST', patched_allowlist):
        cleanup._prune_orphans(tmp_path, [])

    assert protected.exists(), 'Allowlisted docs page must not be deleted by prune_orphans'


# ---------------------------------------------------------------------------
# prune_orphans positive case — orphan generated files ARE deleted
# ---------------------------------------------------------------------------

def test_prune_orphans_deletes_orphan_generated_doc(tmp_path: Path) -> None:
    """docs/generated/<entity>.md for a removed entity is deleted."""
    gen_docs = tmp_path / 'docs' / 'generated'
    gen_docs.mkdir(parents=True)
    orphan = gen_docs / 'old_entity.md'
    orphan.write_text('# old\n')

    # 'old_entity' not in entities → orphan
    cleanup._prune_orphans(tmp_path, [])

    assert not orphan.exists(), 'Orphan generated doc must be deleted'


def test_prune_orphans_deletes_orphan_column_def(tmp_path: Path) -> None:
    """components/<entity>/column_def.tsx for a removed entity is deleted."""
    comp_dir = tmp_path / 'components' / 'old_widget'
    comp_dir.mkdir(parents=True)
    orphan = comp_dir / 'column_def.tsx'
    orphan.write_text('export const columns = [];\n')

    # 'old_widget' not in entities → orphan
    cleanup._prune_orphans(tmp_path, [])

    assert not orphan.exists(), 'Orphan column_def.tsx must be deleted'


# ---------------------------------------------------------------------------
# prune_orphans — orphan entity lib/ boilerplate (actions.ts / getters.ts / etc.)
# ---------------------------------------------------------------------------

def _make_orphan_entity(out: Path, entity: str) -> dict[str, Path]:
    """Create a full set of per-entity boilerplate files under out/ and return paths."""
    lib_dir = out / 'lib' / entity
    comp_dir = out / 'components' / entity
    lib_dir.mkdir(parents=True)
    comp_dir.mkdir(parents=True)
    files = {}
    for fname in ('types.ts', 'getters.ts', 'actions.ts', 'service.ts', 'chart-getters.ts',
                  'service_validation.ts'):
        p = lib_dir / fname
        p.write_text(f"'use server';\n// {fname}\n")
        files[fname] = p
    for fname in ('FormUpsert.tsx', 'FormView.tsx', 'form_validation.ts'):
        p = comp_dir / fname
        p.write_text(f"'use client';\n// {fname}\n")
        files[fname] = p
    return files


def test_prune_orphans_deletes_all_lib_boilerplate(tmp_path: Path) -> None:
    """All lib/<entity>/ boilerplate files are deleted for an orphaned entity."""
    files = _make_orphan_entity(tmp_path, 'booking')

    cleanup._prune_orphans(tmp_path, [])

    for fname in ('types.ts', 'getters.ts', 'actions.ts', 'service.ts', 'chart-getters.ts',
                  'service_validation.ts'):
        assert not files[fname].exists(), f'lib/booking/{fname} must be deleted for orphan entity'


def test_prune_orphans_deletes_all_component_boilerplate(tmp_path: Path) -> None:
    """All components/<entity>/ boilerplate files are deleted for an orphaned entity."""
    files = _make_orphan_entity(tmp_path, 'leave_request')

    cleanup._prune_orphans(tmp_path, [])

    for fname in ('FormUpsert.tsx', 'FormView.tsx', 'form_validation.ts'):
        assert not files[fname].exists(), f'components/leave_request/{fname} must be deleted for orphan entity'


def test_prune_orphans_keeps_in_schema_entity_lib(tmp_path: Path) -> None:
    """lib/<entity>/ boilerplate is NOT deleted when the entity is still in the schema."""
    files = _make_orphan_entity(tmp_path, 'project')
    entity = {'parent': 'project', 'model': 'project', 'generate_config': {}, 'children': []}

    cleanup._prune_orphans(tmp_path, [entity])

    for fname in ('types.ts', 'getters.ts', 'actions.ts', 'service.ts'):
        assert files[fname].exists(), f'lib/project/{fname} must be kept — entity still in schema'


def test_prune_orphans_keeps_customized_service_after_create(tmp_path: Path) -> None:
    """service_after_create.ts with user customizations is preserved even for an orphan entity."""
    lib_dir = tmp_path / 'lib' / 'booking'
    lib_dir.mkdir(parents=True)
    # Write a signal file so the dir is detected as an entity lib dir
    (lib_dir / 'types.ts').write_text("import type { Booking } from './booking';\n")
    # Write a customized (non-boilerplate) service_after_create.ts
    sac = lib_dir / 'service_after_create.ts'
    sac.write_text("import { sendEmail } from '@/lib/mailer';\nexport async function afterCreate() { await sendEmail(); }\n")

    cleanup._prune_orphans(tmp_path, [])

    assert sac.exists(), 'Customized service_after_create.ts must be preserved even for orphan entity'


def test_prune_orphans_keep_stubs_preserves_stubs(tmp_path: Path) -> None:
    """With keep_stubs=True, service_validation.ts and form_validation.ts are kept."""
    files = _make_orphan_entity(tmp_path, 'invoice')

    cleanup._prune_orphans(tmp_path, [], keep_stubs=True)

    assert files['service_validation.ts'].exists(), 'service_validation.ts kept with --keep-stubs'
    assert files['form_validation.ts'].exists(), 'form_validation.ts kept with --keep-stubs'
    # Fully regenerated files are still deleted
    assert not files['types.ts'].exists(), 'types.ts deleted even with --keep-stubs'
    assert not files['FormUpsert.tsx'].exists(), 'FormUpsert.tsx deleted even with --keep-stubs'
