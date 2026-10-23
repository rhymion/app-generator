"""
Both generated upload routes (Vercel Blob and GCS) must check the uploaded
file through lib/_upload_validation.ts (declared MIME type AND file extension
on the allow-lists) and store the Content-Type derived from that check,
never the client-declared value.

Run:
    cd code_generator && python3 -m pytest tests/test_upload_route_content_type.py -v
"""
from pathlib import Path

import pytest

TEMPLATES = Path(__file__).resolve().parents[1] / 'templates'


@pytest.mark.parametrize('name', ['upload_route_vercel.ts.jinja2', 'upload_route_gcs.ts.jinja2'])
def test_upload_route_validates_through_the_shared_policy(name):
    src = (TEMPLATES / name).read_text()
    assert "from '@/lib/_upload_validation'" in src
    assert 'checkUpload(file, loadUploadPolicy())' in src
    assert 'validTypes' not in src


@pytest.mark.parametrize('name', ['upload_route_vercel.ts.jinja2', 'upload_route_gcs.ts.jinja2'])
def test_upload_route_never_stores_the_client_declared_content_type(name):
    src = (TEMPLATES / name).read_text()
    assert 'contentType: file.type' not in src
    assert 'contentType: uploadCheck.contentType' in src
