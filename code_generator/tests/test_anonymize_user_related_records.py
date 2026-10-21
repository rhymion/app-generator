"""anonymizeUser() erases the related records of the erased person (app-generator #1062)
and keeps the first erasure time on a repeated call."""
from pathlib import Path

import yaml

from build_context import build_anonymize_user_context
from generate import _make_env, _render

_ROOT = Path(__file__).resolve().parent.parent


def _render_anonymize(schema: dict, storage: str = 'vercel') -> str:
    ctx = build_anonymize_user_context(schema)
    ctx['storage'] = storage
    return _render(_make_env(), 'anonymize_user.ts.jinja2', ctx)


def _default_schema() -> dict:
    return yaml.safe_load((_ROOT / 'json_schema.yaml').read_text(encoding='utf-8'))


def test_related_records_are_erased_in_the_same_transaction() -> None:
    text = _render_anonymize(_default_schema())
    start = text.index('prisma.$transaction')
    tx_body = text[start:text.index('} catch (err)', start)]
    assert 'tx.mobile_session.updateMany' in tx_body and 'device_name: null' in tx_body
    assert 'tx.notification.deleteMany' in tx_body
    assert 'tx.idempotency_key.deleteMany' in tx_body
    assert 'tx.attachment.deleteMany' in tx_body


def test_first_erasure_time_is_kept() -> None:
    text = _render_anonymize(_default_schema())
    assert 'if (current.anonymized_at) anonymizedAt = current.anonymized_at;' in text
    assert 'invalidated_at: invalidatedAt,' in text


def test_stored_file_is_removed_after_commit_for_each_storage() -> None:
    vercel = _render_anonymize(_default_schema(), 'vercel')
    assert "from '@vercel/blob'" in vercel and 'unlink(target)' in vercel
    gcs = _render_anonymize(_default_schema(), 'gcs')
    assert "from '@google-cloud/storage'" in gcs and 'ignoreNotFound: true' in gcs
    assert vercel.index('removeStoredFile(avatar.path)') > vercel.index('} catch (err)', vercel.index('prisma.$transaction'))


def test_no_avatar_handling_when_image_id_is_not_scrubbed() -> None:
    schema = _default_schema()
    del schema['definitions']['user']['properties']['image_id']['x-pii']
    text = _render_anonymize(schema)
    assert 'tx.attachment' not in text and 'removeStoredFile' not in text
    assert 'tx.mobile_session.updateMany' in text
