"""Mobile entity screens for entities without relations.

Decides which entities get native list / detail / form screens in the Expo app
and derives the field description those screens render. The screens carry no
validation, submit or permission logic of their own: they call the same
generated modules the Web screens call (`use_entity_form`,
`use_entity_capabilities`, `form_validation`), so this module only describes the
fields to draw.
"""
from __future__ import annotations

# Field kinds the native form widgets know how to draw.
KIND_TEXT = 'text'
KIND_NUMBER = 'number'
KIND_DECIMAL = 'decimal'
KIND_BOOLEAN = 'boolean'
KIND_ENUM = 'enum'
KIND_DATE = 'date'
KIND_DATETIME = 'datetime'
KIND_TIME = 'time'

# Keys of the field categories (build_context._categorize_form_fields) that the
# mobile form can draw, mapped to the widget kind.
_CATEGORY_KIND = (
    ('text', KIND_TEXT),
    ('link_uri', KIND_TEXT),
    ('number', KIND_NUMBER),
    ('decimal', KIND_DECIMAL),
    ('boolean', KIND_BOOLEAN),
    ('enum_string', KIND_ENUM),
    ('enum_integer', KIND_ENUM),
)

# Categories that need a widget the mobile app does not have yet (file / image
# upload, entity picker, custom component); an entity with one is not eligible.
_UNSUPPORTED_CATEGORIES = ('custom_upsert', 'image', 'file_uri', 'entity_select')

# Context keys whose presence means the entity carries a feature that lives
# beyond plain CRUD (relations, children, comments, attachments, ...).
_FEATURE_KEYS = (
    'parent_rels_raw',
    'selector_oto_rels',
    'direct_attachment_rels',
    'one_to_one_rels',
    'reverse_oto_rels',
    'flatten_rels',
    'children_raw',
    'non_comment_ch',
    'entity_custom_components',
    'entity_view_components',
    'entity_edit_components',
    'virtual_columns',
    'mention_fields',
)

_FEATURE_FLAGS = (
    'has_commentable',
    'has_attachable',
    'is_payment',
    'is_splittable',
    'is_inline_create_target',
    'reservation_config',
    'state_machine_transitions',
    'has_edit_guard',
    'has_delete_guard',
    'is_self_only',
    'write_locked_values',
)

# At most this many columns appear on a list row.
MAX_LIST_COLUMNS = 3


def mobile_ineligible_reason(ctx: dict) -> str | None:
    """Return why the entity gets no mobile CRUD screens, or None when it does."""
    if not ctx.get('can_api'):
        return 'no REST routes (x-generate.api is off)'
    if not ctx.get('can_list'):
        return 'no list screen'
    for key in _FEATURE_KEYS:
        if ctx.get(key):
            return f'declares {key}'
    for key in _FEATURE_FLAGS:
        if ctx.get(key):
            return f'declares {key}'
    cats = ctx.get('field_categories') or {}
    for key in _UNSUPPORTED_CATEGORIES:
        if cats.get(key):
            return f'has a {key} field'
    return None


def _field_entry(name: str, defn: dict, kind: str, ctx: dict, required: set[str],
                 readonly: set[str], title) -> dict:
    entry = {
        'key': name,
        'label': title(name),
        'kind': kind,
        'required': name in required,
        'readonly': name in readonly,
        'options': [],
    }
    if kind == KIND_ENUM:
        entry['options'] = [str(v) for v in defn.get('enum', [])]
        entry['numeric_enum'] = defn.get('type') in ('integer', 'number')
    return entry


def _date_kind(defn: dict) -> str:
    return {'date': KIND_DATE, 'date-time': KIND_DATETIME, 'time': KIND_TIME}[defn.get('format')]


def build_mobile_entity_spec(ctx: dict, validation_ctx: dict, title) -> dict | None:
    """Field description for an eligible entity, or None.

    `validation_ctx` is `build_validation_context(ctx)`; `title` is `to_title_case`.
    """
    if mobile_ineligible_reason(ctx) is not None:
        return None
    cats = ctx['field_categories']
    props = ctx['filtered_props']
    readonly = set(ctx.get('readonly_fields') or [])
    required = {f['key'] for f in validation_ctx.get('client_required_fields', [])}

    kind_by_field: dict[str, str] = {}
    for category, kind in _CATEGORY_KIND:
        for name in cats.get(category, []):
            kind_by_field[name] = kind
    for name in cats.get('date_time', []):
        kind_by_field[name] = _date_kind(props[name])

    # x-display.form, when declared, is the set (and order) of fields the form
    # draws; otherwise every categorised field in schema order.
    declared = (ctx.get('model_def', {}).get('x-display') or {}).get('form')
    order = [n for n in declared if n in kind_by_field] if declared else [n for n in props if n in kind_by_field]

    fields = [_field_entry(n, props[n], kind_by_field[n], ctx, required, readonly, title) for n in order]
    if not fields:
        return None

    table = [next(iter(col)) for col in (ctx.get('xdisplay_table') or []) if isinstance(col, dict) and col]
    list_keys = [k for k in table if k in kind_by_field] or [f['key'] for f in fields]
    list_keys = list_keys[:MAX_LIST_COLUMNS]
    return {
        'name': ctx['parent'],
        'pascal': ctx['parent_pascal'],
        'title': title(ctx['parent']),
        'fields': fields,
        'list_keys': list_keys,
        'can_new': bool(ctx.get('can_create')),
        'can_edit': bool(ctx.get('can_update')),
        'can_view': bool(ctx.get('can_view')),
        'can_delete': bool(ctx.get('can_delete')),
    }
