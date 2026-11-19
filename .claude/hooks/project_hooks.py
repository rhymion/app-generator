#!/usr/bin/env python3
"""Claude Code hooks for this repo (registered in .claude/settings.json).

One script, one sub-command per hook. Standard library only, so it runs with
the system python3 before any virtualenv is active. See
docs/knowledge/claude-code-hooks-and-agents.md for what each hook enforces and
why.

Contract (Claude Code hooks): the hook input is a JSON object on stdin.
Exit 0 = proceed; for PreToolUse, exit 2 blocks the tool call and stderr is
sent to Claude; for PostToolUse, exit 2 sends stderr to Claude after the tool
ran. Any unexpected error exits 0: a broken hook must never block a session.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# Keep in sync with code_generator/tests/test_template_mui_imports.py (MUI_RE);
# code_generator/tests/test_claude_project_hooks.py asserts the two are equal.
MUI_RE = re.compile(r"from\s+'@mui|from\s+\"@mui")

# Forbidden raw-SQL call forms (docs/knowledge/raw-sql-policy.md). Matches a
# call, not a mention: comments that name the API without calling it pass.
RAW_SQL_RE = re.compile(r"\$(?:queryRawUnsafe|executeRawUnsafe)\s*[(<`]|\bPrisma\.raw\s*\(")
RAW_SQL_SUFFIXES = ('.ts', '.tsx', '.js', '.mjs', '.cjs', '.jinja2')
# .semgrep/ holds deliberately bad fixtures for the semgrep rules.
RAW_SQL_EXEMPT_PREFIXES = ('.semgrep/',)

# New files with these suffixes get `git add -N` (see intent_to_add()).
INTENT_TO_ADD_SUFFIXES = ('.ts', '.tsx', '.js', '.mjs', '.cjs', '.py')

# Gitignored generator output directories. Edits there are lost on the next
# `generate-code`; used in addition to the manifest's `overwrite` entries.
GENERATED_DIRS = (
    'app/generated/',
    'mobile/e2e/generated/',
    'code_generator/.generated/',
    'prisma/migrations/',
)
ALLOW_GENERATED_ENV = 'CLAUDE_ALLOW_GENERATED_EDITS'

# Paths never touched by these hooks (other checkouts living inside this one).
IGNORED_PREFIXES = ('.claude/worktrees/',)

INVESTIGATE_RE = re.compile(
    r"^\s*/investigate\b|<command-name>/?investigate</command-name>|This is an \*\*investigate\*\* task")
OTHER_TASK_RE = re.compile(
    r"^\s*/(?:generate-schema|update-generator|add-component|update-code)\b"
    r"|<command-name>/?(?:generate-schema|update-generator|add-component|update-code)</command-name>"
    r"|This is an \*\*(?:generate-schema|update-generator|add-component|update-code)\*\* task")


# --------------------------------------------------------------------------- helpers

def project_dir(payload: dict) -> Path:
    return Path(os.environ.get('CLAUDE_PROJECT_DIR') or payload.get('cwd') or os.getcwd()).resolve()


def git(root: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True, check=False)
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return result.stdout


def relative(root: Path, file_path: str) -> str | None:
    """Repo-relative POSIX path, or None when the file is outside the project."""
    if not file_path:
        return None
    path = Path(file_path)
    if not path.is_absolute():
        path = root / path
    try:
        rel = path.resolve().relative_to(root).as_posix()
    except ValueError:
        return None
    if rel.startswith(IGNORED_PREFIXES):
        return None
    return rel


def edited_paths(payload: dict) -> list[str]:
    tool_input = payload.get('tool_input') or {}
    path = tool_input.get('file_path') or tool_input.get('notebook_path')
    return [path] if path else []


def manifest_overwrite_paths(root: Path) -> set[str]:
    manifest = root / '.generated-manifest.json'
    try:
        data = json.loads(manifest.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return set()
    return {f['path'] for f in data.get('files', []) if f.get('mode') == 'overwrite' and 'path' in f}


def strip_comment_lines(text: str) -> list[tuple[int, str]]:
    """Lines that are not pure // or /* */ comment lines, with 1-based numbers."""
    kept = []
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.lstrip()
        if stripped.startswith(('//', '*', '/*', '{#')):
            continue
        kept.append((number, line))
    return kept


# --------------------------------------------------------------------------- session-env

def session_env(payload: dict) -> int:
    """SessionStart: put the project .venv on PATH for every Bash command.

    In a linked worktree the .venv (gitignored) usually lives only in the main
    checkout, so fall back to the main worktree's .venv.
    """
    env_file = os.environ.get('CLAUDE_ENV_FILE')
    if not env_file:
        return 0
    root = project_dir(payload)
    candidates = [root / '.venv']
    try:
        common = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir').strip())
        candidates.append(common.parent / '.venv')
    except (RuntimeError, OSError):
        pass
    for venv in candidates:
        if (venv / 'bin' / 'python3').exists():
            with open(env_file, 'a', encoding='utf-8') as handle:
                handle.write(f'export VIRTUAL_ENV="{venv}"\n')
                handle.write(f'export PATH="{venv}/bin:$PATH"\n')
            return 0
    return 0


# --------------------------------------------------------------------------- guard-generated

def guard_generated(payload: dict) -> int:
    """PreToolUse (Edit/Write/MultiEdit/NotebookEdit): block edits to generated output."""
    if os.environ.get(ALLOW_GENERATED_ENV) == '1':
        return 0
    root = project_dir(payload)
    overwrite = None
    for raw in edited_paths(payload):
        rel = relative(root, raw)
        if rel is None:
            continue
        if rel.startswith(GENERATED_DIRS):
            reason = 'it is inside a gitignored generator output directory'
        else:
            if overwrite is None:
                overwrite = manifest_overwrite_paths(root)
            if rel not in overwrite:
                continue
            reason = '.generated-manifest.json lists it with mode "overwrite"'
        print(
            f'Blocked: {rel} is generated code ({reason}); `npm run generate-code` replaces it, '
            'so a hand edit is lost. Change the template under code_generator/templates/, the generator '
            '(code_generator/*.py) or the schema instead. Write-once stubs (manifest mode "stub", e.g. '
            'lib/<entity>/service_validation_custom.ts) stay editable. To override for one session, the user '
            f'can start Claude Code with {ALLOW_GENERATED_ENV}=1.',
            file=sys.stderr,
        )
        return 2
    return 0


# --------------------------------------------------------------------------- check-written-file

def intent_to_add(root: Path, rel: str) -> bool:
    """`git add -N` a new, untracked, not-ignored source file.

    code_generator/check_tracked_generated_imports.py reads the git index; a
    tracked file importing a brand-new untracked module is reported as importing
    a git-ignored file. Registering intent-to-add avoids that false failure.
    """
    if not rel.endswith(INTENT_TO_ADD_SUFFIXES):
        return False
    tracked = subprocess.run(['git', '-C', str(root), 'ls-files', '--error-unmatch', '--', rel],
                             capture_output=True, check=False).returncode == 0
    if tracked:
        return False
    ignored = subprocess.run(['git', '-C', str(root), 'check-ignore', '-q', '--', rel],
                             capture_output=True, check=False).returncode == 0
    if ignored:
        return False
    return subprocess.run(['git', '-C', str(root), 'add', '-N', '--', rel],
                          capture_output=True, check=False).returncode == 0


def file_violations(root: Path, rel: str) -> list[str]:
    path = root / rel
    try:
        text = path.read_text(encoding='utf-8')
    except (OSError, UnicodeDecodeError):
        return []
    problems = []
    if rel.startswith('code_generator/templates/') and rel.endswith('.jinja2'):
        for number, line in enumerate(text.splitlines(), start=1):
            if MUI_RE.search(line):
                problems.append(
                    f'{rel}:{number}: direct @mui import in a template ({line.strip()}). '
                    'Use a wrapper from components/ui/ or components/_standard/ (CLAUDE.md "Template MUI '
                    'Import Rule"; gate: code_generator/tests/test_template_mui_imports.py).')
    if rel.endswith(RAW_SQL_SUFFIXES) and not rel.startswith(RAW_SQL_EXEMPT_PREFIXES):
        for number, line in strip_comment_lines(text):
            if RAW_SQL_RE.search(line):
                problems.append(
                    f'{rel}:{number}: forbidden raw SQL API ({line.strip()}). $queryRawUnsafe / '
                    '$executeRawUnsafe / Prisma.raw are always forbidden; use the query builder, or a tagged '
                    '$queryRaw`...` with an allowlist entry (docs/knowledge/raw-sql-policy.md).')
    return problems


def check_written_file(payload: dict) -> int:
    """PostToolUse (Edit/Write/MultiEdit): rule checks plus intent-to-add for new files."""
    root = project_dir(payload)
    problems: list[str] = []
    added: list[str] = []
    for raw in edited_paths(payload):
        rel = relative(root, raw)
        if rel is None:
            continue
        problems.extend(file_violations(root, rel))
        if intent_to_add(root, rel):
            added.append(rel)
    if problems:
        print('\n'.join(problems), file=sys.stderr)
        return 2
    if added:
        print(json.dumps({'hookSpecificOutput': {
            'hookEventName': 'PostToolUse',
            'additionalContext': 'Registered new file(s) with `git add -N` (intent-to-add, nothing staged) so '
                                 'check:tracked-generated-imports sees them: ' + ', '.join(added),
        }}))
    return 0


# --------------------------------------------------------------------------- investigate no-edit check

def state_file(root: Path, session_id: str) -> Path:
    git_dir = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-dir').strip())
    safe = re.sub(r'[^A-Za-z0-9_.-]', '_', session_id or 'unknown')
    return git_dir / 'claude-hooks' / f'investigate-{safe}.json'


def worktree_fingerprint(root: Path) -> dict[str, str]:
    """{path: blob hash or 'deleted'} for every changed or untracked, not-ignored file."""
    exclude = [f':(exclude){p.rstrip("/")}' for p in IGNORED_PREFIXES]
    changed = git(root, 'diff', 'HEAD', '--name-only', '-z', '--', '.', *exclude).split('\0')
    untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z', '--', '.', *exclude).split('\0')
    paths = sorted({p for p in changed + untracked if p})
    result = {}
    for rel in paths:
        path = root / rel
        if path.is_file():
            result[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
        else:
            result[rel] = 'deleted'
    return result


def investigate_snapshot(payload: dict) -> int:
    """UserPromptSubmit: snapshot the work tree when an investigate task starts."""
    prompt = payload.get('prompt') or ''
    root = project_dir(payload)
    target = state_file(root, payload.get('session_id', ''))
    if INVESTIGATE_RE.search(prompt):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(worktree_fingerprint(root)), encoding='utf-8')
    elif OTHER_TASK_RE.search(prompt) and target.exists():
        target.unlink()
    return 0


def investigate_verify(payload: dict) -> int:
    """Stop: an investigate task must leave the work tree as it found it."""
    if payload.get('stop_hook_active'):
        return 0
    root = project_dir(payload)
    target = state_file(root, payload.get('session_id', ''))
    if not target.exists():
        return 0
    before = json.loads(target.read_text(encoding='utf-8'))
    after = worktree_fingerprint(root)
    changed = sorted(p for p in set(before) | set(after) if before.get(p) != after.get(p))
    if not changed:
        return 0
    listing = ', '.join(changed[:20]) + (f' (+{len(changed) - 20} more)' if len(changed) > 20 else '')
    print(json.dumps({
        'decision': 'block',
        'reason': 'This is an investigate task (no edits allowed), but these files changed since it started: '
                  f'{listing}. Tell the user exactly which files changed and why. Do not revert them '
                  'without the user\'s approval.',
    }))
    return 0


# --------------------------------------------------------------------------- entry point

COMMANDS = {
    'session-env': session_env,
    'guard-generated': guard_generated,
    'check-written-file': check_written_file,
    'investigate-snapshot': investigate_snapshot,
    'investigate-verify': investigate_verify,
}


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in COMMANDS:
        print(f'usage: project_hooks.py {{{"|".join(COMMANDS)}}}', file=sys.stderr)
        return 0
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        return COMMANDS[argv[1]](payload)
    except Exception as exc:  # noqa: BLE001 — a hook bug must not block the session
        print(f'project_hooks.py {argv[1]}: internal error ignored: {exc}', file=sys.stderr)
        return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
