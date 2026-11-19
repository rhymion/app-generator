"""Behaviour of .claude/hooks/project_hooks.py (Claude Code hooks for this repo).

Each test runs the hook script the way Claude Code does: JSON on stdin,
CLAUDE_PROJECT_DIR pointing at a throwaway git repository.
See docs/knowledge/claude-code-hooks-and-agents.md.
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
HOOKS = REPO_ROOT / '.claude' / 'hooks' / 'project_hooks.py'
SETTINGS = REPO_ROOT / '.claude' / 'settings.json'


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(['git', '-C', str(repo), '-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
                           *args], capture_output=True, text=True, check=True).stdout


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / 'repo'
    root.mkdir()
    _git(root, 'init', '-q')
    (root / '.gitignore').write_text('/app/generated/\nignored.ts\n')
    (root / 'tracked.ts').write_text('export const a = 1;\n')
    _git(root, 'add', '.')
    _git(root, 'commit', '-q', '-m', 'init')
    return root


def run_hook(repo: Path, command: str, payload: dict, extra_env: dict | None = None):
    env = {k: v for k, v in os.environ.items() if k not in ('CLAUDE_ENV_FILE', 'CLAUDE_ALLOW_GENERATED_EDITS')}
    env['CLAUDE_PROJECT_DIR'] = str(repo)
    env.update(extra_env or {})
    return subprocess.run([sys.executable, str(HOOKS), command], input=json.dumps(payload),
                          capture_output=True, text=True, env=env, check=False)


def edit_payload(repo: Path, rel: str) -> dict:
    return {'tool_name': 'Edit', 'tool_input': {'file_path': str(repo / rel)}}


# --------------------------------------------------------------------------- wiring

def test_mui_regex_matches_the_gate_test():
    hooks = _load(HOOKS, 'project_hooks')
    gate = _load(Path(__file__).parent / 'test_template_mui_imports.py', 'mui_gate')
    assert hooks.MUI_RE.pattern == gate.MUI_RE.pattern


def test_settings_register_every_sub_command():
    settings = json.loads(SETTINGS.read_text(encoding='utf-8'))
    commands = [h.get('command', '') for groups in settings['hooks'].values() for g in groups for h in g['hooks']]
    hooks = _load(HOOKS, 'project_hooks')
    for name in hooks.COMMANDS:
        assert any(c.endswith(f'project_hooks.py" {name}') for c in commands), name


def test_internal_error_never_blocks(repo):
    result = subprocess.run([sys.executable, str(HOOKS), 'guard-generated'], input='{not json',
                            capture_output=True, text=True, check=False)
    assert result.returncode == 0
    assert 'internal error ignored' in result.stderr


# --------------------------------------------------------------------------- guard-generated

def test_guard_blocks_generated_directory(repo):
    result = run_hook(repo, 'guard-generated', edit_payload(repo, 'app/generated/user/page.tsx'))
    assert result.returncode == 2
    assert 'generated code' in result.stderr


def test_guard_uses_manifest_modes(repo):
    (repo / '.generated-manifest.json').write_text(json.dumps({'files': [
        {'path': 'lib/user/service.ts', 'mode': 'overwrite'},
        {'path': 'lib/user/service_validation_custom.ts', 'mode': 'stub'},
    ]}))
    assert run_hook(repo, 'guard-generated', edit_payload(repo, 'lib/user/service.ts')).returncode == 2
    assert run_hook(repo, 'guard-generated', edit_payload(repo, 'lib/user/service_validation_custom.ts')).returncode == 0
    assert run_hook(repo, 'guard-generated', edit_payload(repo, 'tracked.ts')).returncode == 0


def test_guard_override_and_outside_paths(repo, tmp_path):
    payload = edit_payload(repo, 'app/generated/x.ts')
    assert run_hook(repo, 'guard-generated', payload, {'CLAUDE_ALLOW_GENERATED_EDITS': '1'}).returncode == 0
    outside = {'tool_input': {'file_path': str(tmp_path / 'app' / 'generated' / 'x.ts')}}
    assert run_hook(repo, 'guard-generated', outside).returncode == 0


# --------------------------------------------------------------------------- check-written-file

def test_raw_sql_call_is_reported_but_a_comment_is_not(repo):
    (repo / 'bad.ts').write_text('await db.$executeRawUnsafe(`DROP TABLE x`);\n')
    result = run_hook(repo, 'check-written-file', edit_payload(repo, 'bad.ts'))
    assert result.returncode == 2
    assert 'bad.ts:1' in result.stderr
    (repo / 'ok.ts').write_text('// never `$executeRawUnsafe`, use a tagged template\nawait db.$executeRaw`SELECT 1`;\n')
    assert run_hook(repo, 'check-written-file', edit_payload(repo, 'ok.ts')).returncode == 0
    (repo / '.semgrep').mkdir()
    (repo / '.semgrep' / 'rules.ts').write_text('db.$queryRawUnsafe(`x`);\n')
    assert run_hook(repo, 'check-written-file', edit_payload(repo, '.semgrep/rules.ts')).returncode == 0


def test_template_mui_import_is_reported(repo):
    tpl = repo / 'code_generator' / 'templates' / 'page.tsx.jinja2'
    tpl.parent.mkdir(parents=True)
    tpl.write_text("import Box from '@mui/material/Box';\n")
    result = run_hook(repo, 'check-written-file', edit_payload(repo, 'code_generator/templates/page.tsx.jinja2'))
    assert result.returncode == 2
    assert '@mui' in result.stderr


def test_new_source_file_gets_intent_to_add(repo):
    (repo / 'new_module.ts').write_text('export const b = 2;\n')
    result = run_hook(repo, 'check-written-file', edit_payload(repo, 'new_module.ts'))
    assert result.returncode == 0
    assert 'new_module.ts' in json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
    assert 'new_module.ts' in _git(repo, 'ls-files')
    assert _git(repo, 'diff', '--cached', '--name-only') == ''  # nothing actually staged


def test_ignored_and_tracked_files_are_left_alone(repo):
    (repo / 'ignored.ts').write_text('export {};\n')
    assert run_hook(repo, 'check-written-file', edit_payload(repo, 'ignored.ts')).stdout == ''
    assert 'ignored.ts' not in _git(repo, 'ls-files')
    assert run_hook(repo, 'check-written-file', edit_payload(repo, 'tracked.ts')).stdout == ''


# --------------------------------------------------------------------------- investigate

def test_investigate_blocks_stop_after_an_edit(repo):
    session = {'session_id': 's1'}
    run_hook(repo, 'investigate-snapshot', {**session, 'prompt': '/investigate how does X work?'})
    assert run_hook(repo, 'investigate-verify', session).stdout == ''
    (repo / 'tracked.ts').write_text('export const a = 2;\n')
    decision = json.loads(run_hook(repo, 'investigate-verify', session).stdout)
    assert decision['decision'] == 'block'
    assert 'tracked.ts' in decision['reason']
    assert run_hook(repo, 'investigate-verify', {**session, 'stop_hook_active': True}).stdout == ''


def test_pre_existing_changes_do_not_count(repo):
    (repo / 'tracked.ts').write_text('export const a = 3;\n')
    (repo / 'scratch.md').write_text('notes\n')
    session = {'session_id': 's2'}
    run_hook(repo, 'investigate-snapshot', {**session, 'prompt': 'This is an **investigate** task.'})
    assert run_hook(repo, 'investigate-verify', session).stdout == ''


def test_other_task_command_ends_investigate_mode(repo):
    session = {'session_id': 's3'}
    run_hook(repo, 'investigate-snapshot', {**session, 'prompt': '/investigate X'})
    run_hook(repo, 'investigate-snapshot', {**session, 'prompt': 'a follow-up question'})
    (repo / 'tracked.ts').write_text('export const a = 4;\n')
    assert 'block' in run_hook(repo, 'investigate-verify', session).stdout
    run_hook(repo, 'investigate-snapshot', {**session, 'prompt': '/update-code do it'})
    assert run_hook(repo, 'investigate-verify', session).stdout == ''


# --------------------------------------------------------------------------- session-env

def test_session_env_exports_the_venv(repo, tmp_path):
    venv_bin = repo / '.venv' / 'bin'
    venv_bin.mkdir(parents=True)
    (venv_bin / 'python3').write_text('')
    env_file = tmp_path / 'env.sh'
    run_hook(repo, 'session-env', {}, {'CLAUDE_ENV_FILE': str(env_file)})
    assert f'export PATH="{venv_bin}:$PATH"' in env_file.read_text()


def test_session_env_without_venv_writes_nothing(repo, tmp_path):
    env_file = tmp_path / 'env.sh'
    run_hook(repo, 'session-env', {}, {'CLAUDE_ENV_FILE': str(env_file)})
    assert not env_file.exists()
