"""
Regression test for ASVS V4.3.1 (app-generator#1277): the Prisma `include` a
generated getter sends stays shallow.

Why this is a generation-time property: every `include:` in a generated
getters_internal.ts is rendered by getters.ts.jinja2 from the schema
(`include_props_list`, `search_include_props_list`, `include_props_detail`).
No part of it is built from request input, so a caller cannot ask for deeper
nesting. What can grow is the generator itself: a change that follows
relations transitively would make every list and detail query pull an
unbounded relation graph. This test generates the dogfood schema and a fixture
that embeds relations, measures the deepest `include:` nesting of every
generated getter, and fails when it exceeds MAX_INCLUDE_DEPTH.

The deepest nesting today is 2 (a relation whose label reads one further
relation). MAX_INCLUDE_DEPTH leaves one level of headroom; raising it is a
deliberate decision, not a side effect.

Run:
    cd code_generator && python3 -m pytest tests/test_getter_include_depth_bounded.py -v
"""
from pathlib import Path
import re
import tempfile

from test_relation_joins_load_strategy import _run_dogfood_pipeline, _run_fixture_pipeline

MAX_INCLUDE_DEPTH = 3

_INCLUDE_OPEN = re.compile(r'\binclude:\s*$')


def include_depth(source: str) -> int:
    """Deepest nesting of `include: {` blocks in a piece of generated TypeScript."""
    open_includes = []  # brace depth at which each currently open include began
    brace = 0
    deepest = 0
    for index, char in enumerate(source):
        if char == '{':
            brace += 1
            if _INCLUDE_OPEN.search(source[max(0, index - 16):index]):
                open_includes.append(brace)
                deepest = max(deepest, len(open_includes))
        elif char == '}':
            if open_includes and open_includes[-1] == brace:
                open_includes.pop()
            brace -= 1
    return deepest


def _getter_depths(out: Path) -> dict:
    depths = {}
    for path in sorted((out / 'lib').rglob('getters*.ts')):
        depths[str(path.relative_to(out))] = include_depth(path.read_text())
    return depths


def test_include_depth_measures_nesting():
    """Negative control: the measurement must see nesting, or the bound below proves nothing."""
    assert include_depth('findMany({ where })') == 0
    assert include_depth('findMany({ include: { role: true } })') == 1
    assert include_depth('x({ include: { a: { include: { b: true } } } })') == 2
    assert include_depth('x({ include: { a: { include: { b: { include: { c: { include: { d: true } } } } } } } })') == 4
    # Sibling includes do not add up.
    assert include_depth('x({ include: { a: { include: { b: true } }, c: { include: { d: true } } } })') == 2


def test_dogfood_getters_keep_include_depth_bounded():
    with tempfile.TemporaryDirectory() as tmp:
        depths = _getter_depths(_run_dogfood_pipeline(Path(tmp)))
    assert depths, 'no generated getters found'
    assert any(depth >= 1 for depth in depths.values()), 'no generated getter embeds a relation; the check would be vacuous'
    too_deep = {name: depth for name, depth in depths.items() if depth > MAX_INCLUDE_DEPTH}
    assert not too_deep, f'generated getters nest `include:` deeper than {MAX_INCLUDE_DEPTH}: {too_deep}'


def test_fixture_getters_keep_include_depth_bounded():
    with tempfile.TemporaryDirectory() as tmp:
        depths = _getter_depths(_run_fixture_pipeline('decimal_gate', Path(tmp)))
    assert any(depth >= 1 for depth in depths.values()), 'fixture must embed a relation'
    too_deep = {name: depth for name, depth in depths.items() if depth > MAX_INCLUDE_DEPTH}
    assert not too_deep, f'generated getters nest `include:` deeper than {MAX_INCLUDE_DEPTH}: {too_deep}'
