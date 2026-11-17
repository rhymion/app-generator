"""
docs/knowledge/security-asvs-coverage.md is a data table (Issue #1233): one row per in-scope OWASP ASVS 5.0.0
requirement. This test keeps it honest as rows are added or edited:

- every in-scope requirement appears exactly once (per-chapter counts are fixed by the standard);
- no cell is empty;
- a `gap` row links an Issue, a `framework` row names a source and a version;
- a repository path named in a row exists, so a renamed or deleted test cannot stay cited.

Run:
    python3 -m pytest code_generator/tests/test_asvs_coverage_table.py -v
"""
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DOC = REPO / 'docs' / 'knowledge' / 'security-asvs-coverage.md'

# Level 1 and 2 requirements per chapter of ASVS 5.0.0; V8 (authorization, with organization isolation) and V16
# (logging) are assessed up to Level 3 and so hold every requirement of the chapter.
EXPECTED_COUNTS = {
    'V1': 27, 'V2': 11, 'V3': 19, 'V4': 10, 'V5': 9, 'V6': 35, 'V7': 18, 'V8': 13, 'V9': 7,
    'V10': 29, 'V11': 14, 'V12': 9, 'V13': 13, 'V14': 9, 'V15': 13, 'V16': 17, 'V17': 7,
}
STATUSES = {'generator', 'framework', 'environment', 'n/a', 'gap'}
COLUMNS = ['id', 'level', 'status', 'covered_by', 'verified_by', 'gap_issue', 'source']
PATH_RE = re.compile(r'\b((?:cypress|lib|scripts|code_generator|components|app|docs|auth|proxy)[\w./\[\]-]*\.(?:tsx|ts|py|sh|md|yml|jinja2))')


def _rows():
    rows = []
    for line in DOC.read_text(encoding='utf-8').splitlines():
        if not re.match(r'\| V\d+\.\d+\.\d+ \|', line):
            continue
        cells = [c.strip() for c in line.strip().strip('|').split(' | ')]
        assert len(cells) == len(COLUMNS), line
        rows.append(dict(zip(COLUMNS, cells)))
    return rows


def test_every_requirement_appears_once_and_chapter_counts_match():
    rows = _rows()
    ids = [r['id'] for r in rows]
    assert len(ids) == len(set(ids)), sorted({i for i in ids if ids.count(i) > 1})
    counts = {}
    for i in ids:
        chapter = i.split('.')[0]
        counts[chapter] = counts.get(chapter, 0) + 1
    assert counts == EXPECTED_COUNTS


def test_no_empty_cell_and_known_status():
    for r in _rows():
        assert all(r[c] for c in COLUMNS), r['id']
        assert r['status'] in STATUSES, r['id']
        assert r['level'] in {'1', '2', '3'}, r['id']


def test_gap_rows_link_an_issue_and_framework_rows_name_source_and_version():
    for r in _rows():
        if r['status'] == 'gap':
            assert re.search(r'#\d+', r['gap_issue']), f"{r['id']}: gap row without an Issue"
        if r['status'] == 'framework':
            assert r['source'] != '-', f"{r['id']}: framework row without a source"
            assert re.search(r'\d+\.\d+\.\d+', r['source']), f"{r['id']}: framework row without a version"


def test_cited_repository_paths_exist():
    missing = []
    for r in _rows():
        for cell in (r['covered_by'], r['verified_by']):
            for path in PATH_RE.findall(cell):
                if not (REPO / path).exists():
                    missing.append((r['id'], path))
    assert not missing, missing
