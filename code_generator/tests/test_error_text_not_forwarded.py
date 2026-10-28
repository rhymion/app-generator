"""Regression test for Issues #1154 and #1166: generated routes must not
forward a caught exception's raw message to the client.

Covers the bulk route (per-item failures), the CSV-import commit path and the
Stripe webhook route stub. The register route and `anonymizeUser` are covered
by their vitest suites.
"""
import pathlib

from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = pathlib.Path(__file__).resolve().parents[1] / 'templates'


def _source(name: str) -> str:
    return (TEMPLATES_DIR / name).read_text()


def test_bulk_route_does_not_forward_raw_error_message():
    src = _source('api_bulk_route.ts.jinja2')
    assert 'err instanceof Error ? err.message : String(err)' not in src
    assert src.count('error: bulkErrorText(err)') == 2
    assert "if (err instanceof AppError || err instanceof ApiError) return err.message;" in src
    assert "return 'Internal error';" in src


def test_import_route_write_failure_is_generic():
    src = _source('api_import_route.ts.jinja2')
    assert "code: 'WRITE_FAILED', message: err instanceof Error" not in src
    assert "code: 'WRITE_FAILED', message: 'The row could not be written'" in src


def test_stripe_webhook_stub_does_not_echo_sdk_message():
    src = _source('stripe_webhook_route_stub.ts.jinja2')
    assert 'Webhook signature verification failed: ${' not in src
    assert "{ error: 'Webhook signature verification failed' }" in src


def test_anonymize_user_does_not_report_raw_error_text():
    src = _source('anonymize_user.ts.jinja2')
    assert 'errors.push(message)' not in src
    assert 'err instanceof Error ? err.message' not in src
    assert "errors.push('Anonymization failed')" in src
