#!/usr/bin/env python3
"""Switch `x-generator.mobile.enabled` on in a schema file, in place.

Used by the `audit-mobile` CI job (.github/workflows/ci.yml) so the generated Expo
app is audited whatever the committed schema says. It works on the runner's
checkout only and handles the three states the committed schema can be in:

- no `mobile` key under `x-generator`: one is inserted;
- `mobile.enabled: false`: it is flipped to true;
- `mobile.enabled: true` already: the file is left unchanged.

The edit is textual so the rest of the file (comments, quoting, line breaks)
stays byte for byte. The result is then loaded with ruamel.yaml, the loader
`build_user_schema.py` uses, which rejects duplicate keys, and the run fails
unless `x-generator.mobile.enabled` is true.

Usage: python3 scripts/enable_mobile_generation.py code_generator/json_schema.yaml
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from ruamel.yaml import YAML

# The two line alternatives are disjoint (a line with a non-blank character vs. a
# whitespace-only line), so each line matches one way only: an overlapping pair
# backtracks exponentially on runs of blank lines (CodeQL py/redos).
_ENABLED_FALSE = re.compile(
    r"(?m)^(  mobile:[ \t]*\n(?:    [ \t]*\S.*\n|[ \t]*\n)*?    enabled:[ \t]*)false\b"
)


def _load(text: str):
    return YAML().load(text)


def _mobile(data) -> object:
    generator = data.get("x-generator") if data else None
    if not isinstance(generator, dict):
        raise SystemExit("no top-level x-generator block to enable mobile in")
    return generator.get("mobile")


def enable(text: str) -> str:
    mobile = _mobile(_load(text))
    if mobile is None:
        if not re.search(r"(?m)^x-generator:[ \t]*\n", text):
            raise SystemExit("x-generator is not a block mapping; cannot insert mobile")
        text = re.sub(r"(?m)^x-generator:[ \t]*\n",
                      "x-generator:\n  mobile:\n    enabled: true\n", text, count=1)
    elif isinstance(mobile, dict) and mobile.get("enabled") is True:
        return text
    else:
        text, count = _ENABLED_FALSE.subn(r"\1true", text, count=1)
        if count != 1:
            raise SystemExit(f"x-generator.mobile is {mobile!r}; cannot switch it on")

    mobile = _mobile(_load(text))  # ruamel raises DuplicateKeyError on a repeated key
    if not (isinstance(mobile, dict) and mobile.get("enabled") is True):
        raise SystemExit(f"x-generator.mobile.enabled is not true after the edit: {mobile!r}")
    return text


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    path = Path(argv[1])
    before = path.read_text(encoding="utf-8")
    after = enable(before)
    if after == before:
        print(f"{path}: x-generator.mobile.enabled is already true; unchanged")
    else:
        path.write_text(after, encoding="utf-8")
        print(f"{path}: x-generator.mobile.enabled switched on")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
