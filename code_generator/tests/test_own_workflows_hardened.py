"""This repository's own workflows pin every action by commit SHA and default to read-only permissions."""

import re
from pathlib import Path

WORKFLOWS = sorted((Path(__file__).resolve().parents[2] / ".github" / "workflows").glob("*.yml"))

USES_LINE = re.compile(r"^\s*(?:-\s+)?uses:\s*(?P<ref>\S+)(?P<rest>.*)$")
PINNED = re.compile(r"^[A-Za-z0-9._/-]+@[0-9a-f]{40}$")
VERSION_COMMENT = re.compile(r"^\s+# v\d+\.\d+\.\d+\s*$")
TOP_LEVEL_PERMISSIONS = re.compile(r"^permissions:\s*\n  contents: read\s*$", re.MULTILINE)


def test_workflows_found():
    assert WORKFLOWS, "no workflow files found; the checks below would pass vacuously"


def test_every_action_is_pinned_with_a_version_comment():
    problems = []
    for path in WORKFLOWS:
        for n, line in enumerate(path.read_text().splitlines(), 1):
            m = USES_LINE.match(line)
            if not m:
                continue
            if not PINNED.match(m["ref"]):
                problems.append(f"{path.name}:{n}: {m['ref']} is not pinned to a 40-hex SHA")
            elif not VERSION_COMMENT.match(m["rest"]):
                problems.append(f"{path.name}:{n}: {m['ref']} lacks a trailing `# vX.Y.Z` comment")
    assert not problems, "\n".join(problems)


def test_every_workflow_defaults_to_read_only_contents():
    missing = [p.name for p in WORKFLOWS if not TOP_LEVEL_PERMISSIONS.search(p.read_text())]
    assert not missing, f"top-level `permissions: contents: read` missing in: {missing}"
