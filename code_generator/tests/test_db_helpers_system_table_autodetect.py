"""
Regression test for app-generator Issue #614.

db_helpers_context() (generators_test.py) derives resetTestDatabase()'s
deletion order from schema['definitions']. A hand-written base Prisma model
declared directly in prisma/schema.prisma — not in json_schema.yaml — is
structurally invisible to that graph. Before this fix, only two such names
(audit_log, mfa_recovery_code) were hardcoded into a `system_first` list;
a third (app_setting, added by the business-date-container feature) was
missed, and its rows were never cleaned up between test runs, blocking
every consumer's `user.deleteMany()` in the shared `before each` reset
hook once a row existed (`app_setting_creator_id_fkey`).

The fix generalizes detection via schema_deriver.parse_prisma_schema()
instead of extending the hardcoded list. This suite proves:

1. A hand-written leaf model referencing `user` (app_setting-shaped) is
   auto-scheduled, with no code change needed for its specific name.
2. Prisma delegate name casing is preserved for a PascalCase model name
   (Account -> `prisma.account`, not `prisma.Account`).
3. A hand-written model WITH an inbound reference from elsewhere in the
   schema (approvable-shaped, referenced by approval_request) is left
   alone rather than guessed at — the fail-closed case this mechanism
   explicitly declines to resolve.
4. Omitting `prisma_models` (existing callers/tests) reproduces the
   pre-fix behavior unchanged — no hand-written models are auto-detected.
"""
from pathlib import Path

from generators_test import db_helpers_context
from schema_deriver import parse_prisma_schema

_PRISMA_SCHEMA = """\
model user {
  id String @id @default(cuid())
}

// app_setting-shaped: hand-written, references user, nothing references it.
model app_setting {
  id         String @id @default(cuid())
  creator_id String
  creator    user   @relation(fields: [creator_id], references: [id])
}

// PascalCase hand-written model (NextAuth-style), same leaf shape.
model Account {
  id     String @id @default(cuid())
  userId String
  user   user   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// approvable-shaped: hand-written, references user, but IS referenced by
// approval_request below -- must NOT be auto-scheduled (fail-closed).
model approvable {
  id         String @id @default(cuid())
  creator_id String?
  creator    user?  @relation(fields: [creator_id], references: [id])
}

// A schema['definitions']-declared entity (see _schema() below) whose
// Prisma model references approvable -- the inbound reference that
// disqualifies approvable from auto-detection.
model approval_request {
  id            String     @id @default(cuid())
  approvable_id String
  approvable    approvable @relation(fields: [approvable_id], references: [id])
}
"""


def _schema() -> dict:
    """Minimal schema['definitions']: 'user' and 'approval_request' are
    declared (base_entities); 'app_setting', 'Account', and 'approvable'
    are deliberately absent -- exactly the proj_c shape Issue #614 hit."""
    return {
        'definitions': {
            'user': {
                'type': 'object',
                'properties': {'id': {'type': 'string'}},
            },
            'approval_request': {
                'type': 'object',
                'properties': {
                    'id': {'type': 'string'},
                    'approvable_id': {'type': 'string'},
                },
            },
        }
    }


def _prisma_models(tmp_path: Path) -> dict:
    schema_path = tmp_path / 'schema.prisma'
    schema_path.write_text(_PRISMA_SCHEMA, encoding='utf-8')
    return parse_prisma_schema(schema_path)


def _flatten(levels: list[list[str]]) -> list[str]:
    return [name for level in levels for name in level]


def test_hand_written_leaf_model_auto_scheduled(tmp_path: Path) -> None:
    """app_setting-shaped model: no json_schema.yaml entry, FK to user,
    nothing references it back -- must appear in deletion_levels."""
    ctx = db_helpers_context(_schema(), prisma_models=_prisma_models(tmp_path))
    assert 'app_setting' in _flatten(ctx['deletion_levels'])


def test_pascal_case_model_name_lowercased_for_prisma_delegate(tmp_path: Path) -> None:
    """Account (PascalCase in schema.prisma) must render as the actual
    Prisma Client delegate name `account`, not the literal `Account` --
    Prisma Client only ever lowercases the model name's first character."""
    ctx = db_helpers_context(_schema(), prisma_models=_prisma_models(tmp_path))
    flat = _flatten(ctx['deletion_levels'])
    assert 'account' in flat
    assert 'Account' not in flat


def test_hand_written_model_with_inbound_reference_left_untouched(tmp_path: Path) -> None:
    """approvable-shaped model: also hand-written and also FKs to user, but
    approval_request (a base_entities member) references IT back. Ordering
    it correctly relative to its own referencer is a separate, pre-existing
    question this mechanism has never answered -- it must stay excluded
    rather than be guessed at (fail-closed), exactly as it was before this
    fix (never previously scheduled at all)."""
    ctx = db_helpers_context(_schema(), prisma_models=_prisma_models(tmp_path))
    assert 'approvable' not in _flatten(ctx['deletion_levels'])


def test_leaf_model_scheduled_before_any_schema_driven_wave(tmp_path: Path) -> None:
    """Auto-detected system tables must be deleted before user (and before
    any wave that depends on user) -- inserted as the very first wave,
    matching the old hardcoded system_first's position exactly."""
    ctx = db_helpers_context(_schema(), prisma_models=_prisma_models(tmp_path))
    levels = ctx['deletion_levels']
    app_setting_level = next(i for i, lvl in enumerate(levels) if 'app_setting' in lvl)
    user_level = next(i for i, lvl in enumerate(levels) if 'user' in lvl)
    assert app_setting_level < user_level


def test_omitting_prisma_models_preserves_pre_fix_behavior(tmp_path: Path) -> None:
    """Existing callers/tests that never pass prisma_models (the pre-fix
    call shape) must see no hand-written system tables auto-detected --
    this mechanism is purely additive, opt-in via the new parameter."""
    ctx = db_helpers_context(_schema())
    flat = _flatten(ctx['deletion_levels'])
    assert 'app_setting' not in flat
    assert 'account' not in flat
    assert 'Account' not in flat
