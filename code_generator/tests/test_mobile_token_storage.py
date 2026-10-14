"""
The generated mobile lib/token-storage.ts locks the refresh token behind the device's biometrics or PIN, except in
Expo Go, whose own Info.plist has no NSFaceIDUsageDescription (SecureStore rejects requireAuthentication there).

Runs the real template through Node (types stripped) with react-native, expo-constants, expo-secure-store and
expo-local-authentication replaced by recording stand-ins (fixtures/mobile_token_storage/harness.mjs).

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_token_storage.py -v
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
HARNESS = HERE / 'fixtures' / 'mobile_token_storage' / 'harness.mjs'
TEMPLATE = HERE.parent / 'templates' / 'mobile' / 'lib' / 'token-storage.ts.jinja2'
APP_JSON = HERE.parent / 'templates' / 'mobile' / 'app.json.jinja2'


def _run(tmp_path: Path, **scenario) -> dict:
    base = {'executionEnvironment': 'standalone', 'platformOS': 'ios', 'hasHardware': True, 'isEnrolled': True}
    ts = tmp_path / 'token-storage.ts'
    shutil.copy(TEMPLATE, ts)  # the template has no Jinja syntax, so it is the generated file byte for byte
    result = subprocess.run(
        ['node', str(HARNESS), str(ts), json.dumps({**base, **scenario})],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def _lock_options(out: dict, fn: str):
    return [c['options'] for c in out['calls'] if c['fn'] == fn]


def test_expo_go_saves_and_reads_the_refresh_token_without_the_lock(tmp_path):
    out = _run(tmp_path, executionEnvironment='storeClient')
    assert out['saveError'] is None
    assert _lock_options(out, 'setItemAsync') == [None]
    assert _lock_options(out, 'getItemAsync') == [None]
    assert out['read'] == 'refresh-secret'


@pytest.mark.parametrize('environment', ['standalone', 'bare'])
def test_standalone_and_development_builds_lock_the_refresh_token_at_save_and_at_read(tmp_path, environment):
    out = _run(tmp_path, executionEnvironment=environment)
    assert out['saveError'] is None
    for fn in ('setItemAsync', 'getItemAsync'):
        (options,) = _lock_options(out, fn)
        assert options['requireAuthentication'] is True
    assert out['read'] == 'refresh-secret'


def test_a_device_without_an_enrolled_lock_still_stores_unlocked_outside_expo_go(tmp_path):
    out = _run(tmp_path, isEnrolled=False)
    assert _lock_options(out, 'setItemAsync') == [None]
    assert _lock_options(out, 'getItemAsync') == [None]


def test_a_rejected_locked_save_is_not_retried_unlocked(tmp_path):
    # No silent downgrade: outside Expo Go a rejected locked save surfaces the error and stores nothing.
    out = _run(tmp_path, rejectLocked=True)
    assert out['saveError'] is not None
    assert len(_lock_options(out, 'setItemAsync')) == 1
    assert out['read'] is None


def test_web_never_touches_secure_store(tmp_path):
    out = _run(tmp_path, platformOS='web')
    assert out['calls'] == []
    assert out['saveError'] is None
    assert out['read'] == 'refresh-secret'


def test_the_secure_store_plugin_is_declared_so_standalone_builds_get_the_face_id_text():
    assert 'expo-secure-store' in APP_JSON.read_text()
