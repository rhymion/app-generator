"""
Unit tests for cmd_522 (mention feature, server side).

Covers the Python string-builder functions in build_context.py that emit
the comment add/update actions:

  - `_build_comment_actions()` (child-table variant, e.g. one comment model
    per parent entity)
  - `_build_comment_actions_bridge()` (shared `comment` table via the
    commentable bridge)

Two behaviors are verified:

  1. `encodeMentions()` is retired from the save path — the emitted code no
     longer calls it, builds a `userLookup`, or stores through a
     `storedMessage` variable. The raw `message` is stored directly (see
     mention-feature-design.md section (b)).
  2. Mention notifications are emitted: on create, self-mentions are
     excluded; on update, only newly-added mentions (vs. the prior message)
     are notified — the diff is expressed via `oldIds`/`newIds`/
     `freshMentions`, matching the design doc's M3 test focus.

When `comment_has_mention=False`, none of the above should appear at all —
the generated code must be identical to the pre-cmd_522 shape for entities
with no x-mention-annotated comment field.
"""
from build_context import _build_comment_actions, _build_comment_actions_bridge


# ---------------------------------------------------------------------------
# _build_comment_actions_bridge (commentable-bridge variant)
# ---------------------------------------------------------------------------

def test_bridge_mention_true_includes_diff_pattern():
    out = _build_comment_actions_bridge(
        parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=True,
    )
    assert 'oldIds' in out
    assert 'newIds' in out
    assert 'freshMentions' in out
    assert "extractMentionedUserIds(comment.message)" in out
    assert "extractMentionedUserIds(message)" in out
    assert "!oldIds.has(mid) && mid !== userId" in out
    assert "notify(mentionedId, 'mentioned_in_comment'" in out


def test_bridge_mention_true_excludes_self_on_create():
    out = _build_comment_actions_bridge(
        parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=True,
    )
    assert "extractMentionedUserIds(message).filter((mid) => mid !== userId)" in out


def test_bridge_mention_true_retires_encode_mentions():
    out = _build_comment_actions_bridge(
        parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=True,
    )
    assert 'encodeMentions' not in out
    assert 'userLookup' not in out
    assert 'storedMessage' not in out
    # cmd_705 (write:direct fix): writes route through lib/comment/service.ts
    # instead of prisma.comment.* directly — see test_check_generated_comment_
    # reaction_service.py for the check_generated.py-level regression test.
    assert 'createComment({ message, commentable_id, creator_id: userId })' in out
    assert 'updateComment(commentId, { message })' in out
    assert 'prisma.comment.create' not in out
    assert 'prisma.comment.update' not in out


def test_bridge_mention_true_selects_commentable_id_for_parent_resolution():
    # The update path has no direct parent FK on the comment row (only
    # commentable_id) — it must select commentable_id so it can re-resolve
    # the parent row's id for the notification href.
    out = _build_comment_actions_bridge(
        parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=True,
    )
    assert 'select: { creator_id: true, message: true, commentable_id: true }' in out
    assert 'mentionParentRow' in out


def test_bridge_mention_false_omits_all_mention_code():
    out = _build_comment_actions_bridge(
        parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=False,
    )
    for token in ('oldIds', 'newIds', 'freshMentions', 'extractMentionedUserIds',
                  'mentioned_in_comment', 'encodeMentions', 'userLookup', 'storedMessage'):
        assert token not in out
    assert 'select: { creator_id: true }' in out


# ---------------------------------------------------------------------------
# _build_comment_actions (child-table variant)
# ---------------------------------------------------------------------------

_CHILD = [{'name': 'ticket_comment'}]


def test_child_mention_true_includes_diff_pattern():
    out = _build_comment_actions(
        _CHILD, parent='ticket', model='ticket', has_assignee_id=True, comment_has_mention=True,
    )
    assert 'oldIds' in out
    assert 'newIds' in out
    assert 'freshMentions' in out
    assert "notify(mentionedId, 'mentioned_in_comment'" in out


def test_child_mention_true_selects_parent_id_prop_for_update_href():
    # The child variant stores the parent id directly on the comment row
    # (ticket_id), so the update path can reuse it for the href without an
    # extra query (unlike the bridge variant).
    out = _build_comment_actions(
        _CHILD, parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=True,
    )
    assert 'select: { creator_id: true, message: true, ticket_id: true }' in out
    assert 'href: `/ticket/view/${comment.ticket_id}`' in out


def test_child_mention_true_retires_encode_mentions():
    out = _build_comment_actions(
        _CHILD, parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=True,
    )
    assert 'encodeMentions' not in out
    assert 'userLookup' not in out
    assert 'storedMessage' not in out


def test_child_mention_false_omits_all_mention_code():
    out = _build_comment_actions(
        _CHILD, parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=False,
    )
    for token in ('oldIds', 'newIds', 'freshMentions', 'extractMentionedUserIds',
                  'mentioned_in_comment', 'encodeMentions', 'userLookup', 'storedMessage'):
        assert token not in out
    assert 'select: { creator_id: true }' in out
