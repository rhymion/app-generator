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
from version_of import version_of_copy_plan, version_of_entities, version_of_errors, version_of_for

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
        'number': 'version_no', 'identity_fk': 'product_id',
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
    return {**version_of_for('product_version', _schema()), 'children': [],
            'copy': {'columns': [], 'audit': [], 'children': [], 'uses_json': False}, **over}


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
    vo = version_of_for('product_version', _schema())
    return version_of_copy_plan(vo, [{'model': 'coverage', 'fk': 'product_version_id'}], _schema(), parse_prisma_schema(f))


def test_copy_plan_skips_number_submit_field_unique_and_system_columns(tmp_path):
    plan = _plan(tmp_path)
    names = [c['name'] for c in plan['columns']]
    # carried over: the identity FK and plain columns
    assert names == ['product_id', 'title', 'meta']
    # the number, the submit field (status), the unique slug, ids and timestamps restart
    assert plan['audit'] == ['creator_id', 'updater_id']
    assert plan['uses_json'] is True
    child = plan['children'][0]
    assert [c['name'] for c in child['columns']] == ['label']


def test_new_draft_function_renders_copy_and_child_copy(tmp_path):
    out = _render(_make_env(), 'version_of.ts.jinja2', _ctx(
        children=[{'model': 'coverage', 'fk': 'product_version_id'}], copy=_plan(tmp_path)))
    assert 'export async function newDraftFromCurrent' in out
    assert 'identity.current_version_id' in out
    assert 'await assertSingleOpenDraft(tx, identityId, null);' in out
    assert 'title: source.title,' in out
    assert 'version_no' not in out.split('newDraftFromCurrent')[1]
    assert 'meta: (source.meta ?? undefined) as Prisma.InputJsonValue | undefined,' in out
    assert 'creator_id: actorId,' in out
    assert 'tx.coverage.createMany' in out and 'product_version_id: draft.id,' in out
    assert 'label: row.label,' in out


def test_new_draft_route_and_action_render():
    vo = version_of_for('product_version', _schema())
    route = _render(_make_env(), 'version_of_new_draft_route.ts.jinja2', vo)
    assert "requireApiPermission(userId, 'product_version', 'create')" in route
    assert 'newDraftFromCurrent(tx, identityId, userId)' in route and 'status: 201' in route
    action = _render(_make_env(), 'version_of_new_draft_action.ts.jinja2', {**vo, 'pascal': 'ProductVersion'})
    assert action.startswith('// AUTO-GENERATED') and "'use server';" in action
    assert 'export async function newDraftProductVersion(' in action


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
