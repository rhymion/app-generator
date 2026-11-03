"""The SBOM workflow (Issue #1320) must keep generating a CycloneDX file from the lock file and upload it."""

import re
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "sbom.yml"


def _text() -> str:
    assert WORKFLOW.exists(), ".github/workflows/sbom.yml was removed"
    return WORKFLOW.read_text()


def test_generates_a_cyclonedx_sbom_from_the_lock_file():
    text = _text()
    assert re.search(r"npm sbom --sbom-format cyclonedx\b.*--omit dev.*--package-lock-only", text)


def test_runs_when_the_lock_file_changes():
    text = _text()
    assert text.count("- package-lock.json") >= 2, "both the pull_request and push triggers must watch package-lock.json"


def test_fails_on_an_empty_sbom_and_uploads_the_artifact():
    text = _text()
    assert "SBOM is empty or malformed" in text
    assert re.search(r"actions/upload-artifact@[0-9a-f]{40}", text)
    assert "sbom.cdx.json" in text
