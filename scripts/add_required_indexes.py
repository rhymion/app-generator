#!/usr/bin/env python3
"""Idempotently add @@index([col]) for required hot columns in prisma/schema.prisma.

Required columns: creator_id, assignee_id, organization_id.
Run from the repo root: `python3 scripts/add_required_indexes.py`.

Re-running is a no-op if all required indexes are already present.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REQUIRED_COLUMNS = ("creator_id", "assignee_id", "organization_id")
SCHEMA_PATH = Path("prisma/schema.prisma")


def find_model_blocks(text: str) -> list[tuple[int, int, str]]:
    """Return [(start, end, block_text)] for each top-level `model X { ... }`."""
    out: list[tuple[int, int, str]] = []
    i = 0
    pattern = re.compile(r"^model\s+(\w+)\s*\{", re.MULTILINE)
    for m in pattern.finditer(text):
        # Find matching closing brace, accounting for nested braces (rare in Prisma).
        depth = 1
        j = m.end()
        while j < len(text) and depth > 0:
            ch = text[j]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            j += 1
        if depth != 0:
            raise RuntimeError(f"Unbalanced braces starting at {m.start()}")
        out.append((m.start(), j, text[m.start():j]))
        i = j
    return out


def existing_indexed_columns(block: str) -> set[str]:
    """Columns that appear as the LEFTMOST column of some @@index([...]).

    Matches the rule enforced by code_generator/validate.py — only the leading
    column of a composite index is usable for single-column lookups in
    Postgres, so trailing positions don't count as 'indexed' here.
    """
    cols: set[str] = set()
    for decl in re.findall(r"@@index\(\s*\[([^\]]+)\]", block):
        first = decl.split(",", 1)[0].strip()
        if first:
            cols.add(first)
    return cols


def has_column(block: str, col: str) -> bool:
    # Match `<col>` followed by whitespace and a type — i.e. the field declaration line.
    return bool(re.search(rf"^\s*{re.escape(col)}\s+\S", block, re.MULTILINE))


def patch_block(block: str) -> tuple[str, list[str]]:
    """Insert missing @@index([col]) lines just before the closing `}`."""
    indexed = existing_indexed_columns(block)
    additions: list[str] = []
    for col in REQUIRED_COLUMNS:
        if has_column(block, col) and col not in indexed:
            additions.append(f"  @@index([{col}])")
    if not additions:
        return block, []

    # Find the last `}` and insert before it, preserving any prior trailing newline.
    close_idx = block.rfind("}")
    head = block[:close_idx].rstrip("\n")
    tail = block[close_idx:]
    new_block = head + "\n" + "\n".join(additions) + "\n" + tail
    return new_block, additions


def main() -> int:
    if not SCHEMA_PATH.exists():
        print(f"error: {SCHEMA_PATH} not found (run from repo root)", file=sys.stderr)
        return 2
    text = SCHEMA_PATH.read_text()

    blocks = find_model_blocks(text)
    # Apply patches from the end to keep earlier offsets valid.
    out = text
    total_added = 0
    summary: list[str] = []
    for start, end, block in reversed(blocks):
        new_block, additions = patch_block(block)
        if additions:
            out = out[:start] + new_block + out[end:]
            total_added += len(additions)
            name = re.match(r"model\s+(\w+)", block).group(1)
            for a in additions:
                summary.append(f"  {name}: {a.strip()}")

    if total_added == 0:
        print("schema.prisma already has all required indexes; no changes.")
        return 0

    SCHEMA_PATH.write_text(out)
    print(f"Added {total_added} index declaration(s):")
    for line in summary:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
