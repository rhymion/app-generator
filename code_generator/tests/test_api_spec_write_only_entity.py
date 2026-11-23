"""
A write-only entity (x-generate list: false, view: false, api: true) has no
GET on its collection route or its item route: Next.js answers 405 there.
The generated API spec must not call either (7.0 regression: 6.1/6.2/7.1 hit
GET list and 7.4/7.10 re-read through GET detail). The only GET such an entity
has is /options; a test that has to re-read a row reads the database through
the `security:snapshot` task instead.
"""
import re

import pytest

from generate import _make_env
from generators_test import api_spec_context

_REQUEST = re.compile(r"cy\.request\(\{(.*?)\}\)\s*(?:\.then|\.its)", re.S)


def _render(**flags) -> str:
    schema = {
        "definitions": {
            "clinic": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "note": {"type": "string"},
                },
                "x-display": {"table": [{"name": {"primary": True}}]},
            },
            "clinic_detail": {"allOf": [{"$ref": "#/definitions/clinic"}]},
        },
    }
    cfg = {
        "list": True, "view": True, "new": True, "edit": True,
        "delete": True, "api": True, "test": True, "fields": None, **flags,
    }
    ctx = api_spec_context("clinic", [], schema, "clinic", "clinic_detail", cfg)
    return _make_env().get_template("test_api_spec.cy.ts.jinja2").render(**ctx)


def _get_urls(out: str) -> list[str]:
    """The url of every cy.request without a method (a GET)."""
    urls = []
    for body in _REQUEST.findall(out):
        if "method:" in body:
            continue
        m = re.search(r"url:\s*([^,\n]+)", body)
        assert m, body
        urls.append(m.group(1).strip())
    return urls


@pytest.mark.parametrize("edit", [False, True])
def test_write_only_entity_spec_only_gets_options(edit):
    out = _render(list=False, view=False, edit=edit)
    urls = _get_urls(out)
    assert urls, "the auth / permission tests still probe a GET route"
    assert all("/options" in u for u in urls), urls


def test_write_only_entity_spec_has_no_list_permission_test():
    out = _render(list=False, view=False)
    assert "7.1 returns 403 for GET list" not in out
    assert "operation=list " not in out
    # 6.1 / 6.2 still run, on the options route.
    assert "6.1 returns 401 without API key" in out
    assert "6.2 returns 401 with invalid API key" in out


def test_write_only_entity_spec_rereads_denied_writes_from_the_database():
    out = _render(list=False, view=False, edit=True)
    for title in (
        "7.3 returns 403 for PUT",
        "7.4 returns 403 for DELETE",
        "7.9 returns 403 for bulk PUT",
        "7.10 returns 403 for bulk DELETE",
    ):
        start = out.index(title)
        body = out[start:out.index("\n    it(", start)]
        assert "cy.task<any[]>('security:snapshot', { model: 'clinic'" in body, title
    # Successful deletes are verified gone in the database, not by a 405.
    assert out.count(".should('have.length', 0)") == 2  # 4.2 and 10.1
    assert "verified by GET" not in out


def test_full_crud_entity_spec_still_reads_through_the_api():
    out = _render()
    assert "security:snapshot" not in out
    assert "7.1 returns 403 for GET list when permission denied" in out
    assert "cy.request({ url: API_BASE, failOnStatusCode: false })" in out
    assert "4.2 deletes item, verified by GET returning 4xx" in out


def test_view_only_without_list_probes_auth_on_options_and_reads_detail():
    out = _render(list=False)
    assert "7.1 returns 403 for GET list" not in out
    assert "security:snapshot" not in out
    auth = out.split("describe('Authentication errors'")[1].split("describe(")[0]
    assert auth.count("url: `${API_BASE}/options`") == 2
    assert "url: API_BASE" not in auth
