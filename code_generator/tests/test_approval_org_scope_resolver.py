"""
resolve_approvable_target.ts.jinja2 must emit resolveApprovableOrganization(),
which approve/reject use to refuse an approver who is not a member of the
organization of the record behind the approval request.

An entity with an organization_id column is organization-scoped and the
resolver returns that column; an entity without one is reported as not scoped;
an unknown entity or a missing row yields null (the caller fails closed).
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'


def _render(entities):
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), trim_blocks=True, lstrip_blocks=True)
    return env.get_template('resolve_approvable_target.ts.jinja2').render(entities=entities)


def _branch(out: str, entity_type: str) -> str:
    start = out.index(f"if (entityType === '{entity_type}') {{", out.index('resolveApprovableOrganization('))
    return out[start:out.index('\n  }\n', start)]


def test_org_scoped_entity_returns_its_organization_id():
    out = _render([{'parent': 'leave_request', 'model': 'leave_request', 'org_scoped': True}])
    branch = _branch(out, 'leave_request')
    assert 'select: { organization_id: true }' in branch
    assert 'scoped: true, organizationId: row.organization_id' in branch
    assert 'null' in branch  # missing row -> null


def test_entity_without_organization_id_is_reported_not_scoped():
    out = _render([{'parent': 'note', 'model': 'note', 'org_scoped': False}])
    branch = _branch(out, 'note')
    assert 'organization_id' not in branch
    assert '{ scoped: false }' in branch


def test_proxy_view_queries_the_backing_model_by_view_key():
    out = _render([{'parent': 'open_leave', 'model': 'leave_request', 'org_scoped': True}])
    branch = _branch(out, 'open_leave')
    assert 'tx.leave_request.findFirst' in branch


def test_unknown_entity_falls_through_to_null():
    out = _render([{'parent': 'leave_request', 'model': 'leave_request', 'org_scoped': True}])
    body = out[out.index('export async function resolveApprovableOrganization'):out.index('export function resolveApprovableModel')]
    assert '\n  return null;\n}' in body


def test_empty_entity_list_still_emits_a_compilable_resolver():
    out = _render([])
    assert 'export async function resolveApprovableOrganization' in out
    assert '_tx: Tx' in out and '_entityType: string' in out and '_approvableId: string' in out
