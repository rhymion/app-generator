"""Tests for scripts/gate_run_lock.sh and its use by the disposable-stack e2e gate scripts."""
from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
HELPER = REPO / 'scripts' / 'gate_run_lock.sh'
GATES = sorted((REPO / 'scripts').glob('check_*_e2e_gate_fixture.sh'))

pytestmark = pytest.mark.skipif(shutil.which('flock') is None, reason='flock is required')


def _holder(lock: Path) -> subprocess.Popen:
    """A live run: takes the lock through the helper, then idles."""
    p = subprocess.Popen(
        ['bash', '-c', f'source {HELPER}; gate_run_lock {lock} test-gate; echo held; sleep 30'],
        stdout=subprocess.PIPE, text=True,
    )
    assert p.stdout.readline().strip() == 'held'
    return p


def _second(lock: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ['bash', '-c', f'source {HELPER}; gate_run_lock {lock} test-gate; echo acquired'],
        capture_output=True, text=True,
    )


def test_second_run_is_refused_while_first_is_alive(tmp_path):
    lock = tmp_path / '.generated-x.lock'
    holder = _holder(lock)
    try:
        r = _second(lock)
        assert r.returncode == 1
        assert 'acquired' not in r.stdout
        assert 'another run is still active' in r.stderr
        assert lock.read_text().strip() == str(holder.pid)
    finally:
        holder.kill()
        holder.wait()


def test_lock_is_released_when_holder_dies_without_cleanup(tmp_path):
    lock = tmp_path / '.generated-x.lock'
    holder = _holder(lock)
    holder.kill()
    holder.wait()
    for _ in range(20):
        r = _second(lock)
        if r.returncode == 0:
            break
        time.sleep(0.1)
    assert r.returncode == 0 and 'acquired' in r.stdout


def test_sequential_runs_are_not_blocked(tmp_path):
    lock = tmp_path / '.generated-x.lock'
    assert _second(lock).returncode == 0
    assert _second(lock).returncode == 0


@pytest.mark.parametrize('script', GATES, ids=lambda p: p.name)
def test_gate_script_refuses_before_any_teardown_when_lock_is_held(script, tmp_path):
    """The lock sits before `trap cleanup EXIT`: a refused run must not touch the build dir."""
    checkout = tmp_path / 'checkout'
    (checkout / 'scripts').mkdir(parents=True)
    shutil.copy(script, checkout / 'scripts' / script.name)
    shutil.copy(HELPER, checkout / 'scripts' / HELPER.name)
    text = script.read_text()
    fixture = next(line for line in text.splitlines() if line.startswith('FIXTURE_DIR='))
    fixture_dir = fixture.split('=', 1)[1].strip('"')
    (checkout / fixture_dir).mkdir(parents=True)
    (checkout / fixture_dir / 'json_schema.yaml').write_text('x: 1\n')
    (checkout / fixture_dir / 'schema_additions.prisma').write_text('\n')
    build = next(line for line in text.splitlines() if line.startswith('BUILD_DIR=')).split('/')[-1].rstrip('"')
    build_dir = checkout / build
    build_dir.mkdir()
    sentinel = build_dir / 'running.txt'
    sentinel.write_text('first run\n')
    holder = _holder(Path(f'{build_dir}.lock'))
    try:
        r = subprocess.run(['bash', str(checkout / 'scripts' / script.name)],
                           capture_output=True, text=True, cwd=checkout)
        assert r.returncode == 1, r.stdout + r.stderr
        assert 'another run is still active' in r.stderr
        assert sentinel.read_text() == 'first run\n'
    finally:
        holder.kill()
        holder.wait()
