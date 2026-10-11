"""x-version-of: key registration, fail-closed validation, and the rendered
version helpers / dispatch hooks (see version_of.py)."""
import copy
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from generate import _make_env, _render
from validate import SchemaValidationError, validate_version_of_prisma
from schema_deriver import parse_prisma_schema
from version_of import version_of_prefill_plan, version_of_entities, version_of_errors, version_of_for, version_of_identity_for

PRISMA_OK = """
model product {
  id                 String @id @default(cuid())
  current_version_id String?
  current_version    product_version? @relation("ProductCurrent", fields: [current_version_id], references: [id])
  versions           product_version[] @relation("ProductVersions")
}

model product_version {
  id         String  @id @default(cuid())
  product_id String
  product    product @relation("ProductVersions", fields: [product_id], references: [id])
  version_no Int?
  @@unique([product_id, version_no])
}
"""


def _schema() -> dict:
    return {'definitions': {
        '__product': {'type': 'object', 'properties': {'name': {'type': 'string'}}},
        '__product_version': {
            'type': 'object',
            'properties': {'version_no': {'type': ['integer', 'null']}},
            'x-approval': {'submit_on': {'status': 'pending'}, 'on_approved': {'set_fields': {'status': 'approved'}}},
            'x-version-of': {'identity': 'product', 'number': 'version_no'},
        },
        'product': {}, 'product_version': {},
    }}


def _mutated(fn) -> dict:
    s = copy.deepcopy(_schema())
    fn(s['definitions'])
    return s


def _vo(defs):
    return defs['__product_version']['x-version-of']


def test_valid_declaration_has_no_errors_and_resolves():
    assert version_of_errors(_schema()) == []
    assert version_of_for('product_version', _schema()) == {
        'version': 'product_version', 'identity': 'product',
        'number': 'version_no', 'identity_fk': 'product_id', 'identity_invalidatable': False,
    }
    assert version_of_for('product', _schema()) is None


def test_schema_without_the_key_is_untouched():
    s = _schema()
    del s['definitions']['__product_version']['x-version-of']
    assert version_of_errors(s) == [] and version_of_entities(s) == []


@pytest.mark.parametrize('mutate, needle', [
    (lambda d: d['__product_version'].update({'x-version-of': 'product'}), 'must be a mapping'),
    (lambda d: _vo(d).update({'extra': 1}), 'unknown sub-key'),
    (lambda d: _vo(d).pop('number'), '.number is required'),
    (lambda d: _vo(d).pop('identity'), '.identity is required'),
    (lambda d: _vo(d).update({'identity': 'ghost'}), "unknown entity 'ghost'"),
    (lambda d: _vo(d).update({'identity': 'product_version'}), 'must not be the version entity itself'),
    (lambda d: _vo(d).update({'number': 'missing'}), 'not a property'),
    (lambda d: d['__product_version']['properties'].update({'version_no': {'type': 'string'}}), 'must be an integer'),
    (lambda d: d['__product_version'].update({'required': ['version_no']}), 'must not be required'),
    (lambda d: d['__product_version'].pop('x-approval'), 'declare x-approval'),
    (lambda d: d['__product_version']['x-approval'].pop('on_approved'), 'x-approval.on_approved'),
])
def test_structural_errors_fail_closed(mutate, needle):
    errors = version_of_errors(_mutated(mutate))
    assert any(needle in e for e in errors), errors


def test_chain_and_duplicate_identity_are_rejected():
    def chain(d):
        d['__product'] = {'properties': {'n': {'type': ['integer', 'null']}},
                          'x-approval': {'on_approved': {}},
                          'x-version-of': {'identity': 'product_version', 'number': 'n'}}
    assert any('chains are not supported' in e for e in version_of_errors(_mutated(chain)))

    def dup(d):
        d['__other_version'] = copy.deepcopy(d['__product_version'])
        d['other_version'] = {}
    assert any('one version entity per identity' in e for e in version_of_errors(_mutated(dup)))


def _prisma(tmp_path, text):
    p = tmp_path / 'schema.prisma'
    p.write_text(text)
    return p


def test_prisma_prerequisites_pass(tmp_path):
    validate_version_of_prisma(_schema(), _prisma(tmp_path, PRISMA_OK))


@pytest.mark.parametrize('old, new, needle', [
    ('  version_no Int?\n', '  version_no Int\n', "version_no  Int?"),
    ('  @@unique([product_id, version_no])\n', '', '@@unique([product_id, version_no])'),
    ('  product_id String\n', '', "identity FK column 'product_id'"),
    ('  current_version_id String?\n', '', 'current_version_id  String?'),
    ('fields: [current_version_id], references: [id]', 'references: [id]', '@relation(fields: [current_version_id]'),
])
def test_prisma_prerequisites_fail_closed(tmp_path, old, new, needle):
    text = PRISMA_OK.replace(old, new)
    assert text != PRISMA_OK
    with pytest.raises(SchemaValidationError, match='x-version-of validation failed') as exc:
        validate_version_of_prisma(_schema(), _prisma(tmp_path, text))
    assert needle in str(exc.value)


def test_prisma_check_is_skipped_without_the_key(tmp_path):
    s = _schema()
    del s['definitions']['__product_version']['x-version-of']
    validate_version_of_prisma(s, tmp_path / 'does-not-exist.prisma')


def test_key_is_registered_for_both_schema_builders():
    import build_user_schema
    import convert_to_user_schema
    assert 'x-version-of' in build_user_schema._ENTITY_LEVEL_DATA_KEYS
    assert 'x-version-of' in convert_to_user_schema._ENTITY_LEVEL_DATA_KEYS


def _ctx(**over):
    return {**version_of_for('product_version', _schema()), 'children': [], **over}


def test_helper_module_renders_all_three_functions():
    out = _render(_make_env(), 'version_of.ts.jinja2', _ctx(children=[{'model': 'coverage', 'fk': 'product_version_id'}]))
    assert 'export async function assertSingleOpenDraft' in out
    assert '...(selfId ? { id: { not: selfId } } : {})' in out
    assert 'approved_at: null' in out
    assert 'export async function assignVersionNumber' in out
    assert 'data: { current_version_id: versionId }' in out
    assert 'export async function deleteVersionDraft' in out
    assert 'tx.coverage.deleteMany({ where: { product_version_id: versionId } })' in out
    # an approved version (it holds a number) is never deleted
    assert 'row.version_no != null) return;' in out


def test_dispatch_templates_call_the_helpers_only_for_version_entities():
    env, vo = _make_env(), version_of_for('product_version', _schema())
    base = {'snake_name': 'product_version', 'pascal_name': 'ProductVersion', 'set_fields': {},
            'emit_hook': False, 'exclusive_check': False, 'version_of': vo}
    approved = _render(env, 'on_approved_dispatch.ts.jinja2', {'approvable_entities': [base]})
    assert "ProductVersionAssignVersionNumber(tx, entity.id)" in approved
    plain = _render(env, 'on_approved_dispatch.ts.jinja2',
                    {'approvable_entities': [{**base, 'version_of': None}]})
    assert 'AssignVersionNumber' not in plain

    rej = {**base, 'terminal': True}
    rejected = _render(env, 'on_rejected_dispatch.ts.jinja2', {
        'rejectable_entities': [rej], 'rejected_body_needed': True, 'rejected_hook_needed': False})
    assert 'ProductVersionDeleteVersionDraft(tx, entity.id)' in rejected
    soft = _render(env, 'on_rejected_dispatch.ts.jinja2', {
        'rejectable_entities': [{**rej, 'terminal': False}], 'rejected_body_needed': False,
        'rejected_hook_needed': False})
    assert 'DeleteVersionDraft' not in soft  # a non-terminal rejection keeps the open draft

    withdrawn = _render(env, 'on_withdrawn_dispatch.ts.jinja2', {
        'withdrawable_entities': [base], 'withdrawn_body_needed': True})
    assert 'ProductVersionDeleteVersionDraft(tx, entity.id)' in withdrawn


PRISMA_COPY = PRISMA_OK.replace(
    "  version_no Int?\n",
    "  version_no Int?\n  title String\n  status String @default(\"draft\")\n  slug String? @unique\n"
    "  meta Json?\n  creator_id String\n  updater_id String\n  approvable_id String @unique\n"
    "  created_at DateTime @default(now())\n  coverages coverage[]\n",
) + """
model coverage {
  id                 String @id @default(cuid())
  product_version_id String
  product_version    product_version @relation(fields: [product_version_id], references: [id])
  label              String
  created_at         DateTime @default(now())
}
"""


def _plan(tmp_path):
    f = tmp_path / 'schema.prisma'
    f.write_text(PRISMA_COPY)
    s = _schema()
    s['definitions']['__coverage'] = {'type': 'object', 'properties': {'label': {'type': 'string'}}}
    s['definitions']['coverage'] = {'allOf': [{'$ref': '#/definitions/__coverage'}]}
    s['definitions']['product_version'] = {'allOf': [
        {'$ref': '#/definitions/__product_version'},
        {'type': 'object', 'properties': {'coverages': {
            'type': 'array', 'items': {'$ref': '#/definitions/coverage'}, 'x-parent-fk': ['product_version_id']}}},
    ]}
    return s, version_of_prefill_plan(version_of_for('product_version', s), s, parse_prisma_schema(f))


def test_prefill_plan_resets_number_submit_field_unique_and_system_columns(tmp_path):
    _, plan = _plan(tmp_path)
    reset = {r['key'] for r in plan['resets']}
    # restart: ids/timestamps/audit/bridge, the number, the submit field, the unique slug
    assert {'id', 'created_at', 'creator_id', 'updater_id', 'approvable_id', 'version_no', 'status', 'slug'} <= reset
    # carried over: the identity FK and plain columns
    assert not reset & {'product_id', 'title', 'meta'}


def test_prefill_plan_carries_dependent_children_and_leaves_own_screen_children_empty(tmp_path):
    s, plan = _plan(tmp_path)
    assert [(c['prop'], c['model']) for c in plan['children']] == [('coverages', 'coverage')]
    # a child with its own screens (new/edit/delete not all disabled) is not prefilled
    s['definitions']['coverage']['x-generate'] = {'list': True}
    from version_of import version_of_dependent_children
    dependent, empty = version_of_dependent_children('product_version', s)
    assert dependent == [] and empty == ['coverages']


def test_prefill_module_renders_without_a_created_record(tmp_path):
    _, plan = _plan(tmp_path)
    vo = version_of_for('product_version', _schema())
    out = _render(_make_env(), 'version_of_prefill.ts.jinja2', {**vo, 'pascal': 'ProductVersion', 'plan': plan})
    assert 'export async function getNewVersionPrefill' in out
    assert "['version_no', null]" in out and "prop: 'coverages'" in out
    assert 'create(' not in out and 'createMany' not in out
    assert 'await assertSingleOpenDraft(prisma, identityId, null);' in out
    assert "reason: 'open_draft'" in out


def test_owned_children_are_read_from_the_view_definition():
    """A child array lives under the bare view's allOf, not on the '__' raw entity."""
    from version_of import version_of_children
    s = _schema()
    s['definitions']['__coverage'] = {'type': 'object', 'properties': {'label': {'type': 'string'}}}
    s['definitions']['coverage'] = {'allOf': [{'$ref': '#/definitions/__coverage'}]}
    s['definitions']['product_version'] = {'allOf': [
        {'$ref': '#/definitions/__product_version'},
        {'type': 'object', 'properties': {'coverages': {
            'type': 'array', 'items': {'$ref': '#/definitions/coverage'}, 'x-parent-fk': ['product_version_id']}}},
    ]}
    owned, problems = version_of_children('product_version', s)
    assert problems == []
    assert owned == [{'model': 'coverage', 'fk': 'product_version_id'}]


def test_prefill_plan_carries_one_to_one_record_holding_the_version_fk(tmp_path):
    prisma = PRISMA_COPY.replace("  coverages coverage[]\n", "  coverages coverage[]\n  badge badge?\n") + """
model badge {
  id                 String @id @default(cuid())
  product_version_id String @unique
  product_version    product_version @relation(fields: [product_version_id], references: [id])
  code               String @unique
  label              String
}
"""
    f = tmp_path / 'schema.prisma'
    f.write_text(prisma)
    plan = version_of_prefill_plan(version_of_for('product_version', _schema()), _schema(), parse_prisma_schema(f))
    (holder,) = plan['holders']
    assert holder['prop'] == 'badge'
    resets = {r['key'] for r in holder['resets']}
    # the id, the version FK and the unique code restart; the label is an initial value
    assert {'id', 'product_version_id', 'code'} <= resets and 'label' not in resets


def _invalidatable_schema() -> dict:
    s = copy.deepcopy(_schema())
    s['definitions']['__product']['x-generate'] = {'invalidate': True}
    return s


def test_identity_is_found_and_flags_invalidation():
    assert version_of_identity_for('product', _schema())['version'] == 'product_version'
    assert version_of_identity_for('product_version', _schema()) is None
    assert version_of_for('product_version', _invalidatable_schema())['identity_invalidatable'] is True


def test_identity_delete_guard_renders_always_and_active_guard_only_when_invalidatable():
    plain = _render(_make_env(), 'version_of.ts.jinja2', _ctx())
    assert 'export async function assertIdentityDeletable' in plain
    assert 'version_no: { not: null }' in plain
    assert 'assertIdentityActive' not in plain
    vo = version_of_for('product_version', _invalidatable_schema())
    inv = _render(_make_env(), 'version_of.ts.jinja2', {**_ctx(), **vo})
    assert 'export async function assertIdentityActive' in inv


def test_invalidatable_identity_needs_invalidated_at_column(tmp_path):
    s = _invalidatable_schema()
    with pytest.raises(SchemaValidationError) as exc:
        validate_version_of_prisma(s, _prisma(tmp_path, PRISMA_OK))
    assert 'invalidated_at  DateTime?' in str(exc.value)
    ok = PRISMA_OK.replace('  current_version_id String?\n', '  current_version_id String?\n  invalidated_at DateTime?\n')
    validate_version_of_prisma(s, _prisma(tmp_path, ok))


# --- standard version list + two-version diff -------------------------------

def _identity_ctx(xcc=None):
    from build_context import build_context
    props = {'id': {'type': 'string'}, 'name': {'type': 'string'}}
    detail = {'type': 'object', 'required': ['id'], 'properties': props}
    if xcc is not None:
        detail['x-custom-components'] = xcc
    schema = {'definitions': {
        'thing': detail,
        '__thing_version': {'x-version-of': {'identity': 'thing', 'number': 'version_no'}},
        'thing_version': {},
    }}
    entity = {'parent': 'thing', 'model': 'thing', 'definition_key': 'thing', 'children': [],
              'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True,
                                  'delete': True, 'api': False, 'test': False, 'fields': None}}
    return build_context(entity, schema)


def test_identity_gets_version_history_unless_the_author_declared_components():
    assert [c['name'] for c in _identity_ctx()['entity_view_components']] == ['VersionHistory']
    # an explicit list (even empty) is the author's choice and is left alone
    assert _identity_ctx([])['entity_view_components'] == []
    own = _identity_ctx([{'name': 'Mine', 'path': '@/c/mine', 'target': ['view']}])
    assert [c['name'] for c in own['entity_view_components']] == ['Mine']


def test_version_entity_context_carries_the_declaration():
    from build_context import build_context
    entity = {'parent': 'product_version', 'model': 'product_version', 'definition_key': 'product_version',
              'children': [], 'generate_config': {'list': True, 'view': True, 'new': True, 'edit': True,
                                                  'delete': True, 'api': False, 'test': False, 'fields': None}}
    schema = _schema()
    schema['definitions']['product_version'] = {'type': 'object', 'required': ['id'],
                                                'properties': {'id': {'type': 'string'}}}
    assert build_context(entity, schema)['version_of']['identity'] == 'product'


def test_version_i18n_section_follows_the_identity_injection():
    from generators_i18n import _collect_custom_component_sections
    entities = [{'definition_key': 'product'}, {'definition_key': 'other'}]
    sections = _collect_custom_component_sections(entities, _schema())
    assert 'compareWithCurrent' in sections['VersionHistory']
    assert _collect_custom_component_sections([{'definition_key': 'other'}], _schema()) == {}


def test_version_diff_children_match_by_key_then_order_then_not_at_all():
    from version_of import version_diff_children
    schema = _schema()
    defs = schema['definitions']
    import version_of as vo
    owned = [{'model': 'a', 'fk': 'product_version_id'}, {'model': 'b', 'fk': 'product_version_id'},
             {'model': 'c', 'fk': 'product_version_id'}]
    raw = {
        'a': {'x-import-key': ['sku', 'x.y'], 'properties': {'sku': {}, 'qty': {}, 'product_version_id': {}}},
        'b': {'properties': {'order': {}, 'note': {}, 'product_version_id': {}}},
        'c': {'properties': {'note': {}, 'product_version_id': {}}},
    }
    import build_context as bc
    orig_children, orig_raw = vo.version_of_children, bc._raw_def
    vo.version_of_children = lambda *_: (owned, [])
    bc._raw_def = lambda name, _s: raw[name]
    try:
        out = version_diff_children('product_version', schema,
                                    [{'name': n, 'property_name': f'{n}_rows'} for n in 'abc'])
    finally:
        vo.version_of_children, bc._raw_def = orig_children, orig_raw
    assert [(c['match'], c['key_fields']) for c in out] == [('key', ['sku']), ('order', []), ('none', [])]
    assert out[0]['fields'] == ['sku', 'qty']
