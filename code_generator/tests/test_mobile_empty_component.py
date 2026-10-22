"""
No generated mobile screen hands `null` to a FlatList `ListEmptyComponent`.

The React Native types shipped with Expo SDK 58 type the prop as `ReactElement | ComponentType | undefined`, so an
`Element | null` expression fails the generated app's `npm run typecheck` (TS2322). The real type check runs in
`npm run test:e2e:mobile:pw` (scripts/run_mobile_entity_playwright.sh, every mode); this test catches the same
mistake in the templates without building an app.

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_empty_component.py -v
"""
import re
from pathlib import Path

MOBILE_TEMPLATES = Path(__file__).resolve().parent.parent / 'templates' / 'mobile'

# `ListEmptyComponent=` up to the closing brace of its JSX expression (the expressions are short, one or two lines).
PROP = re.compile(r'ListEmptyComponent=\{(.*?)\}\s*(?:\n|$)', re.DOTALL)
NULL_BRANCH = re.compile(r'[:?]\s*null\b')


def test_list_empty_component_never_receives_null():
    offenders = []
    checked = 0
    for template in sorted(MOBILE_TEMPLATES.rglob('*.jinja2')):
        for match in PROP.finditer(template.read_text()):
            checked += 1
            if NULL_BRANCH.search(match.group(1)):
                offenders.append(str(template.relative_to(MOBILE_TEMPLATES)))
    assert checked >= 4, 'expected the list, search, audit log and relation picker templates to set ListEmptyComponent'
    assert not offenders, f'ListEmptyComponent must be a JSX element or undefined, never null: {offenders}'
