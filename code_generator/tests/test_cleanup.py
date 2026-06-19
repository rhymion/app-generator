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
