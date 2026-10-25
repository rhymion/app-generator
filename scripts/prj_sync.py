#!/usr/bin/env python3
"""Sync consumer overrides from ../prj into this generator project.

For `messages/*.json`, the consumer's file is deep-merged into the
system default (consumer wins on key collision, arrays are replaced
wholesale). `prisma/schema.prisma` is guarded against silent model/field
loss (see `_diff_prisma_schema_drop` below -- Issue #646). All other
files are copied verbatim (`cp -a` equivalent), preserving prior
behavior exactly.

Renames and deletions inside `prj/` are followed (Issue #619): every verbatim
copy is recorded in `.prj-sync-manifest.json` (path -> sha256 of the copied
file). On the next run, a recorded destination whose source is gone from
`prj/` is removed, but only while its content still hashes to the recorded
value. A file that generate-code or a person changed since the sync is left in
place with a warning, and a file this sync never copied is never touched.
`messages/*.json` are merged into generator defaults, so they are never
removed. A destination copied before the manifest existed is not tracked until
the next sync rewrites it.

A generator unit test that exercises a script a consumer may replace is not
carried into the consumer's vitest run when the consumer replaces that script
without shipping its own test for it (Issue #1070). See
`GENERATOR_TESTS_OF_OVERRIDABLE_SCRIPTS` and `EXCLUDED_TESTS_NAME` below.

Path resolution is anchored on this file's own location
(`Path(__file__).resolve().parent.parent`), not on the invoking cwd.
This project is typically consumed as a git submodule with a sibling
`prj/` directory one level up (`<superproject>/app-generator` +
`<superproject>/prj`); anchoring on `__file__` guarantees the correct
sibling is found regardless of what cwd `npm run` happens to use.

Run from anywhere: `python3 scripts/prj_sync.py` (no arguments).
If `../prj` does not exist, this is a no-op.

Exit code: 0 normally. Non-zero if the `prisma/schema.prisma` drop guard
fired (see below) -- this is intentional and relied on by
`lint_prj_synced.py` (fail-closed on non-zero) and the `vercel-build`
`run-s` chain (which stops at the first failing step), so a detected
drop halts the pipeline before generate-code/build run against a
schema that just silently lost generator-side content.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRJ_DIR = PROJECT_ROOT.parent / "prj"

# Records which destination files a previous run copied verbatim from prj/
# (path -> sha256), so a later run can remove the ones whose source is gone
# (Issue #619). Gitignored: it describes this checkout's own sync history.
MANIFEST_NAME = ".prj-sync-manifest.json"

# Generator unit tests that assert the contract of one specific generator
# script (script -> its test). When prj/ replaces the script, the generator
# test would run against the consumer's variant and fail on a contract the
# consumer deliberately does not follow (Issue #1070). The sync therefore
# lists the test in EXCLUDED_TESTS_NAME, which vitest.config.ts reads, unless
# prj/ also ships a test of its own for that script. The list is rewritten on
# every sync, so removing the override from prj/ brings the generator test
# back on the next run. Gitignored: it describes this checkout's own sync.
GENERATOR_TESTS_OF_OVERRIDABLE_SCRIPTS = {
    "scripts/grant-all-permissions.ts": "scripts/grant-all-permissions.test.ts",
}
EXCLUDED_TESTS_NAME = ".prj-sync-excluded-tests.json"

# Matches `model Name {` ... `}` blocks where the closing brace is alone on
# its own line at column 0 -- the convention this repo's own
# prisma/schema.prisma (and every generated consumer copy of it) always
# uses. Prisma schema models never nest braces inside their body (field
# attributes use parens, e.g. `@default(now())`), so this non-greedy scan
# is sufficient without a brace-depth counter.
_MODEL_RE = re.compile(r"^model\s+(\w+)\s*\{\n(.*?)^\}", re.MULTILINE | re.DOTALL)


# Models that generate.py itself appends to prisma/schema.prisma on every
# run (inject_scheduled_task_run_into_schema, inject_payable_into_schema).
# They exist in the generator's schema only because a previous generate-code
# wrote them there, and the next generate-code writes them again, so a
# consumer snapshot that lacks one is not a drop: the guard must not demand a
# manual mirror of it (Issue #786). Kept in step with generate.py by
# code_generator/tests/test_prj_sync_schema_drop_guard.py.
GENERATOR_INJECTED_MODELS = frozenset({"scheduled_task_run", "payable"})


def _parse_prisma_models(text: str) -> dict[str, set[str]]:
    """Return {model_name: {field_name, ...}} for each `model X { ... }` block.

    A field name is the first whitespace-delimited token of each non-blank
    body line, skipping `//`/`///` comments and `@@...` block-attribute
    lines (@@index, @@unique, @@map, ...). Good enough to name what a
    sync would drop; it does not need to understand full Prisma grammar.
    """
    models: dict[str, set[str]] = {}
    for match in _MODEL_RE.finditer(text):
        name = match.group(1)
        fields: set[str] = set()
        for line in match.group(2).splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("//") or stripped.startswith("@@"):
                continue
            fields.add(stripped.split()[0])
        models[name] = fields
    return models


def _diff_prisma_schema_drop(dst_file: Path, src_file: Path) -> list[str]:
    """List `model` / `model.field` entries dst_file has that src_file lacks.

    Direction matters: this only flags loss in the dst -> src direction
    (content the generator currently has that the incoming consumer copy
    would erase by overwriting it). Content present only in src (a
    consumer's own model, or a field the consumer added to a shared
    model) is never flagged -- that is the consumer's own customization
    flowing in as designed, not a drop, and boundaries for this task
    (#646) require it never be treated as one.

    This is a heuristic, not a certainty: a dropped entry usually means
    the consumer's prj/prisma/schema.prisma predates a generator-side
    addition (the f06d2a0b shape -- idempotency_key model,
    user.api_key_expires_at field), but it could in principle also be an
    intentional removal the consumer made on purpose. The guard cannot
    tell those apart from file content alone, so it surfaces every case
    for a human to confirm rather than silently choosing either
    interpretation.

    One exception: a model in GENERATOR_INJECTED_MODELS that the consumer
    copy lacks entirely is not reported, because generate-code appends it
    again after the sync (Issue #786). A consumer copy that does carry such
    a model is still compared field by field like any other.
    """
    if not dst_file.exists() or not src_file.exists():
        return []

    dst_models = _parse_prisma_models(dst_file.read_text(encoding="utf-8"))
    src_models = _parse_prisma_models(src_file.read_text(encoding="utf-8"))

    dropped: list[str] = []
    for model_name, dst_fields in sorted(dst_models.items()):
        if model_name not in src_models:
            if model_name in GENERATOR_INJECTED_MODELS:
                continue
            dropped.append(f"model {model_name}")
            continue
        for field in sorted(dst_fields - src_models[model_name]):
            dropped.append(f"{model_name}.{field}")
    return dropped


def deep_merge(system: dict, consumer: dict) -> dict:
    """Merge consumer into system: consumer wins on collision, dicts recurse, arrays replace."""
    result = dict(system)
    for key, consumer_val in consumer.items():
        system_val = result.get(key)
        if isinstance(system_val, dict) and isinstance(consumer_val, dict):
            result[key] = deep_merge(system_val, consumer_val)
        else:
            result[key] = consumer_val
    return result


def _sync_messages_json(src_file: Path, dst_file: Path, rel: Path) -> None:
    if not dst_file.exists():
        # dst has no system default for this file: consumer content stands alone.
        shutil.copy2(src_file, dst_file)
        print(f"prj:sync: copied (new) {rel}")
        return

    try:
        with dst_file.open(encoding="utf-8") as f:
            system_data = json.load(f)
        with src_file.open(encoding="utf-8") as f:
            consumer_data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"prj:sync: WARNING skipping {rel} (invalid JSON: {e})", file=sys.stderr)
        return

    if not isinstance(system_data, dict) or not isinstance(consumer_data, dict):
        print(f"prj:sync: WARNING skipping {rel} (top-level JSON must be an object)", file=sys.stderr)
        return

    merged = deep_merge(system_data, consumer_data)
    # Matches generators_i18n.py's _update_json() write format exactly, to avoid
    # spurious diffs on the next generate-code run.
    with dst_file.open("w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"prj:sync: merged {rel}")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_manifest(dst_dir: Path) -> dict[str, str]:
    try:
        data = json.loads((dst_dir / MANIFEST_NAME).read_text(encoding="utf-8"))
        files = data["files"]
    except (OSError, ValueError, KeyError, TypeError):
        return {}
    if not isinstance(files, dict):
        return {}
    return {k: v for k, v in files.items() if isinstance(k, str) and isinstance(v, str)}


def _write_manifest(dst_dir: Path, files: dict[str, str]) -> None:
    payload = {"version": 1, "files": dict(sorted(files.items()))}
    tmp = dst_dir / (MANIFEST_NAME + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(dst_dir / MANIFEST_NAME)


def _remove_stale(prj_dir: Path, dst_dir: Path, previous: dict[str, str]) -> None:
    """Remove destinations a previous run copied whose prj/ source no longer exists.

    A file left in place because it changed since the sync is dropped from the
    manifest by the caller's rewrite, so a later run never deletes it.
    """
    root = dst_dir.resolve()
    for rel_str, recorded in sorted(previous.items()):
        rel = Path(rel_str)
        if rel.is_absolute() or ".." in rel.parts or rel_str == MANIFEST_NAME:
            continue
        if (prj_dir / rel).exists():
            continue
        dst_file = dst_dir / rel
        if not dst_file.is_file() or dst_file.is_symlink():
            continue
        if not dst_file.resolve().is_relative_to(root):
            continue
        if _sha256(dst_file) != recorded:
            print(
                f"prj:sync: WARNING kept {rel} (removed from prj/, but it changed "
                "since the last sync; delete it by hand if it is stale)",
                file=sys.stderr,
            )
            continue
        dst_file.unlink()
        print(f"prj:sync: removed {rel} (no longer in prj/)")
        parent = dst_file.parent
        while parent != root and parent.is_relative_to(root):
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent


def _write_excluded_tests(prj_dir: Path, dst_dir: Path) -> None:
    """List generator tests whose script prj/ replaces without its own test."""
    excluded = [
        test
        for script, test in sorted(GENERATOR_TESTS_OF_OVERRIDABLE_SCRIPTS.items())
        if (prj_dir / script).is_file() and not (prj_dir / test).is_file()
    ]
    payload = {"version": 1, "tests": excluded}
    tmp = dst_dir / (EXCLUDED_TESTS_NAME + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(dst_dir / EXCLUDED_TESTS_NAME)
    for test in excluded:
        print(f"prj:sync: generator test {test} excluded (prj/ replaces its script)")


def prj_sync(prj_dir: Path, dst_dir: Path) -> int:
    """Run the sync. Returns 0 normally, 1 if any drop guard fired."""
    if not prj_dir.is_dir():
        print("prj:sync: no ../prj, skipping")
        return 0

    _remove_stale(prj_dir, dst_dir, _load_manifest(dst_dir))
    copied: dict[str, str] = {}
    had_drop = False
    for src_file in sorted(prj_dir.rglob("*")):
        if not src_file.is_file():
            continue
        rel = src_file.relative_to(prj_dir)
        dst_file = dst_dir / rel
        dst_file.parent.mkdir(parents=True, exist_ok=True)

        if rel.parts[0] == "messages" and src_file.suffix == ".json":
            _sync_messages_json(src_file, dst_file, rel)
        elif rel == Path("vercel.json"):
            # cmd_781: vercel.json's `crons` key is now written by generate.py
            # from x-scheduled-task declarations. A prj/vercel.json copy
            # (the pre-cmd_781 convention) would verbatim-overwrite that
            # generated key on every sync, silently reverting it to whatever
            # was true when the consumer last copied the file — remove
            # prj/vercel.json; it is no longer needed or read.
            print(f"prj:sync: SKIPPED {rel} (generator-owned since cmd_781 — remove this file from prj/)")
        elif rel == Path("prisma/schema.prisma"):
            dropped = _diff_prisma_schema_drop(dst_file, src_file)
            if dropped:
                had_drop = True
                print(
                    f"prj:sync: ERROR {rel} sync SKIPPED -- consumer's prj/{rel} "
                    f"is missing generator-side content that would be silently "
                    f"dropped by overwriting: {', '.join(dropped)}. This usually "
                    f"means prj/{rel} predates a generator-side addition (Issue "
                    f"#646, the f06d2a0b shape). Mirror the missing model/field "
                    f"into prj/{rel} (see app-template PR#123 for the pattern), "
                    "then re-run prj:sync.",
                    file=sys.stderr,
                )
                # Leave dst_file as-is (the newer generator content) rather
                # than overwrite it with the stale consumer copy -- "zero
                # diff" for this file, not a silent loss.
            else:
                shutil.copy2(src_file, dst_file)
                copied[rel.as_posix()] = _sha256(dst_file)
                print(f"prj:sync: copied {rel}")
        else:
            shutil.copy2(src_file, dst_file)
            copied[rel.as_posix()] = _sha256(dst_file)
            print(f"prj:sync: copied {rel}")

    _write_manifest(dst_dir, copied)
    _write_excluded_tests(prj_dir, dst_dir)
    return 1 if had_drop else 0


if __name__ == "__main__":
    sys.exit(prj_sync(PRJ_DIR, PROJECT_ROOT))
