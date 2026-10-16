"""#1046: the resubmit PUT bodies (14.3 / 14.5) omit read-only fields.

A read-only field the server assigns on approval (a version number, for
example) would otherwise be sent with the value read before approval; the
detail route rejects a differing read-only value with 400 before the
post-approval lockdown can answer 403. The 4.1 update body keeps sending it
(its record has not changed since it was read).
"""
import copy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from generators_test import api_spec_context  # noqa: E402
from test_put_body_resubmit_created_record_var import _entity_cfg, _schema  # noqa: E402


def _ctx(readonly: bool) -> dict:
    schema = copy.deepcopy(_schema())
    entity = schema['definitions']['commission_scheme_like']
    entity['properties']['revision_no'] = {'type': 'integer'}
    if readonly:
        schema['definitions']['commission_scheme_like_detail']['x-readonly-fields'] = ['revision_no']
    return api_spec_context(
        'commission_scheme_like', [], schema,
        'commission_scheme_like', 'commission_scheme_like_detail', _entity_cfg(),
    )


def test_resubmit_bodies_omit_readonly_field():
    ctx = _ctx(readonly=True)
    assert 'revision_no' in ctx['readonly_fields']
    assert 'revision_no' not in '\n'.join(ctx['put_body_resubmit'])
    assert 'revision_no' not in '\n'.join(ctx['put_body_resubmit_created'])
    assert 'note: data.record.note' in '\n'.join(ctx['put_body_resubmit'])


def test_update_body_still_sends_readonly_field():
    ctx = _ctx(readonly=True)
    assert 'revision_no: records[0].revision_no' in '\n'.join(ctx['put_body_update'])


def test_resubmit_bodies_keep_field_when_not_readonly():
    ctx = _ctx(readonly=False)
    assert 'revision_no: data.record.revision_no' in '\n'.join(ctx['put_body_resubmit'])
    assert 'revision_no: getRes1.body.revision_no' in '\n'.join(ctx['put_body_resubmit_created'])
