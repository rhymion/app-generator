"""Tests for helpers/naming.py — case conversion utilities."""
import pytest
from helpers.naming import (
    to_camel_case,
    to_pascal_case,
    to_pascal_case_from_var,
    to_title_case,
    safe_var_name,
    singularize,
)


class TestToCamelCase:
    def test_snake_to_camel(self):
        assert to_camel_case("user_name") == "userName"

    def test_single_word_unchanged(self):
        assert to_camel_case("name") == "name"

    def test_multiple_segments(self):
        assert to_camel_case("created_at_date") == "createdAtDate"

    def test_already_camel(self):
        # Treats existing camelCase as a single word segment
        assert to_camel_case("userName") == "userName"

    def test_empty_string(self):
        assert to_camel_case("") == ""


class TestToPascalCase:
    def test_snake_to_pascal(self):
        assert to_pascal_case("user_name") == "UserName"

    def test_single_word(self):
        assert to_pascal_case("name") == "Name"

    def test_multiple_segments(self):
        assert to_pascal_case("epic_detail") == "EpicDetail"

    def test_empty_string(self):
        assert to_pascal_case("") == ""


class TestToPascalCaseFromVar:
    def test_camel_to_pascal(self):
        assert to_pascal_case_from_var("userName") == "UserName"

    def test_already_pascal(self):
        assert to_pascal_case_from_var("UserName") == "UserName"

    def test_single_char(self):
        assert to_pascal_case_from_var("x") == "X"


class TestToTitleCase:
    def test_snake_to_title(self):
        assert to_title_case("user_name") == "User Name"

    def test_single_word(self):
        assert to_title_case("epic") == "Epic"

    def test_multiple_segments(self):
        assert to_title_case("created_at") == "Created At"


class TestSafeVarName:
    def test_normal_name_unchanged(self):
        assert safe_var_name("name") == "name"

    def test_reserved_word_delete(self):
        assert safe_var_name("delete") == "deleteValue"

    def test_reserved_word_default(self):
        assert safe_var_name("default") == "defaultValue"

    def test_reserved_word_return(self):
        assert safe_var_name("return") == "returnValue"

    def test_non_reserved_snake(self):
        # safe_var_name runs to_camel_case first, then checks reserved words
        assert safe_var_name("user_name") == "userName"


class TestSingularize:
    def test_removes_trailing_s(self):
        assert singularize("features") == "feature"

    def test_preserves_if_no_trailing_s(self):
        assert singularize("feature") == "feature"

    def test_snake_case_plural(self):
        assert singularize("shift_assignments") == "shift_assignment"

    def test_just_strips_trailing_s(self):
        # singularize strips the trailing 's' only — no -ies → -y conversion
        assert singularize("user_stories") == "user_storie"

    def test_preserves_pascal_case(self):
        assert singularize("Features") == "Feature"

    def test_empty_string(self):
        assert singularize("") == ""
