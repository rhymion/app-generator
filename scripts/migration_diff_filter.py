#!/usr/bin/env python3
"""Filter the SQL printed by `prisma migrate diff --script` through an exceptions file.

Used by scripts/check-migrations-match-schema.sh.

Usage: migration_diff_filter.py DIFF_SQL [EXCEPTIONS_FILE]

Prints every statement of DIFF_SQL that no exception rule covers, one per block, to
stdout. Rules that matched nothing are reported on stderr (stale rules).

Exit code: 0 = no uncovered statement, 1 = at least one uncovered statement,
2 = unreadable input.

Exceptions file format: one rule per line. Blank lines and lines starting with `#` are
ignored. A rule is the beginning of a SQL statement; whitespace is collapsed and
case is significant. A statement is covered when it starts with a rule, for example

    DROP TABLE "legacy_orphan"
    ALTER TABLE "legacy_orphan" DROP CONSTRAINT
"""

import re
import sys
from pathlib import Path


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().rstrip(";").strip()


def split_statements(sql: str) -> list[str]:
    """Split Prisma's migrate-diff output into statements.

    Prisma prints one statement per block, each ending with a line that ends in `;`,
    with `-- ...` comment lines in between.
    """
    statements: list[str] = []
    current: list[str] = []
    for line in sql.splitlines():
        if not current and (not line.strip() or line.lstrip().startswith("--")):
            continue
        current.append(line)
        if line.rstrip().endswith(";"):
            statements.append("\n".join(current))
            current = []
    if current:
        statements.append("\n".join(current))
    return statements


def load_rules(text: str) -> list[str]:
    rules = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        rules.append(normalize(stripped))
    return rules


def filter_statements(sql: str, rules: list[str]) -> tuple[list[str], list[str]]:
    """Return (uncovered statements, rules that matched nothing)."""
    used: set[str] = set()
    uncovered: list[str] = []
    for statement in split_statements(sql):
        normalized = normalize(statement)
        matched = [rule for rule in rules if normalized.startswith(rule)]
        if matched:
            used.update(matched)
        else:
            uncovered.append(statement)
    return uncovered, [rule for rule in rules if rule not in used]


def main(argv: list[str]) -> int:
    if len(argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    try:
        sql = Path(argv[1]).read_text(encoding="utf-8")
        rules = []
        if len(argv) == 3 and Path(argv[2]).is_file():
            rules = load_rules(Path(argv[2]).read_text(encoding="utf-8"))
    except OSError as error:
        print(f"migration_diff_filter: {error}", file=sys.stderr)
        return 2
    uncovered, stale = filter_statements(sql, rules)
    for rule in stale:
        print(f"warning: exception rule matched nothing (remove it?): {rule}", file=sys.stderr)
    for statement in uncovered:
        print(statement)
        print()
    return 1 if uncovered else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
