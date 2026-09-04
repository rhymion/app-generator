"""cmd_941 gate 1: an entity whose service_after_create.ts write-once stub
has been hand-edited (a real create-time side effect on another model) but
whose service_after_update.ts / service_after_delete.ts stub is still the
untouched, pristine generator render has no hook to mirror that side effect
on edit or delete — a silent one-way door. validate_write_once_stub_
asymmetry() catches the *file-level* signal only (never reads what the
create hook actually does — cmd_941's explicit "coarse is fine" ruling).

"Implemented" vs. "still stub" is determined the same way generate.py's
own _write_stub()/is_stale_stub() self-healing already does: a file's
content is "still stub" iff it matches some pristine render this generator
has ever produced for that path (manifest.record(..., mode='stub') during
this run, or a prior run's stub_history). Anything else is "implemented".
"""
from pathlib import Path

import pytest
from manifest import ManifestRecorder
from validate import SchemaValidationError, validate_write_once_stub_asymmetry

_PRISTINE_CREATE = 'export async function afterCreate() {}\n'
_PRISTINE_UPDATE = 'export async function afterUpdate() {}\n'
_PRISTINE_DELETE = 'export async function afterDelete() {}\n'
_IMPLEMENTED_CREATE = (
    'export async function afterCreate(tx, id) {\n'
    '  await tx.role.updateMany({ where: { organization_id: id }, data: {} });\n'
    '}\n'
)


def _manifest_with_pristine_renders(paths_and_contents: dict[Path, str]) -> ManifestRecorder:
    """A manifest as it would look right after generate.py's per-entity loop
    has called _write_stub() for each of these paths this run — i.e. every
    path's *pristine template render* is recorded in stub_history, exactly
    as _manifest.record(path, content, 'stub') does regardless of whether
    the on-disk file was actually overwritten (see _write_stub()'s
    docstring: recorded "whether or not we (re)write it")."""
    manifest = ManifestRecorder()
    for path, content in paths_and_contents.items():
        manifest.record(path, content, 'stub')
    return manifest


def _entry(tmp_path: Path, parent: str, can_edit: bool = True, can_delete: bool = True) -> dict:
    return {
        'parent': parent,
        'create_path': tmp_path / f'{parent}_create.ts',
        'update_path': tmp_path / f'{parent}_update.ts',
        'delete_path': tmp_path / f'{parent}_delete.ts',
        'can_edit': can_edit,
        'can_delete': can_delete,
    }


class TestAsymmetryRejected:
    def test_implemented_create_with_pristine_update_and_delete_is_rejected(self, tmp_path: Path) -> None:
        entry = _entry(tmp_path, 'organization')
        entry['create_path'].write_text(_IMPLEMENTED_CREATE, encoding='utf-8')
        entry['update_path'].write_text(_PRISTINE_UPDATE, encoding='utf-8')
        entry['delete_path'].write_text(_PRISTINE_DELETE, encoding='utf-8')
        manifest = _manifest_with_pristine_renders({
            entry['create_path']: _PRISTINE_CREATE,
            entry['update_path']: _PRISTINE_UPDATE,
            entry['delete_path']: _PRISTINE_DELETE,
        })

        with pytest.raises(SchemaValidationError) as exc_info:
            validate_write_once_stub_asymmetry([entry], manifest)

        message = str(exc_info.value)
        assert 'organization' in message
        assert 'service_after_update.ts' in message
        assert 'service_after_delete.ts' in message
        # The two-choice remediation (cmd_941's explicit requirement) must
        # be spelled out, not just "something is wrong".
        assert 'x-generate.edit' in message
        assert 'x-generate.delete' in message

    def test_error_names_only_the_still_stub_operation(self, tmp_path: Path) -> None:
        """update is implemented too (mirrors create) -- only delete should
        be flagged, proving this is per-operation, not all-or-nothing."""
        entry = _entry(tmp_path, 'organization')
        entry['create_path'].write_text(_IMPLEMENTED_CREATE, encoding='utf-8')
        entry['update_path'].write_text(_IMPLEMENTED_CREATE.replace('afterCreate', 'afterUpdate'), encoding='utf-8')
        entry['delete_path'].write_text(_PRISTINE_DELETE, encoding='utf-8')
        manifest = _manifest_with_pristine_renders({
            entry['create_path']: _PRISTINE_CREATE,
            entry['update_path']: _PRISTINE_UPDATE,
            entry['delete_path']: _PRISTINE_DELETE,
        })

        with pytest.raises(SchemaValidationError) as exc_info:
            validate_write_once_stub_asymmetry([entry], manifest)

        message = str(exc_info.value)
        assert 'organization: service_after_create.ts is implemented, but service_after_delete.ts' in message
        assert 'organization: service_after_create.ts is implemented, but service_after_update.ts' not in message


class TestAsymmetryAllowed:
    def test_all_pristine_passes(self, tmp_path: Path) -> None:
        """No entity has implemented anything -- nothing to check."""
        entry = _entry(tmp_path, 'organization')
        entry['create_path'].write_text(_PRISTINE_CREATE, encoding='utf-8')
        entry['update_path'].write_text(_PRISTINE_UPDATE, encoding='utf-8')
        entry['delete_path'].write_text(_PRISTINE_DELETE, encoding='utf-8')
        manifest = _manifest_with_pristine_renders({
            entry['create_path']: _PRISTINE_CREATE,
            entry['update_path']: _PRISTINE_UPDATE,
            entry['delete_path']: _PRISTINE_DELETE,
        })

        validate_write_once_stub_asymmetry([entry], manifest)  # must not raise

    def test_all_implemented_passes(self, tmp_path: Path) -> None:
        entry = _entry(tmp_path, 'organization')
        entry['create_path'].write_text(_IMPLEMENTED_CREATE, encoding='utf-8')
        entry['update_path'].write_text(_IMPLEMENTED_CREATE.replace('afterCreate', 'afterUpdate'), encoding='utf-8')
        entry['delete_path'].write_text(_IMPLEMENTED_CREATE.replace('afterCreate', 'afterDelete'), encoding='utf-8')
        manifest = _manifest_with_pristine_renders({
            entry['create_path']: _PRISTINE_CREATE,
            entry['update_path']: _PRISTINE_UPDATE,
            entry['delete_path']: _PRISTINE_DELETE,
        })

        validate_write_once_stub_asymmetry([entry], manifest)  # must not raise

    def test_disabled_edit_and_delete_exempt_the_entity(self, tmp_path: Path) -> None:
        """x-generate.edit/delete: false is one of the two documented ways
        out -- the gate must not fire for an entity that took it."""
        entry = _entry(tmp_path, 'organization', can_edit=False, can_delete=False)
        entry['create_path'].write_text(_IMPLEMENTED_CREATE, encoding='utf-8')
        entry['update_path'].write_text(_PRISTINE_UPDATE, encoding='utf-8')
        entry['delete_path'].write_text(_PRISTINE_DELETE, encoding='utf-8')
        manifest = _manifest_with_pristine_renders({
            entry['create_path']: _PRISTINE_CREATE,
            entry['update_path']: _PRISTINE_UPDATE,
            entry['delete_path']: _PRISTINE_DELETE,
        })

        validate_write_once_stub_asymmetry([entry], manifest)  # must not raise

    def test_pristine_create_is_never_flagged_regardless_of_counterparts(self, tmp_path: Path) -> None:
        """create itself is still the stub -- there is no side effect to
        mirror yet, so an also-pristine update/delete is not a violation."""
        entry = _entry(tmp_path, 'organization')
        entry['create_path'].write_text(_PRISTINE_CREATE, encoding='utf-8')
        entry['update_path'].write_text(_PRISTINE_UPDATE, encoding='utf-8')
        entry['delete_path'].write_text(_PRISTINE_DELETE, encoding='utf-8')
        manifest = _manifest_with_pristine_renders({
            entry['create_path']: _PRISTINE_CREATE,
            entry['update_path']: _PRISTINE_UPDATE,
            entry['delete_path']: _PRISTINE_DELETE,
        })

        validate_write_once_stub_asymmetry([entry], manifest)  # must not raise

    def test_multiple_entities_only_the_violating_one_is_named(self, tmp_path: Path) -> None:
        """A clean entity alongside a violating one must not itself appear
        in the error, and must not suppress the real violation."""
        clean = _entry(tmp_path, 'permission')
        clean['create_path'].write_text(_PRISTINE_CREATE, encoding='utf-8')
        clean['update_path'].write_text(_PRISTINE_UPDATE, encoding='utf-8')
        clean['delete_path'].write_text(_PRISTINE_DELETE, encoding='utf-8')

        violating = _entry(tmp_path, 'organization')
        violating['create_path'].write_text(_IMPLEMENTED_CREATE, encoding='utf-8')
        violating['update_path'].write_text(_PRISTINE_UPDATE, encoding='utf-8')
        violating['delete_path'].write_text(_PRISTINE_DELETE, encoding='utf-8')

        manifest = _manifest_with_pristine_renders({
            clean['create_path']: _PRISTINE_CREATE,
            clean['update_path']: _PRISTINE_UPDATE,
            clean['delete_path']: _PRISTINE_DELETE,
            violating['create_path']: _PRISTINE_CREATE,
            violating['update_path']: _PRISTINE_UPDATE,
            violating['delete_path']: _PRISTINE_DELETE,
        })

        with pytest.raises(SchemaValidationError) as exc_info:
            validate_write_once_stub_asymmetry([clean, violating], manifest)

        message = str(exc_info.value)
        assert 'organization' in message
        assert 'permission' not in message
