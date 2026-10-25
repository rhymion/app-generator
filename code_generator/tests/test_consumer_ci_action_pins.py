"""Every `uses:` reference in the canonical consumer ci.yml is pinned to a full commit SHA."""

import re
from pathlib import Path

CANONICAL_CI = Path(__file__).resolve().parents[2] / "docs" / "consumer-commands" / "ci.yml"

USES_LINE = re.compile(r"^\s*(?:-\s+)?uses:\s*(?P<ref>\S+)(?P<rest>.*)$")
PINNED = re.compile(r"^[A-Za-z0-9._/-]+@[0-9a-f]{40}$")
VERSION_COMMENT = re.compile(r"^\s+# v\d+\.\d+\.\d+\s*$")


def _uses_lines():
    lines = CANONICAL_CI.read_text().splitlines()
    return [(n, m) for n, line in enumerate(lines, 1) if (m := USES_LINE.match(line))]


def test_canonical_ci_has_uses_lines():
    assert _uses_lines(), "no `uses:` lines found; the pin check would pass vacuously"


def test_every_action_is_pinned_to_a_full_commit_sha():
    unpinned = [f"line {n}: {m['ref']}" for n, m in _uses_lines() if not PINNED.match(m["ref"])]
    assert not unpinned, "actions must be pinned to a 40-hex commit SHA:\n" + "\n".join(unpinned)


def test_every_pinned_action_carries_a_version_comment():
    missing = [f"line {n}: {m['ref']}" for n, m in _uses_lines() if not VERSION_COMMENT.match(m["rest"])]
    assert not missing, "pinned actions need a trailing `# vX.Y.Z` comment:\n" + "\n".join(missing)
