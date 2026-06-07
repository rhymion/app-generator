"""
Golden diff test: x-bridge (new form) must produce identical build_context()
output as the legacy one-to-one_bridge field annotation (old form).

Run:
    cd code_generator && python -m pytest tests/test_bridge_migration.py -v
"""
import pytest
from build_context import build_context

# ---------------------------------------------------------------------------
# Non-serializable keys in build_context output (function references, raw dicts)
# ---------------------------------------------------------------------------

_SKIP_KEYS = frozenset({
    'to_camel_case', 'to_pascal_case', 'to_pascal_case_from_var', 'to_title_case',
    'safe_var_name', 'singularize', 'get_ts_type', 'has_string_labels',
    'int_enum_option', 'normalize_kind', 'is_date_field', 'get_actual_type',
    'is_nullable',
    # Raw schema dicts — identical by construction between fixtures; skip for clarity
    'filtered_props', 'model_def', 'gen_cfg',
})


def _serializable_ctx(ctx: dict) -> dict:
    """Return a comparison-safe subset of build_context output."""
    return {k: v for k, v in ctx.items() if k not in _SKIP_KEYS and not callable(v)}


# ---------------------------------------------------------------------------
# Shared commentable bridge definitions (identical for both fixtures)
# ---------------------------------------------------------------------------

_COMMENTABLE_SHARED_DEFS = {
    "comment": {
        "type": "object",
        "required": ["id", "message", "commentable_id"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
            "message": {"type": "string", "minLength": 1},
            "commentable_id": {
                "type": "string",
                "pattern": "^c[a-z0-9]{24,}$",
                "x-relationship": {
                    "type": "many-to-one",
                    "target": "commentable",
                    "labelField": "id",
                },
            },
        },
    },
    "commentable": {
        "type": "object",
        "required": ["id"],
        "properties": {
            "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        },
    },
    "commentable_detail": {
        "x-generate": {
            "list": False, "view": False, "new": False, "edit": False,
            "delete": False, "api": False, "test": False,
        },
        "allOf": [
            {"$ref": "#/definitions/commentable"},
            {
                "type": "object",
                "required": ["comments"],
                "properties": {
                    "comments": {
                        "type": "array",
                        "x-outputType": "comments",
                        "items": {"$ref": "#/definitions/comment"},
                    },
                },
            },
        ],
    },
}

_SAMPLE_DETAIL = {
    "x-generate": {
        "list": True, "view": True, "new": True, "edit": True,
        "delete": True, "api": True, "test": True,
    },
    "allOf": [
        {"$ref": "#/definitions/sample"},
        {"type": "object", "properties": {
            "commentable": {"$ref": "#/definitions/commentable"},
        }},
    ],
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

# Old form: commentable_id carries x-relationship directly on the field
_OLD_FORM_SCHEMA = {
    "definitions": {
        **_COMMENTABLE_SHARED_DEFS,
        "sample": {
            "type": "object",
            "required": ["id", "name", "commentable_id"],
            "properties": {
                "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                "name": {"type": "string", "minLength": 1},
                "commentable_id": {
                    "type": "string",
                    "pattern": "^c[a-z0-9]{24,}$",
                    "x-relationship": {
                        "type": "one-to-one_bridge",
                        "target": "commentable",
                    },
                },
            },
        },
        "sample_detail": _SAMPLE_DETAIL,
    }
}

# New form: bridge declared via x-bridge array on the entity; no x-relationship on the field
_NEW_FORM_SCHEMA = {
    "definitions": {
        **_COMMENTABLE_SHARED_DEFS,
        "sample": {
            "type": "object",
            "required": ["id", "name", "commentable_id"],
            "x-bridge": [
                {
                    "role": "commentable",
                    "target": "commentable",
                    "via": "commentable_id",
                    "kind": "one_to_one_bridge",
                }
            ],
            "properties": {
                "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                "name": {"type": "string", "minLength": 1},
                "commentable_id": {
                    "type": "string",
                    "pattern": "^c[a-z0-9]{24,}$",
                    # No x-relationship — declared via x-bridge instead
                },
            },
        },
        "sample_detail": _SAMPLE_DETAIL,
    }
}


# ---------------------------------------------------------------------------
# Golden diff tests
# ---------------------------------------------------------------------------

def test_bridge_migration_commentable_context_identical():
    """x-bridge new form must produce identical build_context output to old form."""
    old_ctx = _serializable_ctx(build_context(_ENTITY, _OLD_FORM_SCHEMA))
    new_ctx = _serializable_ctx(build_context(_ENTITY, _NEW_FORM_SCHEMA))

    diff_keys = [k for k in set(old_ctx) | set(new_ctx) if old_ctx.get(k) != new_ctx.get(k)]

    assert not diff_keys, (
        f"x-bridge output diverges from legacy form on {len(diff_keys)} key(s):\n"
        + "\n".join(
            f"  {k}:\n    old={old_ctx.get(k)!r}\n    new={new_ctx.get(k)!r}"
            for k in sorted(diff_keys)
        )
    )


def test_bridge_migration_commentable_has_commentable():
    """Both forms must set has_commentable=True."""
    old_ctx = build_context(_ENTITY, _OLD_FORM_SCHEMA)
    new_ctx = build_context(_ENTITY, _NEW_FORM_SCHEMA)
    assert old_ctx['has_commentable'] is True, "old form should have has_commentable=True"
    assert new_ctx['has_commentable'] is True, "new form should have has_commentable=True"


def test_bridge_migration_commentable_rel_name():
    """Both forms must detect commentable_rel_name='commentable'."""
    old_ctx = build_context(_ENTITY, _OLD_FORM_SCHEMA)
    new_ctx = build_context(_ENTITY, _NEW_FORM_SCHEMA)
    assert old_ctx['commentable_rel_name'] == 'commentable'
    assert new_ctx['commentable_rel_name'] == 'commentable'


def test_bridge_migration_backward_compat_no_xbridge():
    """Schema without x-bridge (no bridge at all) must not be affected by canonicalize_bridges."""
    no_bridge_schema = {
        "definitions": {
            "simple": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                },
            },
            "simple_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True, "edit": True,
                    "delete": True, "api": True, "test": True,
                },
                "allOf": [{"$ref": "#/definitions/simple"}],
            },
        }
    }
    entity = {
        "parent": "simple",
        "model": "simple",
        "definition_key": "simple_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": True, "fields": None,
        },
    }
    ctx = build_context(entity, no_bridge_schema)
    assert ctx['has_commentable'] is False
    assert ctx['commentable_rel_name'] is None
    assert ctx['one_to_one_rels'] == []
