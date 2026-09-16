"""
Regression tests for audit-log generator wiring.

Two surfaces are covered:

  1. `build_context.is_audited` — driven by `x-audit: true` on an entity's
     `_detail` (or base) definition. Default is False.

  2. The rendered `service.ts` — when `is_audited`, every mutating function
     must wrap its work in a `recordAuditEvent` call:
       - `add{Entity}` audits inside the existing $transaction
       - `update{Entity}` audits inside the existing $transaction
       - `delete{Entity}` audits each id inside its own $transaction
     cmd_923b: `delete{Entity}` is now wrapped in a $transaction either way
     (previously the unaudited variant used several independent
     `prisma.*` calls with no rollback relationship) -- see
     docs/knowledge/post-create-side-effect-hook.md for why (validateOnDelete/
     afterDelete must run in the same transaction as the write they guard).

The render is exercised end-to-end with Jinja2 so a template typo (mismatched
braces, missing variable) is caught here rather than at `demo:generate` time.
"""
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import service_context

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'


# ---------------------------------------------------------------------------
# Schema fixtures
# ---------------------------------------------------------------------------

def _id_prop() -> dict:
    return {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}


def _base_thing() -> dict:
    return {
        "type": "object",
        "required": ["id", "name"],
        "properties": {"id": _id_prop(), "name": {"type": "string"}},
    }


def _detail_thing(audited: bool) -> dict:
    detail: dict = {
        "x-generate": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False,
        },
        "allOf": [{"$ref": "#/definitions/thing"}],
    }
    if audited:
        detail["x-audit"] = True
    return detail


def _entity() -> dict:
    return {
        "parent": "thing",
        "model": "thing",
        "definition_key": "thing_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }


def _schema(audited: bool) -> dict:
    return {"definitions": {"thing": _base_thing(), "thing_detail": _detail_thing(audited)}}


# ---------------------------------------------------------------------------
# build_context.is_audited
# ---------------------------------------------------------------------------

def test_is_audited_defaults_false():
    ctx = build_context(_entity(), _schema(audited=False))
    assert ctx["is_audited"] is False


def test_is_audited_true_when_detail_has_xaudit():
    ctx = build_context(_entity(), _schema(audited=True))
    assert ctx["is_audited"] is True


def test_is_audited_true_when_base_has_xaudit():
    """x-audit on the base entity is honoured too (mirrors x-generate fallback)."""
    schema = _schema(audited=False)
    schema["definitions"]["thing"]["x-audit"] = True
    ctx = build_context(_entity(), schema)
    assert ctx["is_audited"] is True


def test_is_audited_only_true_value_counts():
    """Truthy-but-not-True (e.g. {}) does not enable auditing — protects against
    accidental enablement via empty config blocks."""
    schema = _schema(audited=False)
    schema["definitions"]["thing_detail"]["x-audit"] = {}
    ctx = build_context(_entity(), schema)
    assert ctx["is_audited"] is False


# ---------------------------------------------------------------------------
# Rendered service.ts
# ---------------------------------------------------------------------------

def _render_service(schema: dict) -> str:
    from helpers.naming import to_pascal_case, to_camel_case
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case

    ctx = build_context(_entity(), schema)
    svc = service_context(ctx, schema)
    merged = {**ctx, **svc}
    return env.get_template('service.ts.jinja2').render(**merged)


def test_audited_service_imports_recordAuditEvent():
    out = _render_service(_schema(audited=True))
    assert "from '@/lib/audit-log'" in out
    assert "recordAuditEvent" in out


def test_unaudited_service_does_not_import_audit_helper():
    out = _render_service(_schema(audited=False))
    assert "audit-log" not in out
    assert "recordAuditEvent" not in out


def test_audited_create_records_event_inside_transaction():
    out = _render_service(_schema(audited=True))
    # Look for the create block; the audit call must appear before the
    # transaction's return statement.
    assert "action: 'thing:create'" in out
    assert "target_id: created.id" in out


def test_audited_update_records_event_inside_transaction():
    out = _render_service(_schema(audited=True))
    assert "action: 'thing:update'" in out


def test_audited_delete_wraps_in_transaction_and_logs_each_id():
    out = _render_service(_schema(audited=True))
    # Signature changes when audited: actorId comes first, then ids.
    assert "delete{}".format("Thing") in out
    assert "actorId: string | null, ids: string[]" in out
    # Audit row per deleted id.
    assert "for (const id of ids)" in out
    assert "action: 'thing:delete'" in out


def test_unaudited_delete_keeps_original_signature():
    out = _render_service(_schema(audited=False))
    assert "deleteThing(ids: string[])" in out
    # cmd_923b: the unaudited variant is now ALSO wrapped in its own
    # transaction (previously several independent prisma.* calls with no
    # rollback relationship) so validateOnDelete/afterDelete run in-tx like
    # every other write path -- see docs/knowledge/post-create-side-effect-
    # hook.md. A per-id loop now exists here too, for afterDelete -- this no
    # longer distinguishes the unaudited variant from the audited one the
    # way it used to (that distinction is the recordAuditEvent call itself,
    # asserted by test_audited_delete_wraps_in_transaction_and_logs_each_id).
    assert "await prisma.$transaction(async (tx) => {" in out
    assert "for (const id of ids)" in out
    assert "await afterDelete(tx, id);" in out
    assert "action: 'thing:delete'" not in out


# ---------------------------------------------------------------------------
# Rendered API route templates
#
# Regression guard for the bug where api_detail_route / api_bulk_route always
# emitted `deleteX([id])` regardless of audit status. Audited services
# expose `deleteX(actorId, ids)` (2 args), so the 1-arg call broke
# `npm run build` and the DELETE cypress paths for every audited entity.
# ---------------------------------------------------------------------------

def _render_route(template: str, schema: dict) -> str:
    from helpers.naming import to_pascal_case, to_camel_case
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    ctx = build_context(_entity(), schema)
    return env.get_template(template).render(**ctx)


def test_audited_detail_route_passes_actor_id_to_delete():
    out = _render_route('api_detail_route.ts.jinja2', _schema(audited=True))
    assert "await deleteThing(actorId, [id]);" in out


def test_unaudited_detail_route_omits_actor_id_for_delete():
    out = _render_route('api_detail_route.ts.jinja2', _schema(audited=False))
    assert "await deleteThing([id]);" in out
    assert "deleteThing(actorId" not in out


def test_audited_bulk_route_passes_actor_id_to_delete():
    out = _render_route('api_bulk_route.ts.jinja2', _schema(audited=True))
    assert "await deleteThing(actorId, permitted.map((p) => p.id));" in out


def test_unaudited_bulk_route_omits_actor_id_for_delete():
    out = _render_route('api_bulk_route.ts.jinja2', _schema(audited=False))
    assert "await deleteThing(permitted.map((p) => p.id));" in out
    assert "deleteThing(actorId" not in out
