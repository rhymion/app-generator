"""The CI job that audits the generated Expo app's dependencies (Issue #1074) must stay non-blocking and keep its shape."""

from pathlib import Path

import yaml

CI = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"


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
    assert "enabled: true" in run and "npm run generate-code" in run
    assert "test -f mobile/package.json" in run


def test_summary_and_artifact_are_written_even_when_the_audit_fails():
    job = _job()
    assert _step(job, "Summarize audit result")["if"] == "always()"
    upload = _step(job, "Upload audit JSON artifact")
    assert upload["if"] == "always()"
    assert upload["with"]["path"] == "audit-mobile.json"
