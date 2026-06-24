import pytest
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from generate import _resolve_set_fields


def test_resolve_string_label_to_int():
    props = {'status': {'type': 'integer', 'enum': ['Pending', 'Approved']}}
    assert _resolve_set_fields(props, {'status': 'approved'}) == {'status': 1}


def test_resolve_case_insensitive():
    props = {'status': {'type': 'integer', 'enum': ['Pending', 'Approved']}}
    assert _resolve_set_fields(props, {'status': 'Approved'}) == {'status': 1}
    assert _resolve_set_fields(props, {'status': 'APPROVED'}) == {'status': 1}


def test_resolve_int_passthrough():
    props = {'count': {'type': 'integer'}}
    assert _resolve_set_fields(props, {'count': 5}) == {'count': 5}


def test_resolve_string_non_integer_passthrough():
    props = {'note': {'type': 'string'}}
    assert _resolve_set_fields(props, {'note': 'done'}) == {'note': 'done'}


def test_resolve_unknown_label_raises():
    props = {'status': {'type': 'integer', 'enum': ['Pending', 'Approved']}}
    with pytest.raises(ValueError, match="not found in enum"):
        _resolve_set_fields(props, {'status': 'invalid'})
