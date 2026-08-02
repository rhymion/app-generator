"""
Unit tests for cmd_522c (mention feature, client-side UI wiring).

Covers the two NEW generator wiring points that turn `comment_has_mention`
and `mention_fields` (both already computed by build_context.py/context.py
as of cmd_522/522b) into actual generated JSX:

  - `generators.form_view_context()`: comment display uses <MentionText>
    (via CommentListWrapper's renderMessage render-prop) when
    comment_has_mention is True.
  - `generators.form_upsert_context()`: an entity's own x-mention: true
    text field renders via <MentionInput> instead of the plain
    uncontrolled AppFieldText.
  - `context.py build_entity_context()`: comment_has_mention is computed
    correctly for types.ts.jinja2 (gates FormViewProps.canViewUserProfile /
    mentionUserContext).

When the relevant flag is False, none of the above should appear —
generated output must be identical to the pre-cmd_522c shape.
"""
from build_context import build_context
from generators import form_view_context, form_upsert_context
from context import build_entity_context


# ---------------------------------------------------------------------------
# Shared commentable-bridge schema fixture (same shape as test_bridge_migration.py's
# new-form x-bridge fixture, with x-mention added to comment.message).
# ---------------------------------------------------------------------------

def _commentable_defs(mention: bool) -> dict:
    return {
        "comment": {
            "type": "object",
            "required": ["id", "message", "commentable_id"],
            "properties": {
                "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                "message": {"type": "string", "minLength": 1, **({"x-mention": True} if mention else {})},
                "commentable_id": {
                    "type": "string",
                    "pattern": "^c[a-z0-9]{24,}$",
                    "x-relationship": {"type": "many-to-one", "target": "commentable", "labelField": "id"},
                },
            },
        },
        "commentable": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}},
        },
        "commentable_detail": {
            "x-generate": {"list": False, "view": False, "new": False, "edit": False,
                           "delete": False, "api": False, "test": False},
            "allOf": [
                {"$ref": "#/definitions/commentable"},
                {"type": "object", "required": ["comments"], "properties": {
                    "comments": {"type": "array", "x-outputType": "comments",
                                 "items": {"$ref": "#/definitions/comment"}},
                }},
            ],
        },
    }


def _bridge_schema(mention: bool) -> dict:
    return {
        "definitions": {
            **_commentable_defs(mention),
            "sample": {
                "type": "object",
                "required": ["id", "name", "commentable_id"],
                "x-bridge": [{"role": "commentable", "target": "commentable",
                              "via": "commentable_id", "kind": "one_to_one_bridge"}],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string", "minLength": 1},
                    "commentable_id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                },
            },
            "sample_detail": {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": True, "test": True},
                "allOf": [
                    {"$ref": "#/definitions/sample"},
                    {"type": "object", "properties": {
                        "commentable": {"$ref": "#/definitions/commentable"},
                    }},
                ],
            },
        }
    }


_ENTITY = {
    "parent": "sample",
    "model": "sample",
    "definition_key": "sample_detail",
    "children": [],
    "generate_config": {
        "list": True, "view": True, "new": True, "edit": True,
        "delete": True, "api": True, "test": True, "fields": None,
    },
}


def _view_ctx(mention: bool) -> dict:
    schema = _bridge_schema(mention)
    ctx = build_context(_ENTITY, schema)
    return form_view_context(ctx, schema)


# ---------------------------------------------------------------------------
# form_view_context(): comment display → <MentionText> via renderMessage
# ---------------------------------------------------------------------------

def test_bridge_comment_has_mention_true_wires_render_message():
    fv = _view_ctx(mention=True)
    assert fv['comment_has_mention'] is True
    assert 'renderMessage={(c) => <MentionText' in fv['child_view_grids']
    assert 'text={c.message}' in fv['child_view_grids']
    assert 'userContext={mentionUserContext ?? {}}' in fv['child_view_grids']
    assert 'canViewUserProfile={Boolean(canViewUserProfile)}' in fv['child_view_grids']


def test_bridge_comment_has_mention_false_omits_render_message():
    fv = _view_ctx(mention=False)
    assert fv['comment_has_mention'] is False
    assert 'renderMessage' not in fv['child_view_grids']
    assert 'MentionText' not in fv['child_view_grids']
    # Base CommentListWrapper JSX must be unaffected (same as pre-cmd_522c shape).
    assert '<CommentListWrapper' in fv['child_view_grids']
    assert 'comments={src.commentable?.comments ?? []}' in fv['child_view_grids']


# ---------------------------------------------------------------------------
# form_upsert_context(): x-mention field → <MentionInput>
# ---------------------------------------------------------------------------

def _mention_field_entity_schema() -> dict:
    return {
        "definitions": {
            "task": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "notes": {"type": "string", "x-mention": True},
                },
            },
            "task_detail": {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": True, "test": True},
                "allOf": [{"$ref": "#/definitions/task"}],
            },
        }
    }


_TASK_ENTITY = {
    "parent": "task",
    "model": "task",
    "definition_key": "task_detail",
    "children": [],
    "generate_config": {
        "list": True, "view": True, "new": True, "edit": True,
        "delete": True, "api": True, "test": True, "fields": None,
    },
}


def _upsert_ctx(schema: dict, entity: dict = _TASK_ENTITY) -> dict:
    ctx = build_context(entity, schema)
    return form_upsert_context(ctx, schema)


def test_mention_field_true_wires_mention_input():
    ups = _upsert_ctx(_mention_field_entity_schema())
    assert ups['has_mention_fields'] is True
    assert '<MentionInput' in ups['all_parent_fields_jsx']
    assert 'searchUsers={searchMentionUserOptions}' in ups['all_parent_fields_jsx']
    assert 'value={notes}' in ups['all_parent_fields_jsx']
    # Controlled state (not the uncontrolled ref pattern used for plain text fields).
    assert 'useState<string>(src.notes ?? \'\')' in ups['all_states']
    # formData collection must still include the mention field.
    assert "formData.set('notes', notes);" in ups['parent_form_data_sets']
    # Must NOT also render via the plain uncontrolled AppFieldText path.
    assert 'notesRef' not in ups['all_parent_fields_jsx']


def test_mention_field_false_omits_mention_input():
    schema = _mention_field_entity_schema()
    schema['definitions']['task']['properties']['notes'].pop('x-mention')
    ups = _upsert_ctx(schema)
    assert ups['has_mention_fields'] is False
    assert 'MentionInput' not in ups['all_parent_fields_jsx']
    # Falls back to the plain uncontrolled text field.
    assert 'notesRef' in ups['all_parent_fields_jsx']


# ---------------------------------------------------------------------------
# context.py build_entity_context(): comment_has_mention (types.ts.jinja2 gate)
# ---------------------------------------------------------------------------

def test_context_py_comment_has_mention_true():
    schema = _bridge_schema(mention=True)
    ec = build_entity_context(_ENTITY, schema)
    assert ec.comment_has_mention is True


def test_context_py_comment_has_mention_false():
    schema = _bridge_schema(mention=False)
    ec = build_entity_context(_ENTITY, schema)
    assert ec.comment_has_mention is False
