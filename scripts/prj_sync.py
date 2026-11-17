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

npm dependencies a consumer's own code needs (e.g. an AI agent SDK used only by
that app) are declared in `prj/package.extra.json`
(docs/knowledge/prj-sync-package-extra.md).
Its `dependencies` / `devDependencies` are added to this project's
`package.json`, and `npm install` runs when that changed or an added package is
missing from `node_modules`. The file itself is never copied. A name the
generator already declares with a different version is refused (exit 1). The
entries a sync added are recorded in the manifest, so dropping one from
`package.extra.json` removes it from `package.json` on the next run, unless
`package.json` changed since that sync. `prj/package.json` and
`prj/package-lock.json` are refused: a verbatim copy would replace the
generator's own dependency list. See `PACKAGE_EXTRA_NAME` below.

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
fired (see below), or prj/package.extra.json could not be merged or installed -- this is intentional and relied on by
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
import subprocess
import sys
from collections.abc import Callable
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

# prj/package.extra.json: npm dependencies the consumer's own code needs that
# not every generated app should carry. Merged into package.json, never copied.
# Only these sections are accepted; a "//" key is allowed for a comment (the
# npm convention). See docs/knowledge/prj-sync-package-extra.md.
PACKAGE_EXTRA_NAME = "package.extra.json"
PACKAGE_EXTRA_SECTIONS = ("dependencies", "devDependencies")
# A verbatim copy of either would replace the generator's dependency list.
GENERATOR_OWNED_PACKAGE_FILES = frozenset({Path("package.json"), Path("package-lock.json")})
# npm package name: optional @scope/, lowercase, URL-safe characters.
_NPM_NAME_RE = re.compile(r"^(?:@[a-z0-9~-][a-z0-9._~-]*/)?[a-z0-9~-][a-z0-9._~-]*$")

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


def _load_manifest_package_extra(dst_dir: Path) -> dict:
    """Return the manifest's record of what the last sync added to package.json."""
    try:
        data = json.loads((dst_dir / MANIFEST_NAME).read_text(encoding="utf-8"))
        record = data.get("package_extra", {})
    except (OSError, ValueError, AttributeError):
        return {}
    if not isinstance(record, dict):
        return {}
    added = record.get("added", {})
    if not isinstance(added, dict):
        return {}
    clean = {
        section: {k: v for k, v in names.items() if isinstance(k, str) and isinstance(v, str)}
        for section, names in added.items()
        if section in PACKAGE_EXTRA_SECTIONS and isinstance(names, dict)
    }
    sha = record.get("package_json_sha256")
    return {"package_json_sha256": sha if isinstance(sha, str) else None, "added": clean}


def _write_manifest(dst_dir: Path, files: dict[str, str], package_extra: dict | None = None) -> None:
    payload: dict = {"version": 1, "files": dict(sorted(files.items()))}
    if package_extra:
        payload["package_extra"] = package_extra
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


def _load_package_extra(src_file: Path) -> tuple[dict[str, dict[str, str]], list[str]]:
    """Parse prj/package.extra.json. Returns ({section: {name: spec}}, errors)."""
    extras: dict[str, dict[str, str]] = {section: {} for section in PACKAGE_EXTRA_SECTIONS}
    try:
        data = json.loads(src_file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return extras, [f"cannot read prj/{PACKAGE_EXTRA_NAME}: {e}"]
    if not isinstance(data, dict):
        return extras, [f"prj/{PACKAGE_EXTRA_NAME}: top-level JSON must be an object"]

    errors: list[str] = []
    for key, value in data.items():
        if key == "//":
            continue
        if key not in PACKAGE_EXTRA_SECTIONS:
            errors.append(
                f"prj/{PACKAGE_EXTRA_NAME}: unsupported key {key!r} "
                f"(allowed: {', '.join(PACKAGE_EXTRA_SECTIONS)})"
            )
            continue
        if not isinstance(value, dict):
            errors.append(f"prj/{PACKAGE_EXTRA_NAME}: {key} must be an object of name -> version")
            continue
        for name, spec in value.items():
            if not _NPM_NAME_RE.match(name) or len(name) > 214:
                errors.append(f"prj/{PACKAGE_EXTRA_NAME}: {key}: invalid package name {name!r}")
            elif not isinstance(spec, str) or not spec.strip():
                errors.append(f"prj/{PACKAGE_EXTRA_NAME}: {key}.{name}: version must be a non-empty string")
            else:
                extras[key][name] = spec
    both = set(extras["dependencies"]) & set(extras["devDependencies"])
    for name in sorted(both):
        errors.append(f"prj/{PACKAGE_EXTRA_NAME}: {name} is listed in both dependencies and devDependencies")
    return extras, errors


def _run_npm_install(dst_dir: Path) -> int:
    print("prj:sync: running npm install (package.json dependencies changed)")
    try:
        return subprocess.run(
            ["npm", "install", "--include=dev", "--no-audit", "--no-fund"], cwd=dst_dir, check=False
        ).returncode
    except OSError as e:
        print(f"prj:sync: ERROR could not run npm: {e}", file=sys.stderr)
        return 1


def _sync_package_extra(
    prj_dir: Path,
    dst_dir: Path,
    previous: dict,
    npm_install: Callable[[Path], int],
) -> tuple[dict, bool]:
    """Merge prj/package.extra.json into package.json. Returns (manifest record, ok).

    First the entries the previous sync added are taken out again, but only
    while package.json still hashes to what that sync wrote; a package.json
    replaced since (a submodule update, a hand edit) is left as it is, with a
    warning for an entry the consumer no longer lists. Then the current
    entries are added. A name the generator already declares is left alone
    when the version matches and refused otherwise, since the generator's own
    code was built and tested against its version.
    """
    src_file = prj_dir / PACKAGE_EXTRA_NAME
    prev_added: dict[str, dict[str, str]] = previous.get("added", {}) if previous else {}
    if not src_file.is_file() and not any(prev_added.values()):
        return {}, True

    pkg_path = dst_dir / "package.json"
    if not pkg_path.is_file():
        print(f"prj:sync: ERROR prj/{PACKAGE_EXTRA_NAME} given but {pkg_path} does not exist", file=sys.stderr)
        return previous, False

    extras: dict[str, dict[str, str]] = {section: {} for section in PACKAGE_EXTRA_SECTIONS}
    if src_file.is_file():
        extras, errors = _load_package_extra(src_file)
        if errors:
            for err in errors:
                print(f"prj:sync: ERROR {err}", file=sys.stderr)
            print("prj:sync: ERROR package.json left unchanged", file=sys.stderr)
            # Keep the previous record so a later, valid run can still revert it.
            return previous, False

    try:
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"prj:sync: ERROR cannot read package.json: {e}", file=sys.stderr)
        return previous, False
    original = json.loads(json.dumps(pkg))
    ours = previous.get("package_json_sha256") == _sha256(pkg_path)

    for section, names in sorted(prev_added.items()):
        current = pkg.get(section, {})
        for name, spec in sorted(names.items()):
            if current.get(name) != spec:
                continue
            if ours:
                del current[name]
                if name not in extras.get(section, {}):
                    print(f"prj:sync: removed {section} {name} (no longer in prj/{PACKAGE_EXTRA_NAME})")
            elif name not in extras.get(section, {}):
                print(
                    f"prj:sync: WARNING kept {section} {name} in package.json (removed from "
                    f"prj/{PACKAGE_EXTRA_NAME}, but package.json changed since the last sync; "
                    "delete it by hand if it is stale)",
                    file=sys.stderr,
                )

    ok = True
    added: dict[str, dict[str, str]] = {}
    for section in PACKAGE_EXTRA_SECTIONS:
        other = next(s for s in PACKAGE_EXTRA_SECTIONS if s != section)
        for name, spec in sorted(extras[section].items()):
            if name in pkg.get(other, {}):
                ok = False
                print(
                    f"prj:sync: ERROR prj/{PACKAGE_EXTRA_NAME} lists {name} under {section}, "
                    f"but package.json already declares it under {other}; remove it from "
                    f"prj/{PACKAGE_EXTRA_NAME}",
                    file=sys.stderr,
                )
                continue
            target = pkg.setdefault(section, {})
            current_spec = target.get(name)
            if current_spec is None:
                target[name] = spec
                added.setdefault(section, {})[name] = spec
                print(f"prj:sync: added {section} {name}@{spec} (prj/{PACKAGE_EXTRA_NAME})")
            elif current_spec != spec:
                ok = False
                print(
                    f"prj:sync: ERROR prj/{PACKAGE_EXTRA_NAME} wants {section} {name}@{spec}, "
                    f"but the generator already declares {name}@{current_spec}; the generator's "
                    f"version is kept. Use it (or drop {name} from prj/{PACKAGE_EXTRA_NAME}), or "
                    "change the version in app-generator itself",
                    file=sys.stderr,
                )
            else:
                print(f"prj:sync: {section} {name}@{spec} already in package.json, left as is")
        if section in pkg:
            pkg[section] = dict(sorted(pkg[section].items()))

    changed = pkg != original
    if changed:
        tmp = pkg_path.with_name(pkg_path.name + ".tmp")
        # npm's own package.json format (2-space indent, trailing newline).
        tmp.write_text(json.dumps(pkg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp.replace(pkg_path)
        print("prj:sync: merged package.json")

    missing = [
        name
        for names in added.values()
        for name in names
        if not (dst_dir / "node_modules" / name / "package.json").is_file()
    ]
    if changed or missing:
        rc = npm_install(dst_dir)
        if rc != 0:
            ok = False
            print(f"prj:sync: ERROR npm install failed (exit {rc})", file=sys.stderr)

    record = (
        {"package_json_sha256": _sha256(pkg_path), "added": added} if any(added.values()) else {}
    )
    return record, ok


def prj_sync(
    prj_dir: Path,
    dst_dir: Path,
    npm_install: Callable[[Path], int] = _run_npm_install,
) -> int:
    """Run the sync. Returns 0 normally, 1 if any drop guard or dependency check fired."""
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

        if rel == Path(PACKAGE_EXTRA_NAME):
            continue  # merged into package.json below, never copied
        if rel in GENERATOR_OWNED_PACKAGE_FILES:
            had_drop = True
            print(
                f"prj:sync: ERROR prj/{rel} SKIPPED -- copying it would replace the "
                f"generator's own dependencies. Declare the packages your code needs in "
                f"prj/{PACKAGE_EXTRA_NAME} instead and remove prj/{rel}.",
                file=sys.stderr,
            )
            continue
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

    package_extra, package_ok = _sync_package_extra(
        prj_dir, dst_dir, _load_manifest_package_extra(dst_dir), npm_install
    )
    _write_manifest(dst_dir, copied, package_extra)
    _write_excluded_tests(prj_dir, dst_dir)
    return 1 if had_drop or not package_ok else 0


if __name__ == "__main__":
    sys.exit(prj_sync(PRJ_DIR, PROJECT_ROOT))
