"""
Regression test for Issue #1188.

The REST update routes of the self-only account view (a proxy of the `user`
model that exposes `password` and `mfa_enabled`, i.e. `setting`) used to hand
the submitted password and MFA flag straight to the service. The account
settings page asks for the current password (to change the password) and a
TOTP/recovery code (to turn MFA off); the routes now ask for the same proof
through confirmCredentialChange() and give the service the confirmed values.
"""
import pathlib
import re

import pytest
from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators_openapi import build_entity_openapi

TEMPLATES_DIR = pathlib.Path(__file__).resolve().parents[1] / 'templates'

_SECRET = {
    "type": ["string", "null"],
    "x-custom-component": {"target": ["upsert"]},
}


def _schema(*, self_only: bool = True, model: str = 'user', mfa: bool = True) -> dict:
    props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
        "email": {"type": "string"},
        "password": dict(_SECRET),
        "api_key": dict(_SECRET),
    }
    if mfa:
        props["mfa_enabled"] = {
            "type": "boolean",
            "default": False,
            "x-custom-component": {"target": ["upsert"]},
        }
    base: dict = {"type": "object", "required": ["id", "name"], "properties": props}
    if self_only:
        base["x-self-only"] = True
    return {
        "definitions": {
            model: base,
            "setting": {
                "x-generate": {"list": False, "view": True, "new": False, "edit": True,
                               "delete": False, "api": True, "test": False},
                "allOf": [{"$ref": f"#/definitions/{model}"}],
            },
        }
    }


def _ctx(**kw) -> dict:
    model = kw.get('model', 'user')
    entity = {
        "parent": "setting",
        "model": model,
        "definition_key": "setting",
        "children": [],
        "generate_config": {
            "list": False, "view": True, "new": False, "edit": True,
            "delete": False, "api": True, "test": False, "fields": None,
        },
    }
    return build_context(entity, _schema(**kw))


def _render(template: str, ctx: dict) -> str:
    from helpers.naming import to_pascal_case, to_camel_case
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), trim_blocks=True, lstrip_blocks=True)
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env.get_template(template).render(**ctx)


class TestContext:
    def test_enabled_for_the_self_only_user_view(self):
        ctx = _ctx()
        assert ctx['credential_confirmation'] is True
        args = ctx['service_args_for_update']
        assert '_credential.password' in args
        assert '_credential.mfaEnabled' in args
        assert "password ?? ''" not in args
        assert 'mfaEnabled,' not in args.replace('_credential.mfaEnabled', '')

    @pytest.mark.parametrize('kw', [
        {'self_only': False},
        {'mfa': False},
    ])
    def test_not_enabled_otherwise(self, kw):
        ctx = _ctx(**kw)
        assert ctx['credential_confirmation'] is False
        assert '_credential' not in ctx['service_args_for_update']

    def test_not_enabled_for_another_model(self):
        ctx = _ctx(model='account')
        assert ctx['credential_confirmation'] is False


class TestRoutes:
    def test_single_put_confirms_before_calling_the_service(self):
        out = _render('api_detail_route.ts.jinja2', _ctx())
        assert "import { confirmCredentialChange } from '@/lib/auth/credential-confirmation';" in out
        assert 'currentPassword: body.current_password' in out
        assert 'mfaCode: body.mfa_code' in out
        # Changing the email address needs the current password as well (Issue #1285).
        call = out[out.index('confirmCredentialChange(id'):out.index('await updateSetting(')]
        assert re.search(r'\bemail: email,', call), call
        assert out.index('confirmCredentialChange(id') < out.index('await updateSetting(')
        assert '_credential.password' in out

    def test_bulk_put_confirms_each_item(self):
        out = _render('api_bulk_route.ts.jinja2', _ctx())
        assert "import { confirmCredentialChange } from '@/lib/auth/credential-confirmation';" in out
        assert '.current_password' in out and '.mfa_code' in out
        assert out.index('confirmCredentialChange(id') < out.index('await updateSetting(')
        call = out[out.index('confirmCredentialChange(id'):out.index('await updateSetting(')]
        assert re.search(r'\bemail: email,', call), call

    def test_other_entities_get_no_confirmation(self):
        ctx = _ctx(self_only=False)
        for template in ('api_detail_route.ts.jinja2', 'api_bulk_route.ts.jinja2'):
            assert 'confirmCredentialChange' not in _render(template, ctx)


class TestOpenApi:
    def test_request_schema_documents_the_confirmation_inputs(self):
        ctx = _ctx()
        props = build_entity_openapi(ctx)['schemas']['SettingCreateRequest']['properties']
        assert props['current_password']['writeOnly'] is True
        assert props['mfa_code']['writeOnly'] is True

    def test_no_confirmation_inputs_without_the_guard(self):
        props = build_entity_openapi(_ctx(self_only=False))['schemas']['SettingCreateRequest']['properties']
        assert 'current_password' not in props
