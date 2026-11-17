"""The generated mobile client must refuse a non-https API base URL outside development (ASVS V12.2.1)."""
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parents[1] / 'templates' / 'mobile' / 'lib' / 'api-base.ts.jinja2'


def test_api_base_requires_https_outside_dev():
    text = TEMPLATE.read_text()
    assert "!BASE_URL.startsWith('https://') && !__DEV__" in text
    assert 'EXPO_PUBLIC_API_BASE_URL must be https:// in production' in text
