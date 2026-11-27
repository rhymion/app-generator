"""The CI job that audits the generated Expo app's dependencies (Issue #1074) must stay non-blocking and keep its shape."""

import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"
ENABLE = REPO_ROOT / "scripts" / "enable_mobile_generation.py"
SCHEMA = REPO_ROOT / "code_generator" / "json_schema.yaml"


def _job() -> dict:
    jobs = yaml.safe_load(CI.read_text())["jobs"]
    assert "audit-mobile" in jobs, "the audit-mobile job was removed from ci.yml"
    return jobs["audit-mobile"]


def _step(job: dict, fragment: str) -> dict:
    matches = [s for s in job["steps"] if fragment in s.get("name", "")]
    assert len(matches) == 1, f"expected exactly one step named like {fragment!r}"
    return matches[0]


def test_audit_step_never_fails_the_run():
    step = _step(_job(), "npm audit (mobile/")
    assert step["continue-on-error"] is True
    assert step["working-directory"] == "mobile"
    assert "npm audit --json" in step["run"]
    assert "--ignore-scripts" in step["run"], "resolving the tree must not run package scripts"


def test_job_is_not_gated_like_the_docs_only_e2e_job():
    job = _job()
    assert "needs" not in job and "if" not in job


def test_mobile_is_generated_from_the_default_schema_and_fails_closed():
    run = _step(_job(), "Generate the mobile app")["run"]
    assert "scripts/enable_mobile_generation.py code_generator/json_schema.yaml" in run
    assert "npm run generate-code" in run
    assert run.index("enable_mobile_generation.py") < run.index("npm run generate-code")
    assert "test -f mobile/package.json" in run


def test_summary_and_artifact_are_written_even_when_the_audit_fails():
    job = _job()
    assert _step(job, "Summarize audit result")["if"] == "always()"
    upload = _step(job, "Upload audit JSON artifact")
    assert upload["if"] == "always()"
    assert upload["with"]["path"] == "audit-mobile.json"


# --- scripts/enable_mobile_generation.py -------------------------------------
# The job must audit mobile/ whatever the committed schema says about
# x-generator.mobile, and must not break when the schema already enables it
# (a second `mobile:` key makes build_user_schema.py's ruamel loader raise
# DuplicateKeyError, which failed the job before it reached npm audit).


def _without_mobile(text: str) -> str:
    """The committed schema with any x-generator.mobile block removed."""
    lines, out, skipping = text.splitlines(keepends=True), [], False
    for line in lines:
        if line.startswith("  mobile:"):
            skipping = True
            continue
        if skipping and (line.startswith("    ") or not line.strip()):
            if not line.strip():
                skipping = False
                out.append(line)
            continue
        skipping = False
        out.append(line)
    return "".join(out)


def _with_mobile(text: str, value: str) -> str:
    return _without_mobile(text).replace(
        "x-generator:\n", f"x-generator:\n  mobile:\n    enabled: {value}\n", 1)


def _run(path: Path) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(ENABLE), str(path)], capture_output=True, text=True)


def _mobile_of(path: Path):
    from ruamel.yaml import YAML
    return YAML().load(path.read_text(encoding="utf-8"))["x-generator"].get("mobile")


@pytest.mark.parametrize("state", ["absent", "false", "true"])
def test_enable_script_turns_mobile_on_from_every_committed_state(tmp_path, state):
    base = SCHEMA.read_text(encoding="utf-8")
    text = _without_mobile(base) if state == "absent" else _with_mobile(base, state)
    schema = tmp_path / "json_schema.yaml"
    schema.write_text(text, encoding="utf-8")
    assert (_mobile_of(schema) or {}).get("enabled") is (True if state == "true" else None if state == "absent" else False)

    result = _run(schema)

    assert result.returncode == 0, result.stderr
    assert dict(_mobile_of(schema)) == {"enabled": True}
    after = schema.read_text(encoding="utf-8")
    assert after.count("\n  mobile:\n") == 1, "exactly one x-generator.mobile key"
    if state == "true":
        assert after == text, "an already-enabled schema is left byte for byte"
    else:
        assert len(after.splitlines()) - len(text.splitlines()) in (0, 2), "only the mobile lines change"


def test_enable_script_is_idempotent(tmp_path):
    schema = tmp_path / "json_schema.yaml"
    schema.write_text(_without_mobile(SCHEMA.read_text(encoding="utf-8")), encoding="utf-8")
    assert _run(schema).returncode == 0
    once = schema.read_text(encoding="utf-8")
    assert _run(schema).returncode == 0
    assert schema.read_text(encoding="utf-8") == once


def test_enable_script_fails_closed_without_an_x_generator_block(tmp_path):
    schema = tmp_path / "json_schema.yaml"
    schema.write_text("format-version: 6.0\ndefinitions: {}\n", encoding="utf-8")
    result = _run(schema)
    assert result.returncode != 0
    assert "x-generator" in result.stderr
