"""
Regression tests for `generators_i18n._humanize_enum_value`.

Background
----------
Enum member names (the values stored in the DB / Prisma schema) are never
changed by this function — only the placeholder display label written into
messages/*.json. The label must split on BOTH PascalCase boundaries
(`TerminalRejected`) and underscores (`partially_received`), then Title
Case each resulting word, since nativeEnum members exist in both styles.
"""
from generators_i18n import _humanize_enum_value


def test_pascal_case_boundary_split():
    assert _humanize_enum_value("TerminalRejected") == "Terminal Rejected"


def test_single_lowercase_word_is_capitalized():
    assert _humanize_enum_value("approved") == "Approved"


def test_snake_case_split_and_title_cased():
    assert _humanize_enum_value("partially_received") == "Partially Received"


def test_idempotent_on_already_title_cased_input():
    assert _humanize_enum_value("Approved") == "Approved"


def test_snake_case_multi_word_all_lowercase():
    assert _humanize_enum_value("fully_matched") == "Fully Matched"


def test_pascal_case_multi_word():
    assert _humanize_enum_value("partially_matched") == "Partially Matched"
    assert _humanize_enum_value("fully_received") == "Fully Received"
