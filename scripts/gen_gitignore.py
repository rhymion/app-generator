#!/usr/bin/env python3
"""
gen_gitignore.py: .generated-manifest.json から .gitignore の生成ファイルセクションを自動生成する。
Usage: python3 scripts/gen_gitignore.py [--dry-run]
"""
import json
import sys
import yaml
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
MANIFEST_PATH = REPO_ROOT / ".generated-manifest.json"
SCHEMA_PATH = REPO_ROOT / "code_generator" / "json_schema.yaml"
GITIGNORE_PATH = REPO_ROOT / ".gitignore"
BEGIN_MARKER = "# BEGIN GENERATED FILES (auto-updated by scripts/gen_gitignore.py)"
END_MARKER = "# END GENERATED FILES"


def get_manifest_paths():
    with open(MANIFEST_PATH) as f:
        m = json.load(f)
    return [e["path"] for e in m["files"]]


def get_entity_names():
    with open(SCHEMA_PATH) as f:
        schema = yaml.safe_load(f)
    return list(schema.get("definitions", {}).keys())


def get_cleanup_patterns(entities):
    """manifest未掲載の生成物パターン (cleanup.pyが管理するファイル群)"""
    patterns = []
    for entity in entities:
        patterns.append(f"cypress/e2e/{entity}.cy.ts")
        patterns.append(f"cypress/e2e/mobile/{entity}.cy.ts")
        patterns.append(f"cypress/e2e/api/{entity}.cy.ts")
        patterns.append(f"cypress/support/{entity}/helper.ts")
    return patterns


def update_gitignore(entries, dry_run=False):
    content = GITIGNORE_PATH.read_text()
    begin_idx = content.find(BEGIN_MARKER)
    end_idx = content.find(END_MARKER)

    section = BEGIN_MARKER + "\n"
    for e in sorted(set(entries)):
        section += e + "\n"
    section += END_MARKER

    if begin_idx == -1:
        # セクションなし → ファイル末尾に追加
        new_content = content.rstrip() + "\n\n" + section + "\n"
    else:
        new_content = content[:begin_idx] + section + content[end_idx + len(END_MARKER):]

    if dry_run:
        print("=== DRY RUN: .gitignore に追加されるエントリ ===")
        for e in sorted(set(entries)):
            print(f"  {e}")
        print(f"合計 {len(set(entries))} 件")
    else:
        GITIGNORE_PATH.write_text(new_content)
        print(f"✓ .gitignore 更新完了 ({len(set(entries))} エントリ)")


def main():
    dry_run = "--dry-run" in sys.argv

    manifest_paths = get_manifest_paths()
    print(f"manifest paths: {len(manifest_paths)}")

    entities = get_entity_names()
    print(f"schema entities: {len(entities)}")

    cleanup_patterns = get_cleanup_patterns(entities)
    all_entries = manifest_paths + cleanup_patterns
    print(f"total entries: {len(set(all_entries))}")

    update_gitignore(all_entries, dry_run=dry_run)


if __name__ == "__main__":
    main()
