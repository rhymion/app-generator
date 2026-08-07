"""Tests for cleanup.py — HANDWRITTEN_ALLOWLIST protection in prune_orphans,
and messages/*.json preservation (cmd_560)."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

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


# ---------------------------------------------------------------------------
# messages/*.json must never be modified by cleanup (cmd_560)
#
# `_clean_appended_files` used to delete every Fields/EntityLabel/Nav key
# belonging to any entity in the passed schema from messages/*.json —
# including entities still very much in production use, not just genuinely
# orphaned ones. Since `npm run cleanup` always builds its schema argument
# fresh from whatever `json_schema.yaml` currently says (see cleanup.py's own
# module docstring), a cleanup run performed while a temp fixture entity was
# still present in the schema (e.g. to remove that fixture's generated files
# before reverting the schema file) wiped every real entity's translated
# entries too. A subsequent `generate-code` then re-filled those now-missing
# keys with English schema defaults, since generators_i18n.py's own
# `_update_json` only fills genuinely *missing* keys and had no way to know
# they used to hold a real translation. Net effect: `messages/ja.json` went
# wholesale English. See docs/knowledge/i18n-locale-routing.md.
# ---------------------------------------------------------------------------

def test_clean_appended_files_never_touches_messages_json(tmp_path: Path) -> None:
    """A cleanup run against a schema that still lists a real, translated
    entity must leave messages/*.json byte-for-byte untouched."""
    messages_dir = tmp_path / 'messages'
    messages_dir.mkdir()
    ja_path = messages_dir / 'ja.json'
    ja_content = json.dumps(
        {'EntityLabel': {'widget': 'ウィジェット'}, 'Fields': {'name': '名前'}, 'Nav': {'widget': 'ウィジェット'}},
        ensure_ascii=False, indent=2,
    ) + '\n'
    ja_path.write_text(ja_content, encoding='utf-8')
    en_path = messages_dir / 'en.json'
    en_content = json.dumps(
        {'EntityLabel': {'widget': 'Widget'}, 'Fields': {'name': 'Name'}, 'Nav': {'widget': 'Widget'}},
        indent=2,
    ) + '\n'
    en_path.write_text(en_content, encoding='utf-8')

    # 'widget' is a real, currently-in-schema entity (not an orphan) — the
    # exact scenario that previously triggered wholesale deletion.
    entity = {
        'parent': 'widget', 'model': 'widget',
        'generate_config': {'list': True}, 'children': [],
    }

    cleanup._clean_appended_files(tmp_path, [entity])

    assert ja_path.read_text(encoding='utf-8') == ja_content, (
        'messages/ja.json must be byte-for-byte unchanged by cleanup — '
        'deleting entries here previously destroyed human translations'
    )
    assert en_path.read_text(encoding='utf-8') == en_content, (
        'messages/en.json must also be left untouched by cleanup'
    )


# ---------------------------------------------------------------------------
# cleanup() fail-fast on a missing (unbuilt) schema path
# ---------------------------------------------------------------------------

def test_cleanup_fails_fast_on_missing_schema(tmp_path: Path, capsys) -> None:
    """cleanup() exits with a clear error instead of a raw FileNotFoundError
    traceback when the built schema (.generated/json_schema.yaml) is absent."""
    missing_schema = tmp_path / 'does_not_exist.yaml'

    with pytest.raises(SystemExit) as exc_info:
        cleanup.cleanup(str(missing_schema), str(tmp_path))

    assert exc_info.value.code == 1
    err = capsys.readouterr().err
    assert 'Schema not found' in err
    assert str(missing_schema) in err


# ---------------------------------------------------------------------------
# _clean_from_manifest() — order guard against generate-code -> cleanup
# ---------------------------------------------------------------------------

def test_clean_from_manifest_warns_on_fresh_manifest(tmp_path: Path, capsys) -> None:
    """A manifest younger than the freshness threshold triggers a WARNING
    and a pause, but does not block the cleanup from proceeding."""
    manifest_path = tmp_path / cleanup.MANIFEST_FILENAME
    manifest_path.write_text(json.dumps({'files': []}))

    with patch.object(cleanup.time, 'sleep') as mock_sleep:
        result = cleanup._clean_from_manifest(tmp_path)

    assert result is True
    mock_sleep.assert_called_once_with(3)
    err = capsys.readouterr().err
    assert 'WARNING' in err
    assert cleanup.MANIFEST_FILENAME in err


def test_clean_from_manifest_no_warning_on_stale_manifest(tmp_path: Path, capsys) -> None:
    """A manifest older than the freshness threshold triggers no WARNING/pause."""
    manifest_path = tmp_path / cleanup.MANIFEST_FILENAME
    manifest_path.write_text(json.dumps({'files': []}))
    old_time = cleanup.time.time() - (cleanup._MANIFEST_FRESH_THRESHOLD_S + 10)
    import os
    os.utime(manifest_path, (old_time, old_time))

    with patch.object(cleanup.time, 'sleep') as mock_sleep:
        result = cleanup._clean_from_manifest(tmp_path)

    assert result is True
    mock_sleep.assert_not_called()
    err = capsys.readouterr().err
    assert 'WARNING' not in err
