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
from build_context import _build_mention_record_resolver, _build_comment_actions, _build_comment_actions_bridge


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
    # commentable_id) — it must select commentable_id so the access check can
    # resolve the parent row, whose id is the notification href.
    out = _build_comment_actions_bridge(
        parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=True,
    )
    assert 'select: { creator_id: true, message: true, commentable_id: true }' in out
    assert 'href: `/ticket/view/${parentRow.id}`' in out
    assert 'mentionParentRow' not in out


def test_bridge_mention_false_omits_all_mention_code():
    out = _build_comment_actions_bridge(
        parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=False,
    )
    for token in ('oldIds', 'newIds', 'freshMentions', 'extractMentionedUserIds',
                  'mentioned_in_comment', 'encodeMentions', 'userLookup', 'storedMessage'):
        assert token not in out
    assert 'select: { creator_id: true, commentable_id: true }' in out


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
    assert 'select: { creator_id: true, ticket_id: true }' in out


# ---------------------------------------------------------------------------
# Organization scope of mention recipients: the axis is the organization of the
# record the comment belongs to, never the commenter's. A record without an
# organization column does not scope; a record with one notifies only that
# organization's members.
# ---------------------------------------------------------------------------

_ORG_SCOPE = {'should_filter_by_org': True}


def _builders(scope):
    return {
        'bridge': lambda flag: _build_comment_actions_bridge(
            parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=flag, scope=scope,
        ),
        'child': lambda flag: _build_comment_actions(
            _CHILD, parent='ticket', model='ticket', has_assignee_id=False, comment_has_mention=flag, scope=scope,
        ),
    }


def test_mention_recipients_are_scoped_to_the_record_organization_on_create_and_update():
    for variant, build in _builders(_ORG_SCOPE).items():
        out = build(True)
        create_filter = (
            'const mentionedIds = await filterMentionRecipientsToRecordOrg('
            'parentRow.organization_id, extractMentionedUserIds(message).filter((mid) => mid !== userId));'
        )
        update_filter = (
            'const freshMentions = await filterMentionRecipientsToRecordOrg('
            'parentRow.organization_id, newIds.filter((mid) => !oldIds.has(mid) && mid !== userId));'
        )
        assert create_filter in out, variant
        assert update_filter in out, variant
        # the filter runs before the notification loop that consumes it
        assert out.index(create_filter) < out.index('for (const mentionedId of new Set(mentionedIds))'), variant
        assert out.index(update_filter) < out.index('for (const mentionedId of freshMentions)'), variant
        # the parent row read carries the organization the filter uses, on every access check
        assert out.count('organization_id: true }') >= 3, variant
        # never the commenter's organizations
        assert 'ActorOrgs' not in out, variant


def test_mention_recipients_are_not_scoped_when_the_record_has_no_organization_column():
    for variant, build in _builders({}).items():
        out = build(True)
        assert 'await filterMentionRecipientsToRecordOrg(null, ' in out, variant
        assert 'parentRow.organization_id' not in out, variant
        assert 'organization_id: true' not in out, variant


def test_mention_recipient_filter_absent_without_mention_field():
    for variant, build in _builders(_ORG_SCOPE).items():
        out = build(False)
        assert 'filterMentionRecipientsToRecordOrg' not in out, variant
        assert 'organization_id: true' not in out, variant


def test_mention_recipients_template_scopes_by_record_organization_only():
    from pathlib import Path
    template = (Path(__file__).resolve().parent.parent / 'templates' / 'mention_recipients.ts.jinja2').read_text()
    assert 'export async function filterMentionRecipientsToRecordOrg' in template
    assert 'organizations: { some: { id: recordOrganizationId } }' in template
    # no organization -> no scoping at all
    assert 'if (!recordOrganizationId) return candidateIds;' in template
    # not the actor's organizations, and not a Server Action module
    assert 'actorId' not in template
    assert "'use server'" not in template.replace("(no 'use server')", '')


# ---------------------------------------------------------------------------
# Mention candidate search: the record the mention is for is read again on the
# server and its organization decides the scope.
# ---------------------------------------------------------------------------

def test_record_resolver_of_an_org_scoped_entity_reads_the_record_through_its_gates():
    out = _build_mention_record_resolver(
        'ticket', 'ticket', '{ id: true, creator_id: true }',
        {'should_filter_by_org': True, 'is_self_only': True, 'filter_values': {'status': [1]}},
    )
    assert 'ticket: async (recordId, userId) => {' in out
    assert 'where: { id: recordId, organization_id: { in: _assocOrgIds }, creator_id: userId, status: { in: [1] } }' in out
    assert 'select: { id: true, creator_id: true, organization_id: true }' in out
    assert "await requireRecordPermission('ticket', 'read', parentRow, userId);" in out
    assert 'return { organizationId: parentRow.organization_id ?? null };' in out
    # a missing or unreadable record resolves to null, never to a scope
    assert 'if (error instanceof AppError) return null;' in out


def test_record_resolver_of_an_entity_without_an_organization_column_scopes_nothing():
    out = _build_mention_record_resolver('memo', 'memo', '{ id: true, creator_id: true }', {})
    assert 'organization_id' not in out
    assert 'getAssociatedOrganizations' not in out
    assert 'return { organizationId: null };' in out
    assert "await requireRecordPermission('memo', 'read', parentRow, userId);" in out


def test_search_template_takes_the_record_and_never_scopes_by_the_actor():
    from pathlib import Path
    t = (Path(__file__).resolve().parent.parent / 'templates' / 'mention_search.ts.jinja2').read_text()
    assert 'record?: MentionRecordRef | null,' in t
    assert 'resolveMentionRecordOrganization' in t
    assert 'getAssociatedOrganizations' not in t
    assert '__no_org_membership__' not in t
    # unknown / unreadable / missing record: no candidates and no user query
    assert 'if (!resolved) return { options: [], permissionDenied: false };' in t
    # only a record that carries an organization narrows the list
    assert 'if (resolved.organizationId) {' in t


def test_record_org_template_resolves_only_known_entities_from_its_own_table():
    from pathlib import Path
    t = (Path(__file__).resolve().parent.parent / 'templates' / 'mention_record_org.ts.jinja2').read_text()
    # `constructor` / `__proto__` style entity names from the client must not reach a resolver
    assert 'Object.prototype.hasOwnProperty.call(RESOLVERS, entity)' in t
    assert "'use server'" not in t.replace("(no 'use server')", '')


_RECORD_ORG_IMPORTS = (
    "import prisma from '@/lib/prisma';",
    "import { requireRecordPermission } from '@/lib/authz';",
    "import { AppError } from '@/lib/_errors';",
)


def _render_record_org(resolvers: str) -> str:
    from generate import _make_env, _render
    return _render(_make_env(), 'mention_record_org.ts.jinja2', {
        'resolvers': resolvers,
        'needs_associated_orgs': 'getAssociatedOrganizations' in resolvers,
    })


def test_record_org_omits_resolver_imports_when_there_are_no_resolvers():
    out = _render_record_org('')
    for line in _RECORD_ORG_IMPORTS:
        assert line not in out
    assert 'getAssociatedOrganizations' not in out
    # the lookup still exists and answers null for every entity
    assert 'export async function resolveMentionRecordOrganization(' in out
    assert 'const RESOLVERS: Record<string, MentionRecordResolver> = {\n};' in out


def test_record_org_emits_resolver_imports_when_there_are_resolvers():
    resolver = _build_mention_record_resolver(
        'ticket', 'ticket', '{ id: true, creator_id: true }',
        {'should_filter_by_org': True, 'is_self_only': False, 'filter_values': {}},
    )
    out = _render_record_org(resolver)
    for line in _RECORD_ORG_IMPORTS:
        assert line in out
    assert "import { getAssociatedOrganizations } from '@/lib/organization/getters_associated';" in out
