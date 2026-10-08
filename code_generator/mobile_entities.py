"""Mobile entity screens.

Decides which entities get native list / detail / form screens in the Expo app
and derives the field description those screens render. The screens carry no
validation, submit or permission logic of their own: they call the same
generated modules the Web screens call (`use_entity_form`,
`use_entity_capabilities`, `form_validation`), so this module only describes the
fields to draw.

A many-to-one foreign key, a one-to-one selector and a many-to-many declared with
`x-outputType: list` are drawn as relation pickers whose candidates come from `GET /api/{target}/options`.
An entity with any other relation feature (children, bridges, attachments, ...)
keeps the placeholder screen.
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
# A foreign key or one-to-one selector (one record) and a many-to-many (a set).
KIND_RELATION = 'relation'
KIND_RELATION_MANY = 'relation_many'

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
    'direct_attachment_rels',
    'one_to_one_rels',
    'reverse_oto_rels',
    'flatten_rels',
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

# Kinds the list filter sheet can narrow by: the REST list's default clause for each is a
# substring match (text), equality (number, decimal, boolean) or a member (enum).
_FILTERABLE_KINDS = (KIND_TEXT, KIND_NUMBER, KIND_DECIMAL, KIND_BOOLEAN, KIND_ENUM)

# At most this many columns appear on a list row.
MAX_LIST_COLUMNS = 3


def _picker_children(ctx: dict) -> list[dict]:
    """The many-to-many children that are drawn as pickers.

    The Web form draws a many-to-many declared with `x-outputType: list` as an
    autocomplete list of existing records; without it the child is an editable
    grid of new rows, which the mobile form has no control for.
    """
    return [
        c for c in (ctx.get('non_comment_ch') or [])
        if c.get('is_many_to_many') and c.get('output_type') == 'list'
    ]


def mobile_ineligible_reason(ctx: dict, api_entities: set[str] | None = None) -> str | None:
    """Return why the entity gets no mobile CRUD screens, or None when it does.

    `api_entities` is the set of entities that have REST routes (and so an options
    route); a relation to one outside it cannot be drawn. None skips that check.
    """
    if not ctx.get('can_api'):
        return 'no REST routes (x-generate.api is off)'
    if not ctx.get('can_list'):
        return 'no list screen'
    for key in _FEATURE_KEYS:
        if ctx.get(key):
            return f'declares {key}'
    pickers = _picker_children(ctx)
    if len(pickers) != len(ctx.get('children_raw') or []) or len(pickers) != len(ctx.get('non_comment_ch') or []):
        return 'declares children_raw'
    if api_entities is not None:
        targets = [r['target'] for r in (ctx.get('parent_rels_raw') or []) + (ctx.get('selector_oto_rels') or [])]
        targets += [c['relationship']['target'] for c in pickers]
        for target in targets:
            if target not in api_entities:
                return f'relates to {target}, which has no REST routes'
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


def _relation_entry(rel: dict, ctx: dict, required: set[str], readonly: set[str], title,
                    relation_name: str) -> dict:
    """Field entry for a foreign key or one-to-one selector."""
    name = rel['prop_name']
    return {
        'key': name,
        'label': title(name[:-3] if name.endswith('_id') else name),
        'kind': KIND_RELATION,
        'required': name in required,
        'readonly': name in readonly,
        'options': [],
        'target': rel['target'],
        'label_field': rel.get('label_field') or 'name',
        'relation_name': relation_name,
        'body_key': name,
        'context_fields': list(rel.get('autocomplete_context_fields') or []),
    }


def _relation_many_entry(child: dict, readonly: set[str], title) -> dict:
    """Field entry for a many-to-many picker."""
    name = child['property_name']
    return {
        'key': name,
        'label': title(name),
        'kind': KIND_RELATION_MANY,
        'required': False,
        'readonly': name in readonly,
        'options': [],
        'target': child['relationship']['target'],
        'label_field': child['relationship'].get('label_field') or 'name',
        'relation_name': name,
        'body_key': f"{child['child_var']}_ids",
        'context_fields': [],
    }


def build_mobile_entity_spec(ctx: dict, validation_ctx: dict, title, api_entities: set[str] | None = None) -> dict | None:
    """Field description for an eligible entity, or None.

    `validation_ctx` is `build_validation_context(ctx)`; `title` is `to_title_case`;
    `api_entities` is the set of entities with REST routes (see `mobile_ineligible_reason`).
    """
    if mobile_ineligible_reason(ctx, api_entities) is not None:
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

    entries = {n: _field_entry(n, props[n], kind_by_field[n], ctx, required, readonly, title) for n in order}
    # Foreign keys and one-to-one selectors are columns of the entity, so they take
    # their place among the scalar fields; the Prisma relation field the REST detail
    # embeds is the column name without `_id` (a selector carries its own name).
    for rel in ctx.get('parent_rels_raw') or []:
        name = rel['prop_name']
        entries[name] = _relation_entry(rel, ctx, required, readonly, title, name[:-3] if name.endswith('_id') else name)
    for rel in ctx.get('selector_oto_rels') or []:
        entries[rel['prop_name']] = _relation_entry(rel, ctx, required, readonly, title, rel['relation_name'])
    for child in _picker_children(ctx):
        entries[child['property_name']] = _relation_many_entry(child, readonly, title)
    if declared:
        names = [n for n in declared if n in entries]
    else:
        names = [n for n in props if n in entries] + [n for n in entries if n not in props]
    fields = [entries[n] for n in names]
    if not fields:
        return None

    table = [next(iter(col)) for col in (ctx.get('xdisplay_table') or []) if isinstance(col, dict) and col]
    # A list row shows scalar columns only: a relation column holds an id, and the
    # REST list does not embed the related record's label.
    scalar_keys = [f['key'] for f in fields if f['kind'] not in (KIND_RELATION, KIND_RELATION_MANY)]
    list_keys = [k for k in table if k in kind_by_field] or scalar_keys or [fields[0]['key']]
    list_keys = list_keys[:MAX_LIST_COLUMNS]
    # The REST list sorts and filters on scalar columns only (a relation column holds an id).
    sort_keys = list(scalar_keys)
    filter_keys = [f['key'] for f in fields if f['kind'] in _FILTERABLE_KINDS]
    # The search box matches the first text column of the list row (else the first text field).
    text_keys = [f['key'] for f in fields if f['kind'] == KIND_TEXT]
    search_key = next((k for k in list_keys if k in text_keys), text_keys[0] if text_keys else None)
    return {
        'name': ctx['parent'],
        'pascal': ctx['parent_pascal'],
        'title': title(ctx['parent']),
        'fields': fields,
        'list_keys': list_keys,
        'sort_keys': sort_keys,
        'filter_keys': filter_keys,
        'search_key': search_key,
        'can_new': bool(ctx.get('can_create')),
        'can_edit': bool(ctx.get('can_update')),
        'can_view': bool(ctx.get('can_view')),
        'can_delete': bool(ctx.get('can_delete')),
    }
