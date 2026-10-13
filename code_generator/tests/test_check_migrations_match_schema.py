"""Tests for scripts/check-migrations-match-schema.sh and scripts/migration_diff_filter.py.

The shell script is run with stub `psql` and `prisma` programs, so no database is
needed: the stubs record their arguments and environment, and the stub `prisma`
prints a canned diff.
"""

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "check-migrations-match-schema.sh"
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import migration_diff_filter as flt  # noqa: E402

PASSWORD = "s3cret-pw"

PSQL_STUB = """#!/bin/bash
echo "psql $*" >> "$STUB_LOG"
echo "PGPASSWORD_SEEN=${PGPASSWORD:-}" >> "$STUB_LOG"
"""

PRISMA_STUB = """#!/bin/bash
echo "prisma $*" >> "$STUB_LOG"
echo "DATABASE_URL_SEEN=$DATABASE_URL" >> "$STUB_LOG"
echo "DIRECT_URL_SEEN=$DIRECT_URL" >> "$STUB_LOG"
if [ "$1 $2" = "migrate diff" ]; then cat "$STUB_DIFF"; fi
exit "${STUB_DEPLOY_RC:-0}"
"""

CREATE_TABLE_DIFF = """-- CreateTable
CREATE TABLE "scheduled_task_run" (
    "id" TEXT NOT NULL,
    CONSTRAINT "scheduled_task_run_pkey" PRIMARY KEY ("id")
);
"""

ORPHAN_DIFF = """-- DropForeignKey
ALTER TABLE "parent_only" DROP CONSTRAINT "parent_only_x_fkey";

-- DropTable
DROP TABLE "parent_only";
"""


@pytest.fixture
def app(tmp_path):
    root = tmp_path / "app"
    (root / "prisma" / "migrations").mkdir(parents=True)
    (root / "prisma" / "schema.prisma").write_text("// schema\n")
    (root / "code_generator" / ".generated").mkdir(parents=True)
    (root / "code_generator" / ".generated" / "json_schema.yaml").write_text("{}\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("psql", PSQL_STUB), ("prisma", PRISMA_STUB)):
        path = bin_dir / name
        path.write_text(body)
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return root, bin_dir, tmp_path / "log"


def run(app, diff="", args=(), url=None, deploy_rc="0"):
    root, bin_dir, log = app
    diff_file = log.parent / "diff.sql"
    diff_file.write_text(diff)
    env = {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "HOME": str(log.parent),
        "STUB_LOG": str(log),
        "STUB_DIFF": str(diff_file),
        "STUB_DEPLOY_RC": deploy_rc,
        "MIGRATION_CHECK_ROOT": str(root),
        "MIGRATION_CHECK_PRISMA": str(bin_dir / "prisma"),
        "MIGRATION_CHECK_DATABASE_URL": url if url is not None else f"postgresql://postgres:{PASSWORD}@localhost:5432/my_next_test",
    }
    result = subprocess.run(["bash", str(SCRIPT), *args], env=env, capture_output=True, text=True)
    return result, (log.read_text() if log.exists() else "")


def test_empty_diff_passes(app):
    result, log = run(app)
    assert result.returncode == 0, result.stderr
    assert "CREATE DATABASE" in log and "DROP DATABASE" in log
    assert "prisma migrate deploy" in log


def test_missing_model_fails_and_prints_the_sql(app):
    result, _ = run(app, CREATE_TABLE_DIFF)
    assert result.returncode == 1
    assert 'CREATE TABLE "scheduled_task_run"' in result.stderr


def test_exceptions_file_covers_known_orphan(app):
    root = app[0]
    exceptions = root / "prisma" / "migration-schema-exceptions.txt"
    exceptions.write_text('# kept on purpose\nALTER TABLE "parent_only" DROP CONSTRAINT\nDROP TABLE "parent_only"\n')
    result, _ = run(app, ORPHAN_DIFF)
    assert result.returncode == 0, result.stderr


def test_exception_does_not_hide_other_differences(app):
    root = app[0]
    (root / "prisma" / "migration-schema-exceptions.txt").write_text('DROP TABLE "parent_only"\n')
    result, _ = run(app, ORPHAN_DIFF + CREATE_TABLE_DIFF)
    assert result.returncode == 1
    assert "scheduled_task_run" in result.stderr
    assert 'DROP TABLE "parent_only"' not in result.stderr


def test_custom_exceptions_path(app):
    root = app[0]
    custom = root / "rules.txt"
    custom.write_text('ALTER TABLE "parent_only"\nDROP TABLE "parent_only"\n')
    result, _ = run(app, ORPHAN_DIFF, args=("--exceptions", str(custom)))
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@ep-cool-123.us-east-2.aws.neon.tech/db?sslmode=require",
        "postgresql://u:p@10.0.0.5:5432/db",
        "postgresql://u:p@localhost.example.com:5432/db",
        "postgresql://u:p@db.internal:5432/db",
    ],
)
def test_refuses_non_local_url_before_connecting(app, url):
    result, log = run(app, url=url)
    assert result.returncode == 2
    assert "REFUSED" in result.stderr
    assert log == ""  # neither psql nor prisma ran


def test_accepts_loopback_forms(app):
    for host in ("127.0.0.1", "[::1]", "localhost"):
        result, _ = run(app, url=f"postgresql://postgres:{PASSWORD}@{host}:5432/x")
        assert result.returncode == 0, (host, result.stderr)


def test_password_never_in_argv_or_output(app):
    result, log = run(app)
    argv_lines = [line for line in log.splitlines() if line.startswith(("psql ", "prisma "))]
    assert argv_lines
    assert not any(PASSWORD in line for line in argv_lines)
    assert PASSWORD not in result.stdout + result.stderr
    # The password and the scratch URL reach the children through the environment only.
    assert f"PGPASSWORD_SEEN={PASSWORD}" in log
    assert "DATABASE_URL_SEEN=postgresql://postgres:" in log
    assert "/my_next_test" not in log  # the work database is never the one used


def test_env_file_url_is_used_when_no_override(app):
    root, _, _ = app
    (root / ".env.test").write_text(f'DATABASE_URL="postgresql://postgres:{PASSWORD}@localhost:5433/my_next_test"\n')
    result, log_text = run(app, url="")
    # An empty override falls back to the env file.
    assert result.returncode == 0, result.stderr
    assert ":5433" in log_text


def test_non_local_url_in_env_file_is_refused(app):
    root, _, _ = app
    (root / ".env.test").write_text('DATABASE_URL="postgresql://u:p@ep-x.neon.tech/db"\n')
    result, log = run(app, url="")
    assert result.returncode == 2
    assert "REFUSED" in result.stderr


def test_deploy_failure_fails(app):
    result, _ = run(app, deploy_rc="1")
    assert result.returncode == 1
    assert "do not apply" in result.stderr


@pytest.mark.parametrize("missing", ["prisma/migrations", "code_generator/.generated/json_schema.yaml"])
def test_preconditions_fail_closed(app, missing):
    root = app[0]
    target = root / missing
    if target.is_dir():
        target.rmdir()
    else:
        target.unlink()
    result, log = run(app)
    assert result.returncode == 2
    assert log == ""


def test_help_documents_limits_and_timing():
    result = subprocess.run(["bash", str(SCRIPT), "--help"], capture_output=True, text=True)
    assert result.returncode == 0
    for needle in ("What it prevents", "What it does NOT catch", "When to run it", "triggers", "loopback"):
        assert needle in result.stdout


def test_filter_splits_statements_and_ignores_comments():
    sql = '-- CreateEnum\nCREATE TYPE "A" AS ENUM (\'x\');\n\n-- AddColumn\nALTER TABLE "t"\n  ADD COLUMN "c" TEXT;\n'
    assert len(flt.split_statements(sql)) == 2


def test_filter_reports_stale_rules():
    uncovered, stale = flt.filter_statements('DROP TABLE "a";\n', ['DROP TABLE "a"', 'DROP TABLE "gone"'])
    assert uncovered == []
    assert stale == ['DROP TABLE "gone"']


def test_filter_rule_must_match_whole_identifier():
    uncovered, _ = flt.filter_statements('DROP TABLE "parent_only_2";\n', ['DROP TABLE "parent_only"'])
    assert len(uncovered) == 1
