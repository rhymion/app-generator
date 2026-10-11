"""audit_log is append-only (app-generator #945): the generated test teardown
must TRUNCATE it (a row trigger rejects DELETE) and the generated
anonymize_user must not issue any audit_log UPDATE (the trigger would fail the
whole erasure transaction)."""
from pathlib import Path

_TEMPLATES = Path(__file__).resolve().parent.parent / 'templates'


def test_db_helpers_template_truncates_append_only_tables() -> None:
    text = (_TEMPLATES / 'test_db_helpers.ts.jinja2').read_text(encoding='utf-8')
    assert 'TRUNCATE TABLE audit_log, audit_log_digest' in text
    assert "not in ('audit_log', 'audit_log_digest')" in text, 'the deleteMany loop must skip the append-only tables'


def test_anonymize_user_template_never_touches_audit_log_rows() -> None:
    text = (_TEMPLATES / 'anonymize_user.ts.jinja2').read_text(encoding='utf-8')
    assert 'audit_log.update' not in text
    assert 'audit_log.findMany' not in text
