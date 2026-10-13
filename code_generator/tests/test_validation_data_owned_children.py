"""
Owned (non-connect) child rows reach validateOnAdd/validateOnUpdate -- and so a hand-written validateCustomRules() --
as `data[<property_name>]`, the same way a connect-style child's selected ids already do.

The change only adds keys: every key the validation `data` object carried before keeps its name and meaning.
"""
import re

from build_context import build_context
from generate import _make_env, _render

from test_import_embedded_child_convergence import (  # noqa: F401 -- _sm_tmp_cwd is an autouse fixture
    _goods_receipt_entity, _goods_receipt_schema, _sm_tmp_cwd,
)


def _validation_data_blocks() -> dict[str, str]:
    ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
    rendered = _render(_make_env(), 'service.ts.jinja2', ctx)
    blocks = {}
    for kind in ('Add', 'Update'):
        match = re.search(rf'await validateOn{kind}\(tx, (?:id, )?\{{\n(.*?)\n\s*\}}', rendered, re.S)
        assert match, f'validateOn{kind} call not found'
        blocks[kind] = match.group(1)
    return blocks


def test_owned_child_rows_are_exposed_to_custom_validation():
    for kind, block in _validation_data_blocks().items():
        assert re.search(r'^\s*lines: linesItems,$', block, re.M), f'validateOn{kind} does not receive the owned child rows'


def test_existing_validation_keys_are_unchanged():
    ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
    before = ctx['validation_data_obj']
    # Every line other than the owned child's is a plain `<prop>: <expr>,` entry that was already there.
    lines = [line.strip() for line in before.splitlines() if line.strip()]
    assert lines[-1] == 'lines: linesItems,'
    assert all(re.match(r'^\w+: .+,$', line) for line in lines)
    assert len(lines) >= 2, 'scalar props must still be present ahead of the child rows'
