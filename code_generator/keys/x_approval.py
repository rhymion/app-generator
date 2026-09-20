"""Centralized accessors for the `x-approval` custom schema key.

Before this module existed, every generator core file that inspects a
definition's `x-approval` block special-cased the literal key name and its
two default shapes (`None` vs `{}`) inline — validate.py, generate.py,
generators.py, and helpers/schema_helpers.py each wrote their own
`defn.get('x-approval')` (or `... or {}`) expression. That duplication is
axis A from the generator code/template scatter consolidation design
(app-generator Issue #693): `x-approval` was the highest-frequency
multi-file scatter cause among custom schema keys.

This module is the one place that knows the key's name and its two default
shapes; the files above call into it instead of special-casing the key
themselves. Every function here is a literal drop-in replacement for the
exact expression it replaces — no downstream logic (submit_on resolution,
set_fields resolution, dispatch-list building, etc.) moved here, so
generated output is unaffected by this extraction.
"""

KEY = 'x-approval'


def get(defn: dict):
    """Return `defn['x-approval']` verbatim (None if absent)."""
    return defn.get(KEY)


def get_or_empty(defn: dict) -> dict:
    """Return `defn['x-approval']`, or {} if absent/falsy."""
    return defn.get(KEY) or {}


def has(defn: dict) -> bool:
    """True if `defn` declares a truthy `x-approval` block."""
    return bool(defn.get(KEY))
