"""
Tests for hand-written validation rejections that carry an i18n message key
(Issue #817).

A hand-written rule may attach an optional `messageKey` (namespace-qualified,
e.g. 'ValidationMessages.stepHasPlacements') and `messageArgs` to the AppError
it throws. The key travels on the Server Action's ActionFailure and in the
REST error body, and the generated FormUpsert translates it. Without a key the
emitted behavior is the existing fieldInvalid / fieldRequired mapping.

Run:
    cd code_generator && python3 -m pytest tests/test_validation_message_key.py -v
"""
import json
import re
from pathlib import Path

from build_context import build_context
from generators import form_upsert_context, actions_context
from validation_context import build_validation_context

from tests.test_validation_message_reason_and_context_filter import (
    _build_ctx,
    _make_env,
    _schema,
)

REPO_ROOT = Path(__file__).parent.parent.parent

# The exact return-line text before this feature. Every emitted catch block must
# still START with it; only the optional spread is appended.
OLD_RETURN_PREFIX = "return { ok: false, errorCode: e.code, field: e.field, reason: e.reason"
KEY_SPREAD = "messageKey: m.messageKey, messageArgs: m.messageArgs"


def _form_block() -> str:
    ctx = form_upsert_context(_build_ctx(), _schema())
    rendered = _make_env().get_template('use_entity_form.ts.jinja2').render(**{**_build_ctx(), **ctx})
    start = rendered.index('export function getEntityFormErrorMessage')
    end = rendered.index('\n}\n', start)
    return rendered[start:end]


class TestReturnLinesCarryOptionalKey:
    def test_server_action_catch_blocks_append_optional_key_spread(self):
        ctx = {**_build_ctx(), **actions_context(_build_ctx())}
        rendered = _make_env().get_template('actions.ts.jinja2').render(**ctx)
        lines = [ln for ln in rendered.splitlines() if 'satisfies ActionFailure' in ln and 'errorCode: e.code, field: e.field' in ln]
        assert lines, 'expected at least one AppError catch return line'
        for ln in lines:
            assert OLD_RETURN_PREFIX in ln
            assert KEY_SPREAD in ln
            # The key is read through a local cast, so an older write-once
            # lib/_errors.ts without the fields still compiles.
            assert 'messageKey?: string' in ln

    def test_return_lines_add_key_only_when_present(self):
        ctx = {**_build_ctx(), **actions_context(_build_ctx())}
        rendered = _make_env().get_template('actions.ts.jinja2').render(**ctx)
        assert '(m.messageKey ? {' in rendered
        assert ': {}))(e)' in rendered

    def test_submit_for_approval_return_line(self):
        text = (Path(__file__).parent.parent / 'templates' / 'submit_for_approval.ts.jinja2').read_text()
        assert OLD_RETURN_PREFIX in text
        assert KEY_SPREAD in text

    def test_custom_rule_retag_keeps_the_key(self):
        ctx = {**_build_ctx(), **build_validation_context(_build_ctx())}
        rendered = _make_env().get_template('service_validation.ts.jinja2').render(**ctx)
        assert "new AppError('VALIDATION', e.message, e.field, 'invalid')" in rendered
        assert 'Object.assign(retagged, { messageKey: m.messageKey, messageArgs: m.messageArgs })' in rendered


class TestFormUpsertKeyPath:
    def test_translated_path_emitted(self):
        block = _form_block()
        assert 'tmsg.has(messageKey)' in block
        assert 'return tmsg(messageKey, messageArgs)' in block

    def test_only_allowed_namespaces_are_translated(self):
        assert '/^(ValidationMessages|Errors)\\./.test(messageKey)' in _form_block()

    def test_fallback_path_is_the_existing_generic_text(self):
        block = _form_block()
        assert "err.reason === 'invalid' ? terr('fieldInvalid', { field: err.field }) : terr('fieldRequired', { field: err.field })" in block
        # The key branch returns before the fallback; the fallback never prints the key.
        assert block.index('tmsg.has(') < block.index("terr('fieldInvalid'")
        assert 'return messageKey' not in block

    def test_key_applies_to_validation_only(self):
        """NOT_FOUND / PERMISSION_DENIED stay masked: no key is read for them."""
        block = _form_block()
        assert block.count('tmsg.has(') == 1
        assert block.index("case 'NOT_FOUND':") < block.index("case 'VALIDATION'")
        assert "case 'NOT_FOUND':         return terr('notFound');" in block


class TestWriteOnceLibAndRestBody:
    def test_app_error_and_action_failure_have_optional_fields(self):
        text = (REPO_ROOT / 'lib' / '_errors.ts').read_text()
        assert 'public readonly messageKey?: string' in text
        assert 'public readonly messageArgs?: MessageArgs' in text
        assert 'messageKey?: string;' in text.split('export type ActionFailure')[1].split('export type ActionResult')[0]

    def test_rest_body_adds_key_only_when_present(self):
        text = (REPO_ROOT / 'lib' / 'api-auth.ts').read_text()
        assert '...(error.messageKey ? { messageKey: error.messageKey } : {})' in text
        assert '...(error.messageKey && error.messageArgs ? { messageArgs: error.messageArgs } : {})' in text


class TestConsumerNamespaceKeySets:
    """prj_sync deep-merges the consumer's messages. A key present in only one
    locale would fall back to the generic text for that locale only, so the
    key sets of the consumer namespace must match in en and ja."""

    @staticmethod
    def _keys(path: Path) -> set:
        data = json.loads(path.read_text())
        return set((data.get('ValidationMessages') or {}).keys())

    def test_validation_messages_key_sets_equal_in_en_and_ja(self):
        en = self._keys(REPO_ROOT / 'messages' / 'en.json')
        ja = self._keys(REPO_ROOT / 'messages' / 'ja.json')
        assert en == ja, f'ValidationMessages key sets differ: en-only={en - ja}, ja-only={ja - en}'
