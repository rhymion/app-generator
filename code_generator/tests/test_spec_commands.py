"""
Tests for generators_test.gen_assert_commands() and gen_fill_commands().

Focuses on:
- Self-referencing FK fields use prop-stem dep var name for the expected value
  (e.g. parent_id → dep var 'parent' → 'Test Parent', not 'Test Procedure')
- Non-self-ref FK fields fall back to dep_target title when fk_dep_vars absent
- fill/assert symmetry: both functions apply fk_dep_vars the same way
"""
import pytest
from generators_test import gen_assert_commands, gen_fill_commands


# ---------------------------------------------------------------------------
# Minimal field-meta helpers
# ---------------------------------------------------------------------------

def _fk_field(prop_name: str, dep_target: str, label: str | None = None) -> dict:
    return {
        'prop_name': prop_name,
        'label': label or prop_name.replace('_id', '').replace('_', ' ').title(),
        'category': 'autocomplete',
        'dep_target': dep_target,
    }


def _text_field(prop_name: str, label: str | None = None) -> dict:
    return {
        'prop_name': prop_name,
        'label': label or prop_name.replace('_', ' ').title(),
        'category': 'text',
        'dep_target': None,
    }


# ---------------------------------------------------------------------------
# gen_assert_commands
# ---------------------------------------------------------------------------

class TestGenAssertCommandsSelfRefFK:
    """Self-ref FK (e.g. procedure.parent_id → procedure) must use prop-stem title."""

    def test_self_ref_fk_uses_prop_stem_title(self):
        fields = [_fk_field('parent_id', 'procedure', 'Parent')]
        fk_dep_vars = {'parent_id': 'parent'}
        cmds = gen_assert_commands(fields, 'Procedure', '  ', fk_dep_vars)
        assert cmds == ["  cy.checkField('Parent', 'Test Parent A');"]

    def test_self_ref_fk_without_dep_vars_falls_back_to_entity_title(self):
        fields = [_fk_field('parent_id', 'procedure', 'Parent')]
        cmds = gen_assert_commands(fields, 'Procedure', '  ', fk_dep_vars=None)
        # fallback: to_title_case(dep_target) = 'Procedure'
        assert cmds == ["  cy.checkField('Parent', 'Test Procedure A');"]

    def test_assignee_fk_uses_prop_stem_title(self):
        """assignee_id → user_account, but dep var is 'assignee' → 'Test Assignee A'."""
        fields = [_fk_field('assignee_id', 'user_account', 'Assignee')]
        fk_dep_vars = {'assignee_id': 'assignee'}
        cmds = gen_assert_commands(fields, 'Procedure', '  ', fk_dep_vars)
        assert cmds == ["  cy.checkField('Assignee', 'Test Assignee A');"]


class TestGenAssertCommandsNormalFK:
    """Normal FK (different entity, no renaming) still works correctly."""

    def test_normal_fk_with_dep_var_matching_stem(self):
        fields = [_fk_field('product_id', 'product', 'Product')]
        fk_dep_vars = {'product_id': 'product'}
        cmds = gen_assert_commands(fields, 'Order', '  ', fk_dep_vars)
        assert cmds == ["  cy.checkField('Product', 'Test Product A');"]

    def test_normal_fk_without_dep_vars_uses_target_title(self):
        fields = [_fk_field('product_id', 'product', 'Product')]
        cmds = gen_assert_commands(fields, 'Order', '  ')
        assert cmds == ["  cy.checkField('Product', 'Test Product A');"]

    def test_snake_case_target_titlecased(self):
        fields = [_fk_field('feature_story_id', 'feature_story', 'Feature Story')]
        cmds = gen_assert_commands(fields, 'Task', '  ')
        assert cmds == ["  cy.checkField('Feature Story', 'Test Feature Story A');"]

    def test_text_field_is_unaffected(self):
        fields = [_text_field('name', 'Name')]
        cmds = gen_assert_commands(fields, 'Procedure', '  ')
        assert cmds == ["  cy.checkField('Name', 'Test Procedure');"]


# ---------------------------------------------------------------------------
# fill/assert symmetry for self-ref FK
# ---------------------------------------------------------------------------

class TestFillAssertSymmetry:
    """gen_fill_commands and gen_assert_commands must agree on the dep var/title."""

    def test_fill_uses_same_dep_var_as_assert(self):
        fields = [_fk_field('parent_id', 'procedure', 'Parent')]
        fk_dep_vars = {'parent_id': 'parent'}
        fill_cmds = gen_fill_commands(fields, 'Procedure', '  ', fk_dep_vars)
        assert_cmds = gen_assert_commands(fields, 'Procedure', '  ', fk_dep_vars)
        # fill references deps.parent.name; assert expects 'Test Parent A'
        assert "deps.parent.name" in fill_cmds[0]
        assert "'Test Parent A'" in assert_cmds[0]
