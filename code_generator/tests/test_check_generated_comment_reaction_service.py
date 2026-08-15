"""Regression tests for cmd_705 (subtask_705b): check_generated.py's
write:direct rule against comment/reaction writes.

Before this fix, add/update/delete{Parent}Comment and
toggle{Parent}CommentReaction (build_context.py's
_build_comment_actions_bridge, and comment_reactions_api_route.ts.jinja2)
wrote `prisma.comment.*` / `prisma.reaction.*` directly from a file that is
not a service layer (`lib/<parent>/actions.ts`, and the schema-wide
reactions API route) — comment/reaction have no x-generate, so no
`lib/comment/service.ts` / `lib/reaction/service.ts` existed for them to
route through. Measured on proj_c (subtask_702a): 5 violations. See
docs/knowledge/schema-yaml-configuration.md §"x-internal at the entity
level" for the comment/reaction schema shape this reproduces.

These tests stand up the same synthetic-tree harness as
test_check_generated.py, but with a `reaction` x-internal entity present
(so `named_constants` is non-empty and check_generated.py's
`_bespoke_reaction_files()` gate — mirroring generate.py's own gate —
fires), and a `lib/<parent>/actions.ts` whose content is a literal
before/after snapshot of the real generated bridge code.
"""
from __future__ import annotations

from pathlib import Path
from textwrap import dedent

from check_generated import check


_SCHEMA_NO_REACTION = dedent("""
    $schema: "http://json-schema.org/draft-07/schema#"
    definitions:
      __widget:
        type: object
        required: [id, name]
        properties:
          id:
            type: string
            pattern: "^c[a-z0-9]{24,}$"
          name:
            type: string
        x-generate:
          list: true
          view: true
          new: true
          edit: true
          delete: true
          api: true
""").lstrip()

_SCHEMA_WITH_REACTION = dedent("""
    $schema: "http://json-schema.org/draft-07/schema#"
    definitions:
      __widget:
        type: object
        required: [id, name]
        properties:
          id:
            type: string
            pattern: "^c[a-z0-9]{24,}$"
          name:
            type: string
        x-generate:
          list: true
          view: true
          new: true
          edit: true
          delete: true
          api: true
      comment:
        type: object
        required: [id, message]
        properties:
          id:
            type: string
            pattern: "^c[a-z0-9]{24,}$"
          message:
            type: string
      reaction:
        type: object
        required: [id, comment_id, user_id, type]
        x-internal:
          page: false
          embed: false
          api: custom
        properties:
          id:
            type: string
            pattern: "^c[a-z0-9]{24,}$"
          comment_id:
            type: string
            pattern: "^c[a-z0-9]{24,}$"
          user_id:
            type: string
            pattern: "^c[a-z0-9]{24,}$"
          type:
            type: integer
            minimum: 0
            maximum: 4
            enum: [Like, Love, Laugh, Surprised, Sad]
""").lstrip()

# The real pre-fix add/update/delete{Parent}Comment + toggle{Parent}
# CommentReaction shape (build_context.py's _build_comment_actions_bridge +
# actions.ts.jinja2's toggle block, before cmd_705) — 5 direct writes.
_ACTIONS_TS_BEFORE = dedent("""
    'use server';
    import prisma from '@/lib/prisma';

    export async function addWidgetComment(commentable_id: string, message: string): Promise<void> {
      const userId = await getSessionUserIdOrThrow();
      await prisma.comment.create({
        data: { message, commentable_id, creator_id: userId },
      });
    }

    export async function updateWidgetComment(commentId: string, message: string): Promise<void> {
      await prisma.comment.update({ where: { id: commentId }, data: { message } });
    }

    export async function deleteWidgetComment(commentId: string): Promise<void> {
      await prisma.comment.delete({ where: { id: commentId } });
    }

    export async function toggleWidgetCommentReaction(commentId: string, type: number) {
      const existing = await prisma.reaction.findUnique({
        where: { comment_id_user_id_type: { comment_id: commentId, user_id: userId, type } },
      });
      if (existing) {
        await prisma.reaction.delete({ where: { id: existing.id } });
      } else {
        await prisma.reaction.create({ data: { comment_id: commentId, user_id: userId, type } });
      }
    }
""").lstrip()

# The cmd_705 post-fix shape: writes route through the new service layer.
_ACTIONS_TS_AFTER = dedent("""
    'use server';
    import prisma from '@/lib/prisma';
    import { createComment, updateComment, deleteComment } from '@/lib/comment/service';
    import { createReaction, deleteReaction } from '@/lib/reaction/service';

    export async function addWidgetComment(commentable_id: string, message: string): Promise<void> {
      const userId = await getSessionUserIdOrThrow();
      await createComment({ message, commentable_id, creator_id: userId });
    }

    export async function updateWidgetComment(commentId: string, message: string): Promise<void> {
      await updateComment(commentId, { message });
    }

    export async function deleteWidgetComment(commentId: string): Promise<void> {
      await deleteComment(commentId);
    }

    export async function toggleWidgetCommentReaction(commentId: string, type: number) {
      const existing = await prisma.reaction.findUnique({
        where: { comment_id_user_id_type: { comment_id: commentId, user_id: userId, type } },
      });
      if (existing) {
        await deleteReaction(existing.id);
      } else {
        await createReaction({ comment_id: commentId, user_id: userId, type });
      }
    }
""").lstrip()

_COMMENT_SERVICE_TS = dedent("""
    import prisma from '@/lib/prisma';

    export async function createComment(data) {
      return prisma.comment.create({ data });
    }
    export async function updateComment(id, data) {
      await prisma.comment.update({ where: { id }, data });
    }
    export async function deleteComment(id) {
      await prisma.comment.delete({ where: { id } });
    }
""").lstrip()

_REACTION_SERVICE_TS = dedent("""
    import prisma from '@/lib/prisma';

    export async function createReaction(data) {
      return prisma.reaction.create({ data });
    }
    export async function deleteReaction(id) {
      await prisma.reaction.delete({ where: { id } });
    }
""").lstrip()


def _make_tree(tmp_path: Path, schema_text: str) -> Path:
    schema_path = tmp_path / 'json_schema.yaml'
    schema_path.write_text(schema_text)
    for sub in (
        'lib/widget', 'lib/comment', 'lib/reaction',
        'components/widget',
        'app/[locale]/widget',
        'app/[locale]/widget/new',
        'app/[locale]/widget/edit/[id]',
        'app/[locale]/widget/view/[id]',
        'app/api/widget', 'app/api/widget/[id]', 'app/api/widget/bulk',
    ):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return schema_path


def _empty_allowlist(tmp_path: Path) -> Path:
    path = tmp_path / 'allowlist.yaml'
    path.write_text('exemptions: []\n')
    return path


# ---------------------------------------------------------------------------
# Before/after contrast (the actual regression proof)
# ---------------------------------------------------------------------------

def test_pre_fix_bridge_shape_is_flagged_five_times(tmp_path: Path) -> None:
    """Reproduces the exact proj_c measurement (subtask_702a): 5 violations."""
    schema = _make_tree(tmp_path, _SCHEMA_WITH_REACTION)
    (tmp_path / 'lib/widget/actions.ts').write_text(_ACTIONS_TS_BEFORE)
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    write_direct = [v for v in vs if v.rule == 'write:direct']
    assert len(write_direct) == 5
    assert all(v.path == 'lib/widget/actions.ts' for v in write_direct)
    snippets = {v.snippet for v in write_direct}
    assert any('prisma.comment.create' in s for s in snippets)
    assert any('prisma.comment.update' in s for s in snippets)
    assert any('prisma.comment.delete' in s for s in snippets)
    assert any('prisma.reaction.delete' in s for s in snippets)
    assert any('prisma.reaction.create' in s for s in snippets)


def test_post_fix_bridge_shape_is_clean(tmp_path: Path) -> None:
    schema = _make_tree(tmp_path, _SCHEMA_WITH_REACTION)
    (tmp_path / 'lib/widget/actions.ts').write_text(_ACTIONS_TS_AFTER)
    (tmp_path / 'lib/comment/service.ts').write_text(_COMMENT_SERVICE_TS)
    (tmp_path / 'lib/reaction/service.ts').write_text(_REACTION_SERVICE_TS)
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert vs == []


# ---------------------------------------------------------------------------
# _bespoke_reaction_files gate (mirrors generate.py's `if named_constants:`)
# ---------------------------------------------------------------------------

def test_reaction_service_files_are_scanned_when_reactions_enabled(tmp_path: Path) -> None:
    """lib/comment/service.ts and lib/reaction/service.ts must themselves be
    in-scope for rule 1 (raw SQL) even though they aren't tied to an
    extract_entities() entity — a raw query smuggled into the new service
    layer must still be caught."""
    schema = _make_tree(tmp_path, _SCHEMA_WITH_REACTION)
    (tmp_path / 'lib/widget/actions.ts').write_text(_ACTIONS_TS_AFTER)
    (tmp_path / 'lib/comment/service.ts').write_text(
        "import prisma from '@/lib/prisma';\n"
        "export async function createComment(data) {\n"
        "  return prisma.$queryRaw`SELECT 1`;\n"
        "}\n"
    )
    (tmp_path / 'lib/reaction/service.ts').write_text(_REACTION_SERVICE_TS)
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    raw = [v for v in vs if v.rule == 'raw:queryRaw']
    assert len(raw) == 1
    assert raw[0].path == 'lib/comment/service.ts'


def test_reaction_service_files_not_scanned_when_reactions_absent(tmp_path: Path) -> None:
    """No `reaction` x-internal entity in the schema (comment/reaction
    feature not present) -> named_constants is empty -> the bespoke files
    are not expected to exist and are not added to the scan set, mirroring
    generate.py's own `if named_constants:` gate around emitting them."""
    schema = _make_tree(tmp_path, _SCHEMA_NO_REACTION)
    # No commentable-bridge writes in this schema shape; a clean actions.ts.
    (tmp_path / 'lib/widget/actions.ts').write_text(
        "'use server';\nexport async function noop() {}\n"
    )
    vs = check(schema, tmp_path, _empty_allowlist(tmp_path))
    assert vs == []
