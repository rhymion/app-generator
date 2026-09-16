#!/usr/bin/env python3
"""Sync consumer overrides from ../prj into this generator project.

For `messages/*.json`, the consumer's file is deep-merged into the
system default (consumer wins on key collision, arrays are replaced
wholesale). All other files are copied verbatim (`cp -a` equivalent),
preserving prior behavior exactly.

Path resolution is anchored on this file's own location
(`Path(__file__).resolve().parent.parent`), not on the invoking cwd.
This project is typically consumed as a git submodule with a sibling
`prj/` directory one level up (`<superproject>/app-generator` +
`<superproject>/prj`); anchoring on `__file__` guarantees the correct
sibling is found regardless of what cwd `npm run` happens to use.

Run from anywhere: `python3 scripts/prj_sync.py` (no arguments).
If `../prj` does not exist, this is a no-op.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRJ_DIR = PROJECT_ROOT.parent / "prj"


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


def prj_sync(prj_dir: Path, dst_dir: Path) -> None:
    if not prj_dir.is_dir():
        print("prj:sync: no ../prj, skipping")
        return

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
        else:
            shutil.copy2(src_file, dst_file)
            print(f"prj:sync: copied {rel}")


if __name__ == "__main__":
    prj_sync(PRJ_DIR, PROJECT_ROOT)
