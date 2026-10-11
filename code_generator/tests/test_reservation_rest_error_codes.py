"""
The generated REST routes answer the two reservation failures with HTTP 409 and a
machine-readable `code`, so the mobile transport (which reads `code` from the body
before falling back to the status) shows the capacity / locked texts instead of the
generic stale-update warning.

Run:
    cd code_generator && python3 -m pytest tests/test_reservation_rest_error_codes.py -v
"""
from pathlib import Path

_TEMPLATES = Path(__file__).resolve().parent.parent / 'templates'


def _read(name: str) -> str:
    return (_TEMPLATES / name).read_text()


def test_collection_route_409_carries_capacity_code():
    src = _read('api_route.ts.jinja2')
    assert "error instanceof InsufficientPoolCapacityError" in src
    assert "code: 'CAPACITY' }, { status: 409 }" in src


def test_detail_route_409_carries_reservation_locked_code():
    src = _read('api_detail_route.ts.jinja2')
    assert src.count("code: 'RESERVATION_LOCKED' }, { status: 409 }") == 2  # PUT and DELETE
    assert "{ error: (error as Error).message }, { status: 409 }" not in src
