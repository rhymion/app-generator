"""anonymizeUser() erases the related records of the erased person (app-generator #1062),
keeps the first erasure time on a repeated call, and builds a scrub that fits each column (app-generator #1060)."""
from pathlib import Path

import pytest
import yaml

from build_context import build_anonymize_user_context, set_prisma_models
from generate import _make_env, _render
from schema_deriver import parse_prisma_schema

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
    assert 'where: { user_id: userId, revoked_at: null }, data: { revoked_at: anonymizedAt }' in tx_body
    assert 'tx.notification.deleteMany' in tx_body
    assert 'tx.idempotency_key.deleteMany' in tx_body
    assert 'tx.attachment.deleteMany' in tx_body


def test_first_erasure_time_is_kept() -> None:
    text = _render_anonymize(_default_schema())
    assert 'if (current.anonymized_at) anonymizedAt = current.anonymized_at;' in text
    assert 'invalidated_at: invalidatedAt,' in text


def test_stored_file_is_removed_after_commit_through_the_shared_storage_module() -> None:
    # One storage module serves every backend, so the generated code no longer branches per storage.
    for storage in ('vercel', 'gcs'):
        text = _render_anonymize(_default_schema(), storage)
        assert "from '@/lib/attachment/storage'" in text
        assert 'await deleteStoredObject(storedKey);' in text
        assert "from '@vercel/blob'" not in text and "from '@google-cloud/storage'" not in text
        assert text.index('removeStoredFile(avatar.path)') > text.index('} catch (err)', text.index('prisma.$transaction'))


def test_no_avatar_handling_when_image_id_is_not_scrubbed() -> None:
    schema = _default_schema()
    del schema['definitions']['user']['properties']['image_id']['x-pii']
    text = _render_anonymize(schema)
    assert 'tx.attachment' not in text and 'removeStoredFile' not in text
    assert 'tx.mobile_session.updateMany' in text


@pytest.fixture
def prisma_user_model():
    """The parsed Prisma models, as generate.py registers them before it builds the context."""
    set_prisma_models(parse_prisma_schema(_ROOT.parent / 'prisma' / 'schema.prisma'))
    yield
    set_prisma_models({})


def _data_block(schema: dict) -> str:
    return build_anonymize_user_context(schema)['pii_data_block']


def _user_props(schema: dict) -> dict:
    return schema['definitions']['user']['properties']


def test_x_pii_none_is_left_untouched(prisma_user_model) -> None:
    schema = _default_schema()
    _user_props(schema)['email_notifications_enabled'] = {'x-pii': 'none'}
    _user_props(schema)['name']['x-pii'] = 'none'
    ctx = build_anonymize_user_context(schema)
    names = [f['name'] for f in ctx['pii_fields']]
    assert 'email_notifications_enabled' not in names and 'name' not in names
    assert 'email_notifications_enabled' not in ctx['pii_data_block']
    assert '          name:' not in ctx['pii_data_block']


def test_default_schema_scrub_is_unchanged(prisma_user_model) -> None:
    block = _data_block(_default_schema())
    assert "name: '[deleted]'," in block and 'email: placeholderEmail,' in block
    assert 'password: null,' in block and 'api_key: null,' in block
    assert 'mfa_enabled: false,' in block and 'image_id: null,' in block


def test_direct_on_a_nullable_non_string_column_is_scrubbed_with_null(prisma_user_model) -> None:
    schema = _default_schema()
    _user_props(schema)['api_key_expires_at'] = {'x-pii': 'direct'}
    block = _data_block(schema)
    assert 'api_key_expires_at: null,' in block and "api_key_expires_at: '[deleted]'" not in block


def test_direct_on_a_boolean_column_is_scrubbed_with_false(prisma_user_model) -> None:
    schema = _default_schema()
    _user_props(schema)['email_notifications_enabled'] = {'x-pii': 'direct'}
    assert 'email_notifications_enabled: false,' in _data_block(schema)


@pytest.mark.parametrize('prop, pii', [
    ('tenant_id', 'sensitive'),       # NOT NULL String: null does not fit, '[deleted]' only for direct
    ('tenant_id', 'indirect'),
    ('mfa_token_version', 'sensitive'),  # NOT NULL Int
    ('mfa_token_version', 'direct'),
])
def test_required_column_without_a_fitting_scrub_value_fails_generation(prisma_user_model, prop, pii) -> None:
    schema = _default_schema()
    _user_props(schema)[prop] = {'x-pii': pii}
    with pytest.raises(ValueError, match=rf'user\.{prop}.*cannot be scrubbed'):
        build_anonymize_user_context(schema)


def test_required_string_column_marked_direct_is_scrubbed_with_the_marker(prisma_user_model) -> None:
    schema = _default_schema()
    _user_props(schema)['tenant_id'] = {'x-pii': 'direct'}
    assert "tenant_id: '[deleted]'," in _data_block(schema)


def test_json_schema_alone_decides_when_no_prisma_model_is_registered() -> None:
    set_prisma_models({})
    schema = _default_schema()
    _user_props(schema)['born_on'] = {'type': 'string', 'format': 'date', 'x-pii': 'direct'}
    assert 'born_on: null,' in _data_block(schema)
    schema['definitions']['user']['required'].append('born_on')
    with pytest.raises(ValueError, match=r'user\.born_on.*not nullable'):
        build_anonymize_user_context(schema)


def _render_invalidate(template: str, **context) -> str:
    base = {
        'parent': 'widget', 'parent_pascal': 'Widget', 'parent_camel': 'widget', 'model': 'widget',
        'can_create': False, 'can_update': False, 'can_delete': False, 'can_list': False,
        'can_invalidate': True, 'invalidate_module': 'lib/compliance/handler',
        'invalidate_handler': 'eraseWidget', 'comment_actions_code': '', 'has_commentable': False,
        'should_filter_by_org': False, 'service_imports': None,
    }
    base.update(context)
    return _make_env().get_template(template).render(**base)


@pytest.mark.parametrize('module', ['lib/compliance/handler', ''])
def test_invalidate_server_action_throws_on_a_failure_result(module) -> None:
    out = _render_invalidate('actions.ts.jinja2', invalidate_module=module)
    call = 'eraseWidget(id)' if module else '_invalidateWidgetStub(id)'
    assert f'const _invalidateResult: unknown = await {call};' in out
    check = out.index('_invalidateResult as { success?: unknown }).success === false')
    assert out.index(call) < check < out.index("throw new AppError('UNKNOWN'", check) < out.index("revalidatePath('/[locale]/widget'")


@pytest.mark.parametrize('module', ['lib/compliance/handler', ''])
def test_invalidate_rest_route_answers_a_failure_result_with_an_error_status(module) -> None:
    out = _render_invalidate('invalidate_action_route.ts.jinja2', invalidate_module=module,
                             is_self_only=False, has_invalidate_guard=False)
    call = 'eraseWidget(id)' if module else 'invalidateWidget(id)'
    assert f'const result: unknown = await {call};' in out
    assert out.index('.success === false') < out.index('NextResponse.json(result, { status: 500 })') < out.index('NextResponse.json(result ?? { success: true })')


def _has_module_level_use_server(source: str) -> bool:
    """True when the file starts (after comments/blank lines) with a 'use server' directive."""
    for line in source.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('//'):
            continue
        return stripped.rstrip(';').strip('\'"') == 'use server'
    return False


def test_anonymize_user_module_is_not_a_server_action_module() -> None:
    """anonymizeUser() trusts the id it is given; the permission checks live in the invalidate
    wrapper and REST route. A module-level 'use server' would register it as a directly callable action."""
    assert not _has_module_level_use_server(_render_anonymize(_default_schema()))
    assert not _has_module_level_use_server((_ROOT / 'templates' / 'anonymize_user.ts.jinja2').read_text(encoding='utf-8'))
    assert not _has_module_level_use_server((_ROOT.parent / 'lib' / 'compliance' / 'anonymize_user.ts').read_text(encoding='utf-8'))
