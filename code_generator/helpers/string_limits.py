"""Server-side maximum length for string fields (Issue #1273, ASVS V1.3.3).

Every writable string field is length-checked on the server: the schema's
`maxLength` when the author declared one, otherwise DEFAULT_STRING_MAX_LENGTH.
There is no opt-out. Lengths count Unicode code points, as JSON Schema's
`maxLength` does. See docs/knowledge/input-validation-rules-and-limits.md.
"""

DEFAULT_STRING_MAX_LENGTH = 65535


def _base_types(defn: dict) -> list[str]:
    types = defn.get('type', 'string')
    if isinstance(types, str):
        types = [types]
    return [t for t in types if t != 'null']


def is_length_checked_string(defn: dict) -> bool:
    """True for a plain string column (decimal-backed strings have their own format check)."""
    if defn.get('_prisma_decimal_type'):
        return False
    base = _base_types(defn)
    return bool(base) and base[0] == 'string'


def string_max_length(defn: dict) -> int:
    """The declared `maxLength`, or the default cap when none is declared."""
    declared = defn.get('maxLength')
    if isinstance(declared, int) and not isinstance(declared, bool) and declared > 0:
        return declared
    return DEFAULT_STRING_MAX_LENGTH
