#!/usr/bin/env python3
"""Sync consumer overrides from ../prj into this generator project.

For `messages/*.json`, the consumer's file is deep-merged into the
system default (consumer wins on key collision, arrays are replaced
wholesale). `prisma/schema.prisma` is guarded against silent model/field
loss (see `_diff_prisma_schema_drop` below -- Issue #646). All other
files are copied verbatim (`cp -a` equivalent), preserving prior
behavior exactly.

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

import json
import re
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRJ_DIR = PROJECT_ROOT.parent / "prj"

# Matches `model Name {` ... `}` blocks where the closing brace is alone on
# its own line at column 0 -- the convention this repo's own
# prisma/schema.prisma (and every generated consumer copy of it) always
# uses. Prisma schema models never nest braces inside their body (field
# attributes use parens, e.g. `@default(now())`), so this non-greedy scan
# is sufficient without a brace-depth counter.
_MODEL_RE = re.compile(r"^model\s+(\w+)\s*\{\n(.*?)^\}", re.MULTILINE | re.DOTALL)


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
    """
    if not dst_file.exists() or not src_file.exists():
        return []

    dst_models = _parse_prisma_models(dst_file.read_text(encoding="utf-8"))
    src_models = _parse_prisma_models(src_file.read_text(encoding="utf-8"))

    dropped: list[str] = []
    for model_name, dst_fields in sorted(dst_models.items()):
        if model_name not in src_models:
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


def prj_sync(prj_dir: Path, dst_dir: Path) -> int:
    """Run the sync. Returns 0 normally, 1 if any drop guard fired."""
    if not prj_dir.is_dir():
        print("prj:sync: no ../prj, skipping")
        return 0

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
                print(f"prj:sync: copied {rel}")
        else:
            shutil.copy2(src_file, dst_file)
            print(f"prj:sync: copied {rel}")

    return 1 if had_drop else 0


if __name__ == "__main__":
    sys.exit(prj_sync(PRJ_DIR, PROJECT_ROOT))
