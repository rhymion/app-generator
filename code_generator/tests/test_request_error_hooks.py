"""
Issue #1304 (ASVS V16.5.4): unhandled errors are recorded without the raw message and the client gets a
generic response.

- instrumentation.ts exports onRequestError for every app, with or without search indexes (register() is the
  only conditional part);
- the hook logs through lib/request-error.ts, which leaves out the message and stack;
- app/global-error.tsx exists and never renders the error message.

Run:
    python3 -m pytest code_generator/tests/test_request_error_hooks.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

REPO = Path(__file__).resolve().parents[2]
TEMPLATES = REPO / 'code_generator' / 'templates'


def _render(gin_index_entities):
    env = Environment(loader=FileSystemLoader(str(TEMPLATES)), trim_blocks=True, lstrip_blocks=True,
                      keep_trailing_newline=True)
    return env.get_template('instrumentation.ts.jinja2').render(gin_index_entities=gin_index_entities)


def test_on_request_error_is_exported_with_and_without_search_indexes():
    for entities in ([], [{'model': 'thing'}]):
        out = _render(entities)
        assert 'export async function onRequestError(' in out
        assert "import('@/lib/request-error')" in out


def test_register_is_rendered_only_with_search_indexes():
    assert 'export async function register(' not in _render([])
    assert 'export async function register(' in _render([{'model': 'thing'}])


def test_tracked_instrumentation_matches_the_template():
    assert (REPO / 'instrumentation.ts').read_text() == _render([{'model': 'thing'}])


def test_request_error_logger_leaves_out_message_and_stack():
    src = (REPO / 'lib' / 'request-error.ts').read_text()
    body = src[src.index('export function logRequestError'):]
    assert '.message' not in body and '.stack' not in body


def test_global_error_boundary_exists_and_never_renders_the_message():
    src = (REPO / 'app' / 'global-error.tsx').read_text()
    assert "'use client'" in src and '<html' in src and '<body' in src
    code = '\n'.join(line for line in src.splitlines() if not line.lstrip().startswith('//'))
    assert 'error.message' not in code
