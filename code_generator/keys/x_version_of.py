"""Accessors for the `x-version-of` custom schema key (identity + version
entities; see version_of.py). Same convention as keys/x_approval.py: the key
name is spelled in one place."""

KEY = 'x-version-of'


def get(defn: dict):
    """Return `defn['x-version-of']` verbatim (None if absent)."""
    return defn.get(KEY)


def has(defn: dict) -> bool:
    """True if `defn` declares the key at all (even with an invalid value)."""
    return KEY in defn
