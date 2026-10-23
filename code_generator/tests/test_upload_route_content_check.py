"""Both upload route templates (Vercel Blob and GCS) must compare the file's
leading bytes with its declared type before anything is stored.

The check itself is unit-tested in lib/upload-content-check.test.ts; the
runtime behaviour of the Vercel route (local-disk fallback) is covered by
cypress/e2e/api/upload_content_check.cy.ts. This test pins the wiring that
neither covers for the GCS variant: the helper is imported, called, and
called before the storage write.
"""
from __future__ import annotations

from pathlib import Path

import pytest

_TEMPLATES = Path(__file__).resolve().parent.parent / 'templates'

# (template, first storage write that must come after the content check)
_CASES = [
    ('upload_route_gcs.ts.jinja2', 'gcsFile.save('),
    ('upload_route_vercel.ts.jinja2', 'await put('),
    ('upload_route_vercel.ts.jinja2', 'await writeFile('),
]


@pytest.mark.parametrize('template, write', _CASES)
def test_content_is_checked_before_the_storage_write(template: str, write: str) -> None:
    text = (_TEMPLATES / template).read_text(encoding='utf-8')
    assert "from '@/lib/upload-content-check'" in text
    check = text.index('uploadContentMatchesDeclaredType(file)')
    assert check < text.index(write)


@pytest.mark.parametrize('template', sorted({t for t, _ in _CASES}))
def test_a_mismatch_is_answered_with_400(template: str) -> None:
    text = (_TEMPLATES / template).read_text(encoding='utf-8')
    after_check = text[text.index('uploadContentMatchesDeclaredType(file)'):]
    assert "status: 400" in after_check.split('}\n', 1)[0]
