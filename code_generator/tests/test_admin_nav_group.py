"""
The built-in administration entities share one sidebar group, declared in the
default schema through the same x-nav / x-nav-groups mechanism as business
entities (docs/knowledge/nested-nav-menu-design.md D11).

Each positive assertion has a negative control: the same pipeline run on the
default schema with the administration declarations stripped must produce the
flat links the group replaces, so these tests fail without the schema change.
"""
import copy
import json
from pathlib import Path

from ruamel.yaml import YAML

import cleanup
from build_user_schema import build_user_schema
from generate_types import extract_entities
from generators_i18n import _update_site_config, update_i18n_and_config
from nav_config import build_nav_config, nav_list_entities

_REPO_ROOT = Path(__file__).resolve().parent.parent
_PRISMA_SCHEMA_PATH = _REPO_ROOT.parent / 'prisma' / 'schema.prisma'

_ADMIN_ORDER = {
    'user': 10,
    'role': 20,
    'permission': 30,
    'organization': 40,
    'approval_flow': 50,
    'dashboard': 60,
    'app_setting': 70,
}

_BASELINE = '''export type NavLink = {
  label: string;
  href: string;
  external?: boolean;
  group?: string;
  order?: number;
};

export type NavGroup = {
  slug: string;
  labelKey: string;
  order: number;
  icon?: string;
  parent?: string;
};

export const siteConfig = {
  navLinks: [
    { label: "Home", href: "/", external: false },
    { label: "Audit Log", href: "/audit_log" },
  ] satisfies NavLink[],

  navGroups: [
  ] satisfies NavGroup[],
};
'''


def _build(tmp_path: Path, strip_admin_nav: bool = False) -> dict:
    yaml = YAML()
    yaml.preserve_quotes = True
    with (_REPO_ROOT / 'json_schema.yaml').open('r', encoding='utf-8') as f:
        user_schema = yaml.load(f)
    if strip_admin_nav:
        user_schema.pop('x-nav-groups', None)
        for key in _ADMIN_ORDER:
            user_schema['definitions'][key].pop('x-nav', None)
    in_path = tmp_path / 'json_schema.yaml'
    with in_path.open('w', encoding='utf-8') as f:
        yaml.dump(user_schema, f)
    out_path = tmp_path / '.generated' / 'json_schema.yaml'
    build_user_schema(in_path, _PRISMA_SCHEMA_PATH, out_path)
    return YAML(typ='safe').load(out_path.read_text(encoding='utf-8'))


def test_default_schema_groups_the_seven_administration_entities(tmp_path: Path) -> None:
    built = _build(tmp_path)
    entities = extract_entities(built)
    result = build_nav_config(entities, built)

    for model, order in _ADMIN_ORDER.items():
        assert result['entity_group'].get(model) == {'group': 'administration', 'order': order}, model
    assert [(g['slug'], g['order'], g.get('icon')) for g in result['groups']] == [
        ('administration', 900, 'Settings')
    ]


def test_negative_control_without_declarations_nothing_is_grouped(tmp_path: Path) -> None:
    built = _build(tmp_path, strip_admin_nav=True)
    result = build_nav_config(extract_entities(built), built)
    assert result['entity_group'] == {}
    assert result['groups'] == []


def test_consumer_schema_can_override_administration_placement(tmp_path: Path) -> None:
    built = _build(tmp_path)
    built = copy.deepcopy(built)
    built['definitions']['__role']['x-nav'] = {'parent': 'security', 'order': 5}
    built.setdefault('x-nav-groups', {})['security'] = {'order': 100}
    result = build_nav_config(extract_entities(built), built)
    assert result['entity_group']['role'] == {'group': 'security', 'order': 5}
    assert result['entity_group']['user']['group'] == 'administration'


def _generate_site_config(path: Path, built: dict) -> tuple[list, dict]:
    entities = extract_entities(built)
    nav_entities = nav_list_entities(entities)
    nav_config = build_nav_config(entities, built)
    _update_site_config(path, nav_entities, nav_config)
    return nav_entities, nav_config


def test_generate_cleanup_generate_is_byte_identical(tmp_path: Path) -> None:
    built = _build(tmp_path)
    path = tmp_path / 'site-config.ts'
    path.write_text(_BASELINE, encoding='utf-8')

    nav_entities, nav_config = _generate_site_config(path, built)
    first = path.read_text(encoding='utf-8')
    for model, order in _ADMIN_ORDER.items():
        assert f'href: "/{model}", group: "administration", order: {order}' in first, model
    assert 'slug: "administration"' in first
    assert '{ label: "Audit Log", href: "/audit_log" },' in first, 'audit_log stays a flat static row'

    cleanup._clean_site_config(
        path,
        [f'/{e["parent"]}' for e in nav_entities],
        [g['slug'] for g in nav_config['groups']],
    )
    assert path.read_text(encoding='utf-8') == _BASELINE, 'cleanup retracts every administration row and the group'

    _generate_site_config(path, built)
    assert path.read_text(encoding='utf-8') == first


def test_negative_control_flat_links_without_declarations(tmp_path: Path) -> None:
    built = _build(tmp_path, strip_admin_nav=True)
    path = tmp_path / 'site-config.ts'
    path.write_text(_BASELINE, encoding='utf-8')
    _generate_site_config(path, built)
    content = path.read_text(encoding='utf-8')
    assert 'administration' not in content
    assert '{ label: "User", href: "/user" },' in content


def test_group_label_seeded_without_overwriting_human_translation(tmp_path: Path) -> None:
    built = _build(tmp_path)
    out = tmp_path / 'app'
    messages = out / 'messages'
    messages.mkdir(parents=True)
    (messages / 'en.json').write_text(json.dumps({}), encoding='utf-8')
    (messages / 'ja.json').write_text(json.dumps({}), encoding='utf-8')
    site = out / 'lib'
    site.mkdir()
    (site / 'site-config.ts').write_text(_BASELINE, encoding='utf-8')

    entities = extract_entities(built)
    update_i18n_and_config(entities, built, out)
    ja = json.loads((messages / 'ja.json').read_text(encoding='utf-8'))
    assert ja['Nav']['groups']['administration'] == 'Administration'

    ja['Nav']['groups']['administration'] = '管理'
    (messages / 'ja.json').write_text(json.dumps(ja, ensure_ascii=False), encoding='utf-8')
    update_i18n_and_config(entities, built, out)
    ja_after = json.loads((messages / 'ja.json').read_text(encoding='utf-8'))
    assert ja_after['Nav']['groups']['administration'] == '管理'
