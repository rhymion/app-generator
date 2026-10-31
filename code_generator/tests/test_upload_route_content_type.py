"""
The generated upload route must check the uploaded file through
lib/_upload_validation.ts (declared MIME type AND file extension on the
allow-lists) and store the Content-Type derived from that check, never the
client-declared value.

Run:
    cd code_generator && python3 -m pytest tests/test_upload_route_content_type.py -v
"""
from pathlib import Path

import pytest

TEMPLATES = Path(__file__).resolve().parents[1] / 'templates'


@pytest.mark.parametrize('name', ['upload_route.ts.jinja2'])
def test_upload_route_validates_through_the_shared_policy(name):
    src = (TEMPLATES / name).read_text()
    assert "from '@/lib/_upload_validation'" in src
    assert 'checkUpload(file, loadUploadPolicy())' in src
    assert 'validTypes' not in src


@pytest.mark.parametrize('name', ['upload_route.ts.jinja2'])
def test_upload_route_never_stores_the_client_declared_content_type(name):
    src = (TEMPLATES / name).read_text()
    assert 'contentType: file.type' not in src
    assert 'storeUploadedFile(file, uploadCheck.contentType, userId)' in src


def test_upload_route_checks_the_size_before_the_body_is_parsed():
    src = (TEMPLATES / 'upload_route.ts.jinja2').read_text()
    assert 'readBodyWithLimit(request, maxSize + UPLOAD_MULTIPART_OVERHEAD_BYTES)' in src
    # The bounded read must come before the form is parsed; a bare request.formData() buffers any size.
    assert 'request.formData()' not in src
    assert src.index('readBodyWithLimit(request') < src.index('.formData()')
    assert 'status: 413' in src


def test_upload_route_checks_the_content_signature_after_the_allow_lists():
    src = (TEMPLATES / 'upload_route.ts.jinja2').read_text()
    assert 'matchesFileSignature(head, extensionOf(file.name))' in src
    assert src.index('checkUpload(file, loadUploadPolicy())') < src.index('matchesFileSignature(')
    assert src.index('matchesFileSignature(') < src.index('storeUploadedFile(')
