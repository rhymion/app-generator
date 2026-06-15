"""
build_context.py — Central context builder.

Every generator calls build_context(entity, schema) and gets back a single
dict with all pre-computed values.  Templates only iterate / conditionally
render; they do not do string arithmetic.
"""

from helpers.naming import (
    to_camel_case, to_pascal_case, to_pascal_case_from_var,
    to_title_case, safe_var_name, singularize,
)
from helpers.type_mapping import get_ts_type
from helpers.schema_helpers import (
    filter_fields, get_parent_relationships, get_detail_relation_name,
    is_optional_fk_to_parent, get_parent_fk_props, get_one_to_one_rels,
    get_detail_ref_rels, get_flatten_rels,
)
from helpers.label_field import build_label_expression, render_prisma_include
from helpers.bridge_direction import (
    collect_parent_bridge_fk_props, get_new_form_bridge,
)
import copy
import warnings

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_EXCLUDE_FIELDS = {'created_at', 'updated_at'}
_EXCLUDE_ID_TS  = {'id', 'created_at', 'updated_at', 'creator_id'}
_SCALAR_TYPES   = {'string', 'integer', 'number', 'boolean'}


def _is_scalar_prop(prop: dict) -> bool:
    """True for plain scalar fields safe to filter/sort on (no relations, arrays, objects)."""
    t = prop.get('type')
    if isinstance(t, list):
        return any(x in _SCALAR_TYPES for x in t)
    return t in _SCALAR_TYPES


def _get_actual_type(defn: dict) -> str | None:
    t = defn.get('type')
    if isinstance(t, list):
        return next((x for x in t if x != 'null'), None)
    return t


def _is_nullable(defn: dict) -> bool:
    t = defn.get('type')
    return isinstance(t, list) and 'null' in t


def _normalize_kind(defn: dict) -> str:
    actual = _get_actual_type(defn)
    fmt = defn.get('format')
    if actual == 'string' and fmt in ('date', 'date-time', 'time'):
        return 'date'
    if actual in ('integer', 'number'):
        return 'number'
    if actual == 'boolean':
        return 'boolean'
    if actual == 'string':
        return 'string'
    return 'other'


def _is_date_field(defn: dict) -> bool:
    return _get_actual_type(defn) == 'string' and defn.get('format') in ('date', 'date-time', 'time')


def get_uri_kind(prop: dict) -> str | None:
    """Return the uri kind for a format:uri property. Default is 'image'."""
    if prop.get('format') != 'uri':
        return None
    kind = prop.get('x-uri-kind', 'image')
    if kind not in ('image', 'link'):
        raise ValueError(f"x-uri-kind must be 'image' or 'link', got: {kind!r}")
    return kind


def _dedupe_ordered(items):
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


# ---------------------------------------------------------------------------
# Form data extraction  (actions.ts / api routes)
# ---------------------------------------------------------------------------

def _build_form_data_gets(prop_infos: list[dict]) -> str:
    lines = []
    for p in prop_infos:
        prop     = p['prop']
        var_name = p['var_name']
        defn     = p['def']
        actual   = _get_actual_type(defn)
        nullable = _is_nullable(defn)
        fmt      = defn.get('format')
        pattern  = defn.get('pattern')

        if actual == 'string' and fmt in ('date', 'date-time', 'time'):
            if nullable:
                lines.append(
                    f"  const {var_name}Str = data.get('{prop}') as string | null;\n"
                    f"  const {var_name} = {var_name}Str ? new Date({var_name}Str) : null;"
                )
            else:
                lines.append(
                    f"  const {var_name}Str = data.get('{prop}') as string;\n"
                    f"  const {var_name} = new Date({var_name}Str);"
                )
        elif actual == 'boolean':
            lines.append(f"  const {var_name} = data.get('{prop}') === 'true';")
        elif actual in ('integer', 'number'):
            lines.append(f"  const {var_name} = Number(data.get('{prop}'));")
        elif actual == 'string' and pattern == '^c[a-z0-9]{24,}$' and nullable:
            lines.append(f"  const {var_name} = (data.get('{prop}') as string | null) || null;")
        else:
            suffix = ' | null' if nullable else ''
            lines.append(f"  const {var_name} = data.get('{prop}') as string{suffix};")
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Child data analysis
# ---------------------------------------------------------------------------

def _get_child_parent_id_props(child_name: str, model: str, parent_rels_raw: list[dict],
                               schema: dict) -> set[str]:
    """What FK props in the child definition point back to the parent?

    For self-referential children, uses the parent's own many-to-one rels to itself.
    Otherwise scans the child's x-relationship annotations via get_parent_fk_props,
    falling back to the '{model}_id' convention if no annotated FK is found.
    """
    if child_name == model:
        return {r['prop_name'] for r in parent_rels_raw if r['target'] == model}
    child_def = schema.get('definitions', {}).get(child_name, {})
    return get_parent_fk_props(child_def, model)


def _build_child_data(children_raw: list[dict], model: str, schema: dict,
                      parent_rels_raw: list[dict]) -> list[dict]:
    result = []
    for child_raw in children_raw:
        child_name   = child_raw['name']
        prop_name    = child_raw['property_name']
        output_type  = child_raw.get('output_type')
        relationship = child_raw.get('relationship') or {}

        is_many_to_many = relationship.get('type') == 'many-to-many'

        child_def  = schema['definitions'].get(child_name, {})

        # Optional FK list: non-m2m list child whose FK to parent is nullable.
        # Treat like m2m (connect/set) — add/remove existing entities, no inline create.
        is_optional_fk_list = (
            output_type == 'list' and not is_many_to_many
            and is_optional_fk_to_parent(child_def, model)
        )
        use_connect = is_many_to_many or child_name == model or is_optional_fk_list
        # Independent list child: has its own _detail definition with x-generate.
        # These are managed on their own pages; the parent form shows them read-only.
        is_independent = (
            output_type == 'list' and not is_many_to_many
            and bool(schema['definitions'].get(f'{child_name}_detail', {}).get('x-generate'))
        )
        child_props_dict = child_def.get('properties', {})

        parent_id_props = _get_child_parent_id_props(child_name, model, parent_rels_raw, schema)

        # Fields WITHOUT id (for create body)
        props_no_id = [
            k for k in child_props_dict
            if k not in parent_id_props and k not in _EXCLUDE_ID_TS and k != 'id'
        ]
        # Fields WITH id — same set as props_no_id but with `id` prepended.
        # Kept as a separate var so call sites that don't need the id (the
        # create body) don't carry it through.
        props_with_id = ['id', *props_no_id]

        field_type = (
            '{ ' +
            '; '.join(f'{p}: {get_ts_type(child_props_dict[p])}' for p in props_no_id) +
            ' }'
        ) if props_no_id else '{}'

        # `id?: string` so the form can distinguish kept items (have id, route
        # to update) from new ones (no id, route to create) at diff time.
        field_type_with_id = (
            '{ id?: string; ' +
            '; '.join(f'{p}: {get_ts_type(child_props_dict[p])}' for p in props_no_id) +
            ' }'
        ) if props_no_id else '{ id?: string }'

        def _is_nullable_cuid(defn: dict) -> bool:
            t = defn.get('type')
            return (isinstance(t, list) and 'null' in t
                    and defn.get('pattern') == '^c[a-z0-9]{24,}$')

        field_map_create = '\n'.join(
            f'          {p}: f.{p} || null,'
            if _is_nullable_cuid(child_props_dict.get(p, {}))
            else f'          {p}: f.{p},'
            for p in props_no_id
        )

        child_var    = safe_var_name(prop_name)
        child_pascal = to_pascal_case(prop_name)
        form_key     = singularize(prop_name)

        result.append({
            **child_raw,
            'child_var':        child_var,
            'child_pascal':     child_pascal,
            'form_key':         form_key,
            'is_many_to_many':  is_many_to_many,
            'use_connect':      use_connect,
            'is_independent':   is_independent,
            'output_type':      output_type,
            'props_no_id':      props_no_id,
            'props_with_id':    props_with_id,
            'field_type':       field_type,
            'field_type_with_id': field_type_with_id,
            'field_map_create': field_map_create,
        })
    return result


def _build_child_form_data_extractions(children_data: list[dict]) -> str:
    lines = []
    for c in children_data:
        child_var = c['child_var']
        form_key  = c['form_key']
        if c['use_connect']:
            item_var  = singularize(child_var)
            item_id   = f'{item_var}Id'
            lines.append(
                f"  const {child_var}Raw = data.getAll('{form_key}[]') as string[];\n"
                f"  const {child_var}Items = {child_var}Raw.map(f => JSON.parse(f) as {{ id?: string; name?: string }});\n"
                f"  const {child_var}Ids = {child_var}Items\n"
                f"    .map(({item_var}) => {item_var}.id)\n"
                f"    .filter(({item_id}): {item_id} is string => Boolean({item_id}));"
            )
        else:
            # Items carry an optional `id` so the service can diff incoming
            # vs existing rows in the nested update — see #6 in
            # performance-plan-session.md.
            lines.append(
                f"  const {child_var}Raw = data.getAll('{form_key}[]') as string[];\n"
                f"  const {child_var}Items = {child_var}Raw.map(f => JSON.parse(f) as {c['field_type_with_id']});"
            )
    return '\n'.join(lines)


def _build_child_nested_create(children_data: list[dict]) -> str:
    lines = []
    for c in children_data:
        pn  = c['property_name']
        cv  = c['child_var']
        fmc = c['field_map_create']
        if c['use_connect']:
            lines.append(f"      {pn}: {{\n        connect: {cv}Ids.map((id) => ({{ id }})),\n      }},")
        else:
            lines.append(f"      {pn}: {{\n        create: {cv}Items.map(f => ({{\n{fmc}\n        }})),\n      }},")
    return '\n'.join(lines)


def _build_child_nested_update(children_data: list[dict]) -> str:
    lines = []
    for c in children_data:
        pn  = c['property_name']
        cv  = c['child_var']
        fmc = c['field_map_create']
        if c['use_connect']:
            lines.append(f"      {pn}: {{\n        set: {cv}Ids.map((id) => ({{ id }})),\n      }},")
        else:
            # Diff incoming vs existing instead of nuke-and-rebuild
            # (#6 in performance-plan-session.md). Items the form returned
            # with an id are kept (and updated in place); ids no longer
            # present are deleted; items without an id are created. This
            # turns N statements per update into roughly K_new + K_changed
            # + 1 (vs the old K_existing + K_new).
            lines.append(
                f"      {pn}: {{\n"
                f"        deleteMany: {{ id: {{ notIn: {cv}Items.map(f => f.id).filter((id): id is string => Boolean(id)) }} }},\n"
                f"        update: {cv}Items.filter(f => f.id).map(f => ({{\n"
                f"          where: {{ id: f.id! }},\n"
                f"          data: {{\n{fmc}\n          }},\n"
                f"        }})),\n"
                f"        create: {cv}Items.filter(f => !f.id).map(f => ({{\n{fmc}\n        }})),\n"
                f"      }},"
            )
    return '\n'.join(lines)


def _build_comment_actions(comment_children: list[dict], parent: str, model: str, has_assignee_id: bool) -> str:
    parent_pascal = to_pascal_case(parent)
    assignee_select = ", assignee_id: true" if has_assignee_id else ""
    recipient_list = (
        "[parentRow.creator_id, parentRow.assignee_id]"
        if has_assignee_id else "[parentRow.creator_id]"
    )
    lines = []
    for c in comment_children:
        child_model   = c['name']
        parent_id_prop = f'{model}_id'
        lines.append(f"""
export async function add{parent_pascal}Comment({parent_id_prop}: string, message: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  await prisma.{child_model}.create({{
    data: {{ message, {parent_id_prop}, creator_id: userId }},
  }});
  // Trigger #4 (notification design 2026-05-11): notify the entity creator
  // and (if present) assignee; never the commenter themselves.
  const parentRow = await prisma.{model}.findUnique({{
    where: {{ id: {parent_id_prop} }},
    select: {{ id: true, creator_id: true{assignee_select} }},
  }});
  if (parentRow) {{
    const recipients = new Set<string>(
      {recipient_list}.filter((id): id is string => Boolean(id) && id !== userId)
    );
    for (const recipientId of recipients) {{
      notify(recipientId, 'comment_created', {{
        title: 'New comment on {parent_pascal}',
        href: `/{parent}/view/${{parentRow.id}}`,
        commentSnippet: message.slice(0, 80),
      }});
    }}
  }}
  revalidatePath('/{parent}');
}}

export async function update{parent_pascal}Comment(commentId: string, message: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.{child_model}.findUnique({{ where: {{ id: commentId }}, select: {{ creator_id: true }} }});
  if (!comment || comment.creator_id !== userId) {{
    throw new Error('Not authorized to edit this comment');
  }}
  await prisma.{child_model}.update({{ where: {{ id: commentId }}, data: {{ message }} }});
  revalidatePath('/{parent}');
}}

export async function delete{parent_pascal}Comment(commentId: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.{child_model}.findUnique({{ where: {{ id: commentId }}, select: {{ creator_id: true }} }});
  if (!comment) return;
  if (comment.creator_id !== userId) {{
    await requirePermission('{parent}', 'delete');
  }}
  await prisma.{child_model}.delete({{ where: {{ id: commentId }} }});
  revalidatePath('/{parent}');
}}""")
    return '\n'.join(lines)


def _build_comment_actions_bridge(parent: str, model: str, has_assignee_id: bool) -> str:
    """Generate comment actions using the shared commentable bridge (single comment table)."""
    parent_pascal = to_pascal_case(parent)
    assignee_select = ", assignee_id: true" if has_assignee_id else ""
    recipient_list = (
        "[parentRow.creator_id, parentRow.assignee_id]"
        if has_assignee_id else "[parentRow.creator_id]"
    )
    return f"""
export async function add{parent_pascal}Comment(commentable_id: string, message: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  await prisma.comment.create({{
    data: {{ message, commentable_id, creator_id: userId }},
  }});
  // Trigger #4 (notification design 2026-05-11): notify the entity creator
  // and (if present) assignee; never the commenter themselves.
  const parentRow = await prisma.{model}.findFirst({{
    where: {{ commentable_id }},
    select: {{ id: true, creator_id: true{assignee_select} }},
  }});
  if (parentRow) {{
    const recipients = new Set<string>(
      {recipient_list}.filter((id): id is string => Boolean(id) && id !== userId)
    );
    for (const recipientId of recipients) {{
      notify(recipientId, 'comment_created', {{
        title: 'New comment on {parent_pascal}',
        href: `/{parent}/view/${{parentRow.id}}`,
        commentSnippet: message.slice(0, 80),
      }});
    }}
  }}
  revalidatePath('/{parent}');
}}

export async function update{parent_pascal}Comment(commentId: string, message: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.comment.findUnique({{ where: {{ id: commentId }}, select: {{ creator_id: true }} }});
  if (!comment || comment.creator_id !== userId) {{
    throw new Error('Not authorized to edit this comment');
  }}
  await prisma.comment.update({{ where: {{ id: commentId }}, data: {{ message }} }});
  revalidatePath('/{parent}');
}}

export async function delete{parent_pascal}Comment(commentId: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.comment.findUnique({{ where: {{ id: commentId }}, select: {{ creator_id: true }} }});
  if (!comment) return;
  if (comment.creator_id !== userId) {{
    await requirePermission('{parent}', 'delete');
  }}
  await prisma.comment.delete({{ where: {{ id: commentId }} }});
  revalidatePath('/{parent}');
}}"""


# ---------------------------------------------------------------------------
# Selection targets (page_new, page_edit)
# ---------------------------------------------------------------------------

def _get_selection_targets(children_raw: list[dict], parent_rels_raw: list[dict],
                           schema: dict, model: str = '') -> list[str]:
    model_props = schema['definitions'].get(model, {}).get('properties', {})
    m2m_targets = [
        c['relationship']['target']
        for c in children_raw
        if (c.get('relationship') or {}).get('type') == 'many-to-many'
    ]
    optional_fk_list_targets = [
        c['name'] for c in children_raw
        if (c.get('output_type') == 'list'
            and (c.get('relationship') or {}).get('type') != 'many-to-many'
            and is_optional_fk_to_parent(schema['definitions'].get(c['name'], {}), model))
    ]
    many_to_one_targets = [
        r['target']
        for r in parent_rels_raw
        if (model_props.get(r['prop_name'], {}).get('x-relationship') or {}).get('type') == 'many-to-one'
    ]

    child_entity_rel_targets = []
    for child_raw in children_raw:
        output_type  = child_raw.get('output_type')
        relationship = child_raw.get('relationship') or {}
        if output_type in ('list', 'comments') or relationship.get('type') == 'many-to-many':
            continue
        child_def = schema['definitions'].get(child_raw['name'], {})
        if child_def.get('properties'):
            parent_fk_props = get_parent_fk_props(child_def, model)
            child_entity_rel_targets.extend(
                r['target'] for r in get_parent_relationships(child_def)
                if r['prop_name'] not in parent_fk_props
                and ((child_def.get('properties', {}).get(r['prop_name'], {}).get('x-relationship') or {}).get('type') == 'many-to-one')
            )

    return _dedupe_ordered([*m2m_targets, *optional_fk_list_targets, *many_to_one_targets, *child_entity_rel_targets])


# ---------------------------------------------------------------------------
# Page list helpers
# ---------------------------------------------------------------------------

def _has_string_labels(enum_values: list) -> bool:
    return any(isinstance(v, str) and not str(v).lstrip('-').isdigit() for v in enum_values)


def _int_enum_option(v, i: int) -> str:
    if isinstance(v, (int, float)):
        return f"{{ value: {int(v)}, label: '{v}' }}"
    n = str(v)
    try:
        float(n)
        return f"{{ value: {n}, label: '{v}' }}"
    except ValueError:
        return f"{{ value: {i}, label: '{v}' }}"


# ---------------------------------------------------------------------------
# FormUpsert field categorisation
# ---------------------------------------------------------------------------

def _categorize_form_fields(filtered_props: dict, parent_rels_raw: list[dict],
                            generate_config: dict,
                            one_to_one_fk_props: set | None = None) -> dict:
    rel_prop_names = {r['prop_name'] for r in parent_rels_raw}
    _oto_fk = one_to_one_fk_props or set()
    parent_props = [
        k for k in filtered_props
        if k not in _EXCLUDE_ID_TS and k != 'id' and k not in rel_prop_names and k not in _oto_fk
    ]

    custom_upsert = []
    date_time     = []
    number        = []
    enum_integer  = []
    enum_string   = []
    image         = []
    link_uri      = []
    boolean       = []
    entity_select = []
    text          = []

    for p in parent_props:
        defn   = filtered_props[p]
        actual = _get_actual_type(defn)
        fmt    = defn.get('format')
        xc     = defn.get('x-custom-component', {})
        if isinstance(xc, dict) and isinstance(xc.get('target'), list) and 'upsert' in xc['target']:
            custom_upsert.append(p)
            continue
        if actual == 'string' and fmt in ('date', 'date-time', 'time'):
            date_time.append(p)
        elif actual in ('integer', 'number') and isinstance(defn.get('enum'), list):
            enum_integer.append(p)
        elif actual in ('integer', 'number'):
            number.append(p)
        elif actual == 'boolean':
            boolean.append(p)
        elif actual == 'string' and fmt == 'uri':
            if get_uri_kind(defn) == 'link':
                link_uri.append(p)
            else:
                image.append(p)
        elif actual == 'string' and defn.get('x-entity-select'):
            entity_select.append(p)
        elif actual == 'string' and isinstance(defn.get('enum'), list):
            enum_string.append(p)
        else:
            text.append(p)

    return {
        'custom_upsert': custom_upsert,
        'date_time': date_time,
        'number': number,
        'enum_integer': enum_integer,
        'enum_string': enum_string,
        'image': image,
        'link_uri': link_uri,
        'boolean': boolean,
        'entity_select': entity_select,
        'text': text,
    }


# ---------------------------------------------------------------------------
# Entity select options helper
# ---------------------------------------------------------------------------

def _get_entity_options(schema: dict) -> list[dict]:
    """Returns list of {value, label} for all schema entities that have pages."""
    from generate_types import extract_entities
    options = []
    seen = set()
    for e in extract_entities(schema):
        parent = e['parent']
        if parent not in seen:
            seen.add(parent)
            options.append({'value': parent, 'label': to_title_case(parent)})
    return options


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

def canonicalize_bridges(entity_schema: dict, all_defs: dict) -> dict:
    """Normalize x-bridge into synthetic x-relationship annotations.

    Two forms are supported:
    - Old array form (list of {role, target, via, kind}): converts each entry
      into a field-level x-relationship annotation on the `via` field, so the
      existing one_to_one_rel detection path picks it up unchanged.
    - New object form (dict with name/child/parentCardinality/parents): FK is on
      the parent side; nothing to inject here — parent FK injection is handled
      in build_context() via collect_parent_bridge_fk_props().

    Returns a modified shallow copy of entity_schema, or entity_schema unchanged
    if no x-bridge is present.
    """
    x_bridge = entity_schema.get('x-bridge')
    if not x_bridge:
        return entity_schema

    # New object form — FK-on-parent; parent FK injection done in build_context()
    if isinstance(x_bridge, dict):
        return entity_schema

    # Old array form: inject x-relationship annotations onto via fields
    props = dict(entity_schema.get('properties', {}))
    _KIND_MAP = {
        'one_to_one_bridge': 'one-to-one_bridge',
        'one-to-one_bridge': 'one-to-one_bridge',
    }
    for entry in x_bridge:
        via_field = entry.get('via')
        target = entry.get('target')
        kind = entry.get('kind', 'one_to_one_bridge')
        rel_type = _KIND_MAP.get(kind, kind)  # normalize to internal hyphen format

        if not via_field or not target or via_field not in props:
            continue  # validation.py reports missing required fields

        # Old-form field-level annotation takes precedence
        if not props[via_field].get('x-relationship'):
            props[via_field] = {**props[via_field], 'x-relationship': {'type': rel_type, 'target': target}}

    return {**entity_schema, 'properties': props}


def build_context(entity: dict, schema: dict) -> dict:
    parent      = entity['parent']
    model       = entity['model']
    def_key     = entity['definition_key']
    gen_cfg     = entity.get('generate_config', {})
    children_raw = entity.get('children', [])

    parent_pascal = to_pascal_case(parent)
    parent_camel  = to_camel_case(parent)

    model_def      = canonicalize_bridges(
        schema['definitions'].get(model, {}),
        schema.get('definitions', {}),
    )
    # Inject parent-side bridge FK props synthesized from new-form x-bridge declarations
    # on child entities that list this model as a parent. These FKs look like
    # one-to-one_bridge relations so the existing OTO machinery handles auto-create/include.
    _parent_bridge_fks = collect_parent_bridge_fk_props(model, schema)
    if _parent_bridge_fks:
        model_def = {
            **model_def,
            'properties': {**model_def.get('properties', {}), **_parent_bridge_fks},
        }
    filtered_props = filter_fields(model_def.get('properties', {}), gen_cfg.get('fields'))

    # Collect explicit readonly fields: x-readonly per-field OR x-readonly-fields entity-level.
    # Stage 2 will extend this with automatic bridge parent fields.
    _ro_from_entity: set[str] = set(model_def.get('x-readonly-fields') or [])
    _ro_from_props: set[str] = {
        fn for fn, fp in filtered_props.items()
        if isinstance(fp, dict) and fp.get('x-readonly')
    }
    readonly_fields: list[str] = sorted(_ro_from_entity | _ro_from_props)
    # API route: select clause string and field list for AP-3=B readonly reject check.
    _api_ro_in_props = [f for f in readonly_fields if f in filtered_props]
    readonly_fields_api: list[str] = _api_ro_in_props
    readonly_fields_api_select: str | None = (
        '{ ' + ', '.join(f'{f}: true' for f in _api_ro_in_props) + ' }'
        if _api_ro_in_props else None
    )

    # Config flags
    can_create = gen_cfg.get('new',    True) is not False
    can_update = gen_cfg.get('edit',   True) is not False
    can_delete = gen_cfg.get('delete', True) is not False
    can_list   = gen_cfg.get('list',   True) is not False
    can_view   = gen_cfg.get('view',   True) is not False

    # Parent relationships (many-to-one) — all of them, not deduplicated by target.
    # Both selector and auto-create one-to-one relations are excluded here:
    # selector OTO is re-added through `selector_oto_rels` (autocomplete UI),
    # and auto-create OTO (commentable/approvable bridges) is handled through
    # `auto_create_oto_rels` (pre-create in transaction + nested include).
    # Leaving them in `parent_rels_raw` would produce duplicate relation fields,
    # duplicate includes, and bogus import/option types.
    merged_def    = {**model_def, 'properties': filtered_props}
    _all_parent_rels_raw = get_parent_relationships(merged_def, schema)
    one_to_one_rels = get_one_to_one_rels(merged_def, schema)
    auto_create_oto_rels = [r for r in one_to_one_rels if not r['is_selector']]
    selector_oto_rels    = [r for r in one_to_one_rels if r['is_selector']]
    oto_prop_names = {r['prop_name'] for r in one_to_one_rels}

    # Bridge child IR: new-form x-bridge on this entity (as child), with parent targets.
    # Used by child forms to render parent-entity autocomplete and by service to
    # resolve parent → <child>able_id.
    bridge_child_ir = get_new_form_bridge(schema.get('definitions', {}).get(model, {}))

    # Bridge child service context: extended vars for service template
    # (parent resolution code and FK data line).
    bridge_child_params_str = ''
    bridge_child_pre_create_code = ''
    bridge_child_fk_data_line = ''
    if bridge_child_ir:
        _bc_bridge_name = bridge_child_ir['name']
        _bc_fk_col = f'{_bc_bridge_name}_id'
        _bc_parent_targets = bridge_child_ir['parent_targets']
        bridge_child_params_str = 'selectedParentType: string, selectedParentId: string'
        bridge_child_fk_data_line = f'        {_bc_fk_col}: _resolvedBridgeFk,'
        _res_lines = ['    let _resolvedBridgeFk: string;']
        for _bi, _pt in enumerate(_bc_parent_targets):
            _pt_pascal = to_pascal_case(_pt)
            _kw = 'if' if _bi == 0 else '    } else if'
            _res_lines.extend([
                f"    {_kw} (selectedParentType === '{_pt}') {{",
                f"      const _bp = await tx.{_pt}.findUnique({{ where: {{ id: selectedParentId }}, select: {{ {_bc_fk_col}: true }} }});",
                f"      if (!_bp) throw new Error('{_pt_pascal} does not exist');",
                f"      _resolvedBridgeFk = _bp.{_bc_fk_col};",
            ])
        _res_lines.extend([
            '    } else {',
            "      throw new Error('Invalid bridge parent type: ' + selectedParentType);",
            '    }',
        ])
        bridge_child_pre_create_code = '\n'.join(_res_lines)

    # Bridge parent options: for each parent target in x-bridge, collect display metadata.
    # Used by Stage 3 (child list/detail parent display) and Stage 2 (form parent label).
    # label_field resolution: AP-1 A+B — x-bridge.parents[].labelField → x-display primary → fallback.
    bridge_parent_options: list[dict] = []
    if bridge_child_ir:
        _bc_bridge_name_po = bridge_child_ir['name']
        for _bpo in (bridge_child_ir.get('parents') or []):
            _bpo_target = _bpo.get('target', '')
            _bpo_lf = _bpo.get('labelField')  # AP-1-A: schema-specified per-parent labelField
            if not _bpo_lf:
                # AP-1-B fallback: target entity's x-display.table primary field
                _bpo_tdef = schema.get('definitions', {}).get(_bpo_target, {})
                _bpo_xdisp = _bpo_tdef.get('x-display') or {}
                _bpo_table = (
                    _bpo_xdisp if isinstance(_bpo_xdisp, list)
                    else (_bpo_xdisp.get('table') if isinstance(_bpo_xdisp, dict) else None)
                )
                if _bpo_table:
                    for _bpo_col in _bpo_table:
                        for _fn, _fcfg in _bpo_col.items():
                            if isinstance(_fcfg, dict) and _fcfg.get('primary'):
                                _bpo_lf = _fn
                                break
                        if _bpo_lf:
                            break
            if not _bpo_lf:
                # Final fallback: name → title → label → id
                _bpo_tprops = (schema.get('definitions', {}).get(_bpo_target, {}).get('properties') or {})
                _bpo_lf = next(
                    (f for f in ('name', 'title', 'label', 'id') if f in _bpo_tprops), 'id'
                )
            bridge_parent_options.append({
                'target': _bpo_target,
                'role': _bpo.get('role', ''),
                'label_field': _bpo_lf,
                'relation_name_on_bridge': _bpo_target,  # Prisma back-relation on bridge model
            })

    # Stage 2: auto-add bridge FK prop to readonly_fields for bridge child entities.
    # The bridge FK (e.g. channelable_id) is already excluded from editable form fields
    # via auto_create_oto_fk_props; adding it here makes it available as a disabled
    # display-only field in edit mode and links it to the readonly semantics machinery.
    if bridge_child_ir:
        _bridge_fk_prop = f'{bridge_child_ir["name"]}_id'
        if _bridge_fk_prop not in readonly_fields and _bridge_fk_prop in filtered_props:
            readonly_fields = sorted(set(readonly_fields) | {_bridge_fk_prop})
            if _bridge_fk_prop not in readonly_fields_api:
                readonly_fields_api = sorted(set(readonly_fields_api) | {_bridge_fk_prop})
                readonly_fields_api_select = (
                    '{ ' + ', '.join(f'{f}: true' for f in readonly_fields_api) + ' }'
                )

    # Collect bridge targets from new-form x-bridge declarations in the schema.
    # Used to limit bridge_cleanup_rels to FK-on-parent bridge relations only
    # (B5: prevents accidentally deleting non-bridge auto-create OTO rows).
    _new_form_bridge_targets: set[str] = set()
    for _ename, _edef in schema.get('definitions', {}).items():
        if _ename.endswith('_detail') or not isinstance(_edef, dict):
            continue
        _bridge_ir = get_new_form_bridge(_edef)
        if _bridge_ir:
            _new_form_bridge_targets.add(_bridge_ir['name'])
    # Also include old-form bridge targets (commentable, approvable, attachable) which
    # are referenced via one-to-one_bridge x-relationship directly on fields.
    # These are auto-created by the parent entity and must also be cleaned up on delete.
    _bridge_cleanup_targets = _new_form_bridge_targets | {
        r['target'] for r in auto_create_oto_rels
        if r.get('relation_type') == 'one-to-one_bridge'
    }

    # Bridge cleanup relations: FK-on-parent bridge relations auto-created by this entity.
    # Parent delete must explicitly delete these bridge rows; onDelete: Cascade only flows
    # bridge → child (not parent → bridge).
    bridge_cleanup_rels = [
        {
            'relation_name': r['relation_name'],
            'prop_name': r['prop_name'],
            'target': r['target'],
        }
        for r in auto_create_oto_rels
        if r['target'] in _bridge_cleanup_targets
    ]
    # Pre-computed strings for service delete template
    if bridge_cleanup_rels:
        _bc_select = ', '.join(f'{r["prop_name"]}: true' for r in bridge_cleanup_rels)
        bridge_pre_delete_select = f'{{ {_bc_select} }}'
        bridge_post_delete_cleanups = '\n'.join(
            f'  await prisma.{r["target"]}.deleteMany({{ where: {{ id: {{ in: _bridgeRows'
            f'.map((r) => r.{r["prop_name"]}).filter(Boolean) }} }} }});'
            for r in bridge_cleanup_rels
        )
    else:
        bridge_pre_delete_select = None
        bridge_post_delete_cleanups = ''
    parent_rels_raw = [r for r in _all_parent_rels_raw if r['prop_name'] not in oto_prop_names]
    # relationship_targets: deduplicated by target for import / type purposes
    seen: dict[str, dict] = {}
    for r in parent_rels_raw:
        seen.setdefault(r['target'], r)
    relationship_targets = list(seen.values())

    # parent_rels: all rels with relation_name derived from prop_name directly
    parent_rels = [
        {
            **r,
            'relation_name': r['prop_name'].removesuffix('_id'),
        }
        for r in parent_rels_raw
    ]

    has_org_rel          = any(r['target'] == 'organization' for r in parent_rels)
    should_filter_by_org = has_org_rel and model not in ('organization', 'user')

    has_assignee_id   = 'assignee_id' in filtered_props
    item_context_select = (
        f'{{ id: true, creator_id: true{", assignee_id: true" if has_assignee_id else ""} }}'
    )

    # is_audited: when true, generated service.ts wraps create/update/delete
    # with calls to recordAuditEvent so role/permission changes (and any other
    # entity flagged via `x-audit: true` on its `_detail`) leave a row in
    # `audit_log`. Drive this from `x-audit` on the `_detail` definition so
    # adding a new protected entity is a schema-only change. Fallback to the
    # base entity for symmetry with x-generate/x-display.
    _detail_for_audit = schema['definitions'].get(def_key, {}) or {}
    _base_for_audit = schema['definitions'].get(model, {}) or {}
    is_audited = bool(
        _detail_for_audit.get('x-audit') is True
        or _base_for_audit.get('x-audit') is True
    )

    # Scalar columns the paginated API/page-list will accept for sort/filter.
    # Always include audit columns. Anything not in this set is silently ignored
    # at request time so external input cannot pick arbitrary Prisma columns.
    _scalar_props = [k for k, v in filtered_props.items() if _is_scalar_prop(v)]
    for _extra in ('id', 'created_at', 'updated_at', 'creator_id'):
        if _extra not in _scalar_props:
            _scalar_props.append(_extra)
    if has_assignee_id and 'assignee_id' not in _scalar_props:
        _scalar_props.append('assignee_id')
    # Bridge children: expose the entity's own `<bridge>_id` FK as filter/sortable so
    # a parent-embedded grid (cmd_167 §4) can scope the list to one parent's bridge row.
    _self_bridge = get_new_form_bridge(schema['definitions'].get(model, {}))
    if _self_bridge:
        _self_bridge_fk = f"{_self_bridge['name']}_id"
        if _self_bridge_fk not in _scalar_props:
            _scalar_props.append(_self_bridge_fk)
    sortable_fields_quoted = ', '.join(f"'{c}'" for c in _scalar_props)
    filterable_fields_quoted = sortable_fields_quoted

    # Text fields used by searchXxxOptions for substring matching. Limited to
    # the conventional human-readable columns so callers don't accidentally
    # search across freeform fields.
    searchable_text_fields = [f for f in ('name', 'code') if f in filtered_props]
    # Default ordering for the search action — newest entities are the most
    # likely autocomplete picks. Falls back to id when no audit column exists.
    default_search_order_field = (
        'name' if 'name' in filtered_props
        else 'code' if 'code' in filtered_props
        else 'created_at' if 'created_at' in filtered_props
        else 'id'
    )
    default_search_order_dir = 'asc' if default_search_order_field in ('name', 'code') else 'desc'

    # Reverse one-to-one rels (FK is in the target, pointing back to this model)
    # e.g. pre_check.checkup_id → checkup; defined as plain $ref in the _detail extension
    reverse_oto_rels = get_detail_ref_rels(parent, merged_def, schema)

    # Flatten rels (x-outputType: flatten on non-array $ref properties in _detail)
    flatten_rels = get_flatten_rels(parent, merged_def, schema)
    # FK props in the parent model for m2o flatten rels — shown as accordion, not plain TextField
    flatten_m2o_fk_props = {f'{r["prop_name"]}_id' for r in flatten_rels if r['is_m2o']}

    # For m2o flatten rels with FK fields in their target: upgrade the simple 'rel: true' include
    # to 'rel: { include: { nested_rel: true } }' so the nested labels are fetchable in detail
    _flatten_m2o_nested: dict[str, str] = {}
    for _fr in flatten_rels:
        if not _fr['is_m2o']:
            continue
        _nested_fk = [f for f in _fr['fields'] if f.get('is_fk')]
        if _nested_fk:
            _parts = ', '.join(f"{f['relation_name']}: true" for f in _nested_fk)
            _flatten_m2o_nested[_fr['relation_name']] = f'{{ include: {{ {_parts} }} }}'

    # Non-m2o flatten rel include entries (FK is in target; add to detail query)
    flatten_non_m2o_include_entries: list[str] = []
    for _fr in flatten_rels:
        if _fr['is_m2o']:
            continue
        _nested_fk    = [f for f in _fr['fields'] if f.get('is_fk')]
        _nested_array = [f for f in _fr['fields'] if f.get('is_array')]
        _inner_parts: list[str] = []
        _inner_parts.extend(f"{f['relation_name']}: true" for f in _nested_fk)
        # Array fields (e.g., pre_check_detail.symptoms) need to be pulled
        # into the parent's detail query — otherwise the typed result
        # misses the field declared on the *_detail type and TS rejects
        # the return shape (see TypeError on
        # `Property 'symptoms' is missing in type … but required in
        # type { symptoms: Symptom[] }`).
        _inner_parts.extend(f"{f['name']}: true" for f in _nested_array)
        if _inner_parts:
            flatten_non_m2o_include_entries.append(
                f"{_fr['relation_name']}: {{ include: {{ {', '.join(_inner_parts)} }} }}"
            )
        else:
            flatten_non_m2o_include_entries.append(f"{_fr['relation_name']}: true")

    # auto-create FK props are excluded from service params (pre-created in transaction)
    auto_create_oto_fk_props = {r['prop_name'] for r in auto_create_oto_rels}
    # all OTO FK props are excluded from field categorisation (never treated as plain text fields)
    all_oto_fk_props = {r['prop_name'] for r in one_to_one_rels}

    # Parent prop infos: exclude id, timestamps, and auto-create OTO FK props
    # Selector OTO FK props ARE included — they flow through the form as autocomplete values
    parent_props = [k for k in filtered_props if k not in _EXCLUDE_ID_TS and k not in auto_create_oto_fk_props]
    parent_prop_infos = [
        {'prop': p, 'var_name': safe_var_name(p), 'def': filtered_props[p]}
        for p in parent_props
    ]
    parent_params = ', '.join(p['var_name'] for p in parent_prop_infos)
    parent_params_with_types = ', '.join(
        f"{p['var_name']}: {get_ts_type(p['def'])}" for p in parent_prop_infos
    )
    _base_data_lines = [f"        {p['prop']}: {p['var_name']}," for p in parent_prop_infos]
    # Explicit pre-create statements for auto-create OTO targets (e.g. const approvable = await tx.approvable.create({ data: {} });)
    one_to_one_pre_creates = '\n'.join(
        f"    const {r['relation_name']} = await tx.{r['target']}.create({{ data: {{}} }});"
        for r in auto_create_oto_rels
    )
    # FK data lines for auto-create OTO targets (e.g. approvable_id: approvable.id,)
    one_to_one_fk_data_lines = '\n'.join(
        f"        {r['prop_name']}: {r['relation_name']}.id,"
        for r in auto_create_oto_rels
    )
    parent_data_obj = '\n'.join(
        _base_data_lines + ([one_to_one_fk_data_lines] if one_to_one_fk_data_lines else [])
    )
    parent_data_obj_update = '\n'.join(_base_data_lines)
    validation_data_obj  = '\n'.join(f"      {p['prop']}: {p['var_name']}," for p in parent_prop_infos)
    # Synthetic object spreading created record with nested auto-create OTO stubs for afterCreate
    one_to_one_spread = ', '.join(
        f"{r['relation_name']}: {{ id: created.{r['prop_name']} }}"
        for r in auto_create_oto_rels
    )
    one_to_one_include = ''  # not used with explicit creation approach

    # Snapshot
    snapshot_field_mappings = '\n'.join(
        f"    {p['prop']}: normalizeValue(safeSnapshot.{p['prop']}, '{_normalize_kind(p['def'])}'),"
        for p in parent_prop_infos
    )

    # Form data gets (for actions / API POST)
    form_data_gets = _build_form_data_gets(parent_prop_infos)
    parent_params_no_bridge = parent_params  # pre-bridge version for updateXxx calls
    if bridge_child_ir:
        _sep = ', ' if parent_params else ''
        parent_params = parent_params + _sep + 'selectedParentType, selectedParentId'
        _bc_fds = (
            "  const selectedParentType = data.get('selectedParentType') as string;\n"
            "  const selectedParentId = data.get('selectedParentId') as string;"
        )
        form_data_gets = (form_data_gets + '\n' + _bc_fds) if form_data_gets else _bc_fds

    # Children (full analysis)
    children_data    = _build_child_data(children_raw, model, schema, parent_rels_raw)
    non_comment_ch   = [c for c in children_data if c.get('output_type') != 'comments']
    # Detect bridge-based comments via one-to-one rel to 'commentable'
    commentable_rel = next((r for r in one_to_one_rels if r['target'] == 'commentable'), None)
    if commentable_rel:
        comment_children = [{'bridge': True, 'property_name': commentable_rel['relation_name'], 'name': 'comment'}]
    else:
        comment_children = [c for c in children_data if c.get('output_type') == 'comments']
    # Embedded children: exclude independent list children (have own pages; shown read-only here).
    # Non-independent mandatory-FK list children (no own page) are embedded with full CRUD.
    # Many-to-many and optional-FK list children (use_connect=True) use connect/set.
    embedded_ch      = [c for c in non_comment_ch if c['use_connect'] or c.get('output_type') != 'list' or not c['is_independent']]

    child_form_data_extractions = _build_child_form_data_extractions(embedded_ch)

    child_params_for_add    = ', '.join(
        f"{c['child_var']}Ids: string[]" if c['use_connect'] else f"{c['child_var']}Items: {c['field_type']}[]"
        for c in embedded_ch
    )
    child_params_for_update = ', '.join(
        f"{c['child_var']}Ids: string[]" if c['use_connect'] else f"{c['child_var']}Items: {c['field_type_with_id']}[]"
        for c in embedded_ch
    )
    child_args_for_call = ', '.join(
        f"{c['child_var']}Ids" if c['use_connect'] else f"{c['child_var']}Items"
        for c in embedded_ch
    )

    child_nested_create = _build_child_nested_create(embedded_ch)
    child_nested_update = _build_child_nested_update(embedded_ch)

    # Self-parent relationship (for tree structures)
    self_parent_rel  = next((r for r in parent_rels_raw if r['target'] == model), None)
    self_parent_prop = self_parent_rel['prop_name'] if self_parent_rel else None

    # Comment actions code
    if commentable_rel:
        comment_actions_code = _build_comment_actions_bridge(parent, model, has_assignee_id)
    else:
        comment_actions_code = _build_comment_actions(comment_children, parent, model, has_assignee_id)

    # Snapshot child mappings (for service)
    snapshot_child_mappings = '\n'.join(
        f"    {c['property_name']}: normalizeChildRefs(safeSnapshot.{c['property_name']}),"
        for c in embedded_ch
    )
    snapshot_include_props = (
        ',\n    include: {\n      ' +
        ',\n      '.join(f"{c['property_name']}: {{ select: {{ id: true }} }}" for c in embedded_ch) +
        '\n    }'
        if embedded_ch else ''
    )

    # Selection targets (page_new, page_edit)
    selection_targets = _get_selection_targets(children_raw, parent_rels_raw, schema, model)
    # Extend with bridge parent targets so child forms load parent entity autocomplete options
    if bridge_child_ir:
        selection_targets = _dedupe_ordered([*selection_targets, *bridge_child_ir.get('parent_targets', [])])

    # Field categorisation (for FormUpsert / FormView)
    # Use all_oto_fk_props to exclude BOTH auto-create and selector OTO FK props from plain field treatment
    field_categories = _categorize_form_fields(filtered_props, parent_rels_raw, gen_cfg, all_oto_fk_props)

    # Default props (page_new)
    def _default_value(k: str, defn: dict) -> str:
        actual = _get_actual_type(defn)
        fmt    = defn.get('format')
        is_req = k in (model_def.get('required') or [])
        is_null = _is_nullable(defn)
        if actual == 'string' and fmt in ('date', 'date-time', 'time'):
            return 'null'
        if actual in ('integer', 'number'):
            return 'null'
        if actual == 'string':
            return "''"
        if actual == 'boolean':
            return 'false'
        return 'null'

    parent_default_props = '\n'.join(
        f"    {k}: {_default_value(k, defn)},"
        for k, defn in filtered_props.items()
        if k not in _EXCLUDE_ID_TS and k != 'id' and k not in auto_create_oto_fk_props
    )

    # Chart config
    xdisplay    = (model_def or {}).get('x-display') or {}
    chart_cfg   = xdisplay.get('chart') if isinstance(xdisplay, dict) else None

    # x-display table config
    xdisplay_table_raw = None
    if isinstance(xdisplay, list):
        xdisplay_table_raw = xdisplay
    elif isinstance(xdisplay, dict) and isinstance(xdisplay.get('table'), list):
        xdisplay_table_raw = xdisplay['table']
    has_chart = bool(chart_cfg)

    # Detect virtual columns: fields in x-display.table that are absent from both
    # model properties AND relation display names ({field}_id in properties).
    # Fields derived from a FK relation (e.g. role←role_id) are handled by the
    # existing relation system and must NOT be treated as virtual columns.
    # Prisma auto-managed datetime fields (created_at, updated_at) are handled
    # separately as datetime_display_columns — not as virtual columns.
    _PRISMA_DATETIME_COLS = frozenset({'created_at', 'updated_at'})
    _model_props_for_virtual = (model_def or {}).get('properties') or {}
    virtual_columns: list[dict] = []
    # datetime columns in x-display.table (Prisma auto-managed, not in schema props)
    datetime_display_columns: list[str] = []
    if xdisplay_table_raw:
        for _vitem in xdisplay_table_raw:
            _vfn = list(_vitem.keys())[0]
            if _vfn in _PRISMA_DATETIME_COLS:
                datetime_display_columns.append(_vfn)
                continue
            _is_prop = _vfn in _model_props_for_virtual
            _is_rel  = f'{_vfn}_id' in _model_props_for_virtual
            if not _is_prop and not _is_rel:
                warnings.warn(
                    f"Virtual column '{_vfn}' on '{def_key}': in x-display.table but not in properties. "
                    "Treating as virtual — resolver expected at lib/{entity}/virtual_resolvers.ts"
                )
                # created_by is resolved from the creator relation (creator_id FK).
                # Include creator in the main query and map directly instead of
                # using virtual_resolvers.ts (which proved unreliable in production).
                # creator_id is auto-managed (not in JSON schema properties) so we
                # detect this pattern by field name alone.
                _is_creator_virtual = (_vfn == 'created_by')
                virtual_columns.append({
                    'field_name': _vfn,
                    'field_pascal': to_pascal_case(_vfn),
                    'field_key': to_camel_case(_vfn),
                    'is_creator_virtual': _is_creator_virtual,
                })

    # Detail def for custom components (entity-level: list of components, plural key).
    # Each item: {name, path?, target?}. Default target is ['list'] (backward compat).
    detail_def = schema['definitions'].get(def_key, {})
    _xcc_list_raw = detail_def.get('x-custom-components') or []
    if not isinstance(_xcc_list_raw, list):
        raise ValueError(
            f"x-custom-components on '{def_key}' must be a list of component objects; "
            f"got {type(_xcc_list_raw).__name__}"
        )
    _xcc_items = []
    for _item in _xcc_list_raw:
        if not isinstance(_item, dict) or not _item.get('name'):
            continue
        _xcc_items.append({
            'name': _item['name'],
            'path': _item.get('path'),
            'target': _item.get('target') or ['list'],
        })
    # Per-target lists. Each entry is {name, path?} so templates can iterate.
    entity_custom_components = [
        {'name': i['name'], 'path': i['path']}
        for i in _xcc_items if 'list' in i['target']
    ]
    entity_view_components = [
        {'name': i['name'], 'path': i['path']}
        for i in _xcc_items if 'view' in i['target']
    ]
    entity_edit_components = [
        {'name': i['name'], 'path': i['path']}
        for i in _xcc_items if 'edit' in i['target']
    ]

    # Service args helpers
    parent_service_args = ', '.join(
        f"{p['var_name']} ?? null" if _is_nullable(p['def']) else p['var_name']
        for p in parent_prop_infos
    )
    child_service_args = ', '.join(
        f"{c['child_var']}_ids ?? []" if c['use_connect'] else f"{c['property_name']} ?? []"
        for c in embedded_ch
    )

    # Getters: include entries (list page).
    # When a relation's labelField walks through deeper m2o/o2o (e.g.
    # `patient_rel.patient.name`), the include must mirror that chain so
    # Prisma actually loads the data the label expression dereferences.
    from helpers.label_field import build_label_expression, render_prisma_include

    def _include_entry_for_rel(rel: dict) -> str:
        target = rel.get('target', '')
        label_field = rel.get('label_field')
        if not target or not label_field or label_field == 'name':
            return f"{rel['relation_name']}: true"
        try:
            built = build_label_expression('item', label_field, target, schema)
        except ValueError:
            return f"{rel['relation_name']}: true"
        nested = built.get('prisma_include') or {}
        if not nested:
            return f"{rel['relation_name']}: true"
        return f"{rel['relation_name']}: {{ include: {{ {render_prisma_include(nested)} }} }}"

    include_entries_list = [_include_entry_for_rel(r) for r in parent_rels]
    # Selector OTO rels are included in list so the relation column can be displayed
    include_entries_list.extend(_include_entry_for_rel(r) for r in selector_oto_rels)
    # creator virtual columns: include creator relation directly in the list query
    if any(vc.get('is_creator_virtual') for vc in virtual_columns):
        include_entries_list.append('creator: { select: { name: true } }')
    # Bridge child (Stage 3): add bridge parent include to list query so parent_type/label can be resolved.
    if bridge_child_ir and bridge_parent_options:
        _bc_bn_list = bridge_child_ir['name']
        _bpo_sel_list = ', '.join(
            f"{bpo['target']}: {{ select: {{ id: true, {bpo['label_field']}: true }} }}"
            for bpo in bridge_parent_options
        )
        include_entries_list.append(f"{_bc_bn_list}: {{ include: {{ {_bpo_sel_list} }} }}")
    include_props_list   = ', '.join(include_entries_list)

    # searchXxxOptions returns target rows for OTHER entities' autocompletes.
    # Each consumer renders the label using its OWN labelField path, so the
    # search include must be the union of (a) the target's own parent_rels
    # (above) and (b) any cross-entity labelField paths that point at this
    # entity. Without (b), e.g. lifestyle's form-side label expression
    # `item.patient_rel?.patient?.name` would resolve to '' because
    # searchCheckupOptions wouldn't have included `patient_rel.patient`.
    def _merge_include(dst: dict, src: dict) -> dict:
        for k, v in src.items():
            if k not in dst:
                dst[k] = v
            else:
                # Both must end up as nested includes.
                if dst[k] is True and isinstance(v, dict):
                    dst[k] = v
                elif isinstance(dst[k], dict) and v is True:
                    pass  # keep richer one
                elif isinstance(dst[k], dict) and isinstance(v, dict):
                    inner_dst = dst[k].setdefault('include', {})
                    inner_src = v.get('include', {}) or {}
                    _merge_include(inner_dst, inner_src)
        return dst

    consumer_includes: dict = {}
    for other_def in schema.get('definitions', {}).values():
        if not isinstance(other_def, dict):
            continue
        for other_prop_name, other_prop in (other_def.get('properties', {}) or {}).items():
            if not isinstance(other_prop, dict):
                continue
            other_rel = other_prop.get('x-relationship') or {}
            if other_rel.get('target') != entity['model']:
                continue
            other_label = other_rel.get('labelField')
            if not other_label:
                continue
            try:
                other_built = build_label_expression('item', other_label, entity['model'], schema)
            except ValueError:
                continue
            _merge_include(consumer_includes, other_built.get('prisma_include') or {})

    # Union: take own includes (already deepened by labelField on this entity)
    # and merge in the cross-entity consumer paths.
    own_include_dict: dict = {}
    for r in list(parent_rels) + list(selector_oto_rels):
        target = r.get('target', '')
        label_field = r.get('label_field')
        if not target or not label_field:
            own_include_dict[r['relation_name']] = True
            continue
        try:
            built = build_label_expression('item', label_field, target, schema)
        except ValueError:
            own_include_dict[r['relation_name']] = True
            continue
        nested = built.get('prisma_include') or {}
        if not nested:
            own_include_dict[r['relation_name']] = True
        else:
            own_include_dict[r['relation_name']] = {'include': nested}

    search_include_dict: dict = {}
    _merge_include(search_include_dict, own_include_dict)
    _merge_include(search_include_dict, consumer_includes)
    search_include_props_list = render_prisma_include(search_include_dict)
    # creator virtual columns: include creator in search query too (render_prisma_include
    # does not support 'select', so append the raw TS fragment after rendering)
    if any(vc.get('is_creator_virtual') for vc in virtual_columns):
        creator_frag = 'creator: { select: { name: true } }'
        search_include_props_list = (
            f"{search_include_props_list}, {creator_frag}"
            if search_include_props_list else creator_frag
        )

    child_include_entries = []
    for c in children_raw:
        cn       = c['name']
        prop     = c['property_name']
        out_type = c.get('output_type')
        cdef     = schema['definitions'].get(cn, {})
        if out_type == 'comments':
            child_include_entries.append(
                f"{prop}: {{ include: {{ creator: {{ select: {{ id: true, name: true, image: true }} }},"
                f" reactions: {{ select: {{ type: true, user_id: true }} }} }},"
                f" orderBy: {{ created_at: 'asc' }} }}"
            )
        elif not cdef.get('properties'):
            child_include_entries.append(f"{prop}: true")
        else:
            child_rels = get_parent_relationships(cdef)
            if not child_rels:
                child_include_entries.append(f"{prop}: true")
            else:
                # Base include map from the child's own parent relationships
                child_include_map: dict = {r['prop_name'].removesuffix('_id'): True for r in child_rels}

                # If the parent declared a label_field on this child that walks
                # deeper relations (e.g. 'buyer.user.name'), merge the built
                # prisma include so nested relations are fetched server-side.
                rel_info = c.get('relationship') or {}
                label_field = rel_info.get('label_field') or rel_info.get('labelField')
                target = rel_info.get('target')
                if target and label_field and label_field != 'name':
                    try:
                        built = build_label_expression('item', label_field, target, schema)
                        nested = built.get('prisma_include') or {}
                    except ValueError:
                        nested = {}

                    # Merge nested includes into the child's include map
                    def _merge_into_child(ci: dict, src: dict):
                        for k, v in src.items():
                            if v is True:
                                ci[k] = True
                            else:
                                include_val = v.get('include') if isinstance(v, dict) and 'include' in v else v
                                existing = ci.get(k)
                                if existing is True or existing is None:
                                    ci[k] = {'include': include_val}
                                elif isinstance(existing, dict) and 'include' in existing:
                                    # merge inner include dicts
                                    inner = existing['include']
                                    for kk, vv in (include_val.items() if isinstance(include_val, dict) else []):
                                        if kk not in inner:
                                            inner[kk] = vv
                                        else:
                                            # prefer richer nested dicts when possible
                                            if isinstance(inner[kk], dict) and isinstance(vv, dict):
                                                inner[kk].setdefault('include', {}).update(vv.get('include', vv))

                    if nested:
                        _merge_into_child(child_include_map, nested)

                # Render the merged include map into source string
                parts: list[str] = []
                for k, v in child_include_map.items():
                    if v is True:
                        parts.append(f"{k}: true")
                    elif isinstance(v, dict) and 'include' in v:
                        parts.append(f"{k}: {{ include: {{ {render_prisma_include(v['include'])} }} }}")
                    else:
                        parts.append(f"{k}: true")

                child_include_entries.append(f"{prop}: {{ include: {{ {', '.join(parts)} }} }}")

    # Include entries for auto-create one-to-one rels with their nested children
    one_to_one_include_entries = []
    for r in auto_create_oto_rels:
        if not r['children']:
            one_to_one_include_entries.append(f"{r['relation_name']}: true")
        else:
            nested_parts = []
            for c in r['children']:
                # Exclude back-ref to the one-to-one parent (avoid circular include)
                forward_rels = [cr for cr in c['child_rels'] if cr['target'] != r['target']]
                if forward_rels:
                    sub_parts = []
                    for cr in forward_rels:
                        rel_name = cr['prop_name'].removesuffix('_id')
                        sub_target_def = schema['definitions'].get(cr['target'], {})
                        sub_target_rels = get_parent_relationships(sub_target_def)
                        if sub_target_rels:
                            sub_sub = ', '.join(
                                f"{sr['prop_name'].removesuffix('_id')}: true"
                                for sr in sub_target_rels
                            )
                            sub_parts.append(f"{rel_name}: {{ include: {{ {sub_sub} }} }}")
                        else:
                            sub_parts.append(f"{rel_name}: true")
                    # approval_request always carries approval_histories and approval_flow.preceded_by
                    if c.get('child_name') == 'approval_request':
                        # Inject preceded_by into the approval_flow include
                        for i, part in enumerate(sub_parts):
                            if part.startswith('approval_flow:'):
                                sub_parts[i] = (
                                    "approval_flow: { include: { requestor_role: true, approver_role: true,"
                                    " preceded_by: { select: { id: true } } } }"
                                )
                                break
                        sub_parts.append(
                            "approval_histories: { include: { creator: { select: { id: true, name: true } } },"
                            " orderBy: { created_at: 'asc' } }"
                        )
                    # comment children always carry creator + orderBy (no FK rels defined in schema)
                    if c.get('child_name') == 'comment':
                        nested_parts.append(
                            f"comments: {{ include: {{ creator: {{ select: {{ id: true, name: true, image: true }} }},"
                            f" reactions: {{ select: {{ type: true, user_id: true }} }} }},"
                            f" orderBy: {{ created_at: 'asc' }} }}"
                        )
                    else:
                        nested_parts.append(f"{c['property_name']}: {{ include: {{ {', '.join(sub_parts)} }} }}")
                else:
                    # comment child has no FK rels in schema — emit include + orderBy directly
                    if c.get('child_name') == 'comment':
                        nested_parts.append(
                            f"comments: {{ include: {{ creator: {{ select: {{ id: true, name: true, image: true }} }},"
                            f" reactions: {{ select: {{ type: true, user_id: true }} }} }},"
                            f" orderBy: {{ created_at: 'asc' }} }}"
                        )
                    else:
                        nested_parts.append(f"{c['property_name']}: true")
            nested = ', '.join(nested_parts)
            one_to_one_include_entries.append(
                f"{r['relation_name']}: {{ include: {{ {nested} }} }}"
            )

    # Bridge child (Stage 3): upgrade the flat bridge include to nested parent selects in the detail query.
    if bridge_child_ir and bridge_parent_options:
        _bc_bn_det = bridge_child_ir['name']
        _bpo_sel_det = ', '.join(
            f"{bpo['target']}: {{ select: {{ id: true, {bpo['label_field']}: true }} }}"
            for bpo in bridge_parent_options
        )
        _bridge_nested_det = f"{_bc_bn_det}: {{ include: {{ {_bpo_sel_det} }} }}"
        one_to_one_include_entries = [
            _bridge_nested_det if e == f"{_bc_bn_det}: true" else e
            for e in one_to_one_include_entries
        ]
        # Bridge is not in auto_create_oto_rels (it uses its own slot), so the
        # upgrade above may be a no-op.  Append directly if still absent.
        if _bridge_nested_det not in one_to_one_include_entries:
            one_to_one_include_entries.append(_bridge_nested_det)

    # Selector OTO rels included simply — they are independent entities with their own pages
    selector_oto_include_entries = [f"{r['relation_name']}: true" for r in selector_oto_rels]

    # Reverse OTO rels included simply (no FK in this model); use relation_name for Prisma key
    reverse_oto_include_entries = [f"{r['relation_name']}: true" for r in reverse_oto_rels]

    # Detail-page parent_rels include: merge labelField path includes (so e.g.
    # lifestyle.checkup with labelField `patient_rel.patient.name` deepens to
    # `checkup: { include: { patient_rel: { include: { patient: true } } } }`)
    # with the legacy `_flatten_m2o_nested` overrides (which surface nested FK
    # labels inside the flatten section). When both are present, the flatten
    # override wins because it carries strictly more nested data; when only one
    # of them is present, that one's include is emitted.
    def _detail_entry_for_rel(rel: dict) -> str:
        rel_name = rel['relation_name']
        flatten_override = _flatten_m2o_nested.get(rel_name)
        if flatten_override:
            return f"{rel_name}: {flatten_override}"
        return _include_entry_for_rel(rel)

    detail_parent_rel_entries  = [_detail_entry_for_rel(r) for r in parent_rels]
    # Selector OTO rels are independent entities, but their labelField may walk
    # into deeper relations too (e.g. lifestyle.checkup_id labelField uses
    # `patient_rel.patient.name`) — apply the same deepening as for m2o.
    detail_selector_oto_entries = [_include_entry_for_rel(r) for r in selector_oto_rels]

    # Per-selector-OTO include rendered for use by getAvailableXxxsForYyy.
    # Without this, `initialAvailableCheckups` (the prop seeding the form's
    # autocomplete) would return checkup rows without `patient_rel.patient`,
    # so the lifestyle picker's options would render with an empty patient
    # name even though `searchCheckupOptions` returns the deeper data.
    for r in selector_oto_rels:
        target = r.get('target', '')
        label_field = r.get('label_field')
        if not target or not label_field:
            r['available_include'] = ''
            continue
        try:
            built_avail = build_label_expression('item', label_field, target, schema)
        except ValueError:
            r['available_include'] = ''
            continue
        nested = built_avail.get('prisma_include') or {}
        r['available_include'] = render_prisma_include(nested) if nested else ''

    include_entries_detail = [
        *child_include_entries,
        *detail_parent_rel_entries,
        *one_to_one_include_entries,
        *detail_selector_oto_entries,
        *reverse_oto_include_entries,
        *flatten_non_m2o_include_entries,
        "creator: { select: { id: true, name: true } }",
        "updater: { select: { id: true, name: true } }",
    ]
    include_props_detail = ', '.join(include_entries_detail)
    creator_filtered_props = copy.deepcopy(filtered_props)
    creator_filtered_props['creator_id'] = {'type': 'string'}

    _parent_mapping_lines = [
        f"    {k}: {parent_camel}.{k},"
        for k in creator_filtered_props
        if k not in _EXCLUDE_FIELDS
    ]
    # Prisma auto-managed datetime columns displayed via x-display.table
    for _dtcol in datetime_display_columns:
        _parent_mapping_lines.append(
            f"    {_dtcol}: {parent_camel}.{_dtcol}\n"
            f"      ? {parent_camel}.{_dtcol}.toISOString().replace('T', ' ').slice(0, 19)\n"
            f"      : '',"
        )
    parent_mapping = '\n'.join(_parent_mapping_lines)
    relationship_mapping = '\n'.join(
        f"    {r['relation_name']}: {parent_camel}.{r['relation_name']},"
        for r in parent_rels
    ) + (
        '\n' + '\n'.join(
            f"    {r['relation_name']}: {parent_camel}.{r['relation_name']},"
            for r in selector_oto_rels
        ) if selector_oto_rels else ''
    )
    # Note: reverse_oto_rels are NOT in relationship_mapping because they are not included in
    # the list query. They are fetched only in the detail query and auto-spread via { ...entity }.
    def _virtual_map_line(vc: dict) -> str:
        if vc.get('is_creator_virtual'):
            return f"    {vc['field_name']}: {parent_camel}.creator?.name ?? '',"
        return f"    {vc['field_name']}: virtualData.get(String({parent_camel}.id ?? ''))?.{vc['field_name']} ?? '',"
    virtual_mapping = '\n'.join(_virtual_map_line(vc) for vc in virtual_columns)
    # Bridge child (Stage 3): inline IIFE mapping for parent_type and parent_label.
    # These do not go through virtual_resolvers.ts — computed directly from the bridge include.
    if bridge_child_ir and bridge_parent_options:
        _bc_bn_vm = bridge_child_ir['name']
        _eda = '      // eslint-disable-next-line @typescript-eslint/no-explicit-any'
        _type_cases = '\n'.join(
            f"{_eda}\n      if ((({parent_camel} as any).{_bc_bn_vm})?.{bpo['target']}) return '{bpo['target']}';"
            for bpo in bridge_parent_options
        )
        _label_cases = '\n'.join(
            f"{_eda}\n"
            f"      if ((({parent_camel} as any).{_bc_bn_vm})?.{bpo['target']})"
            f" return String((({parent_camel} as any).{_bc_bn_vm})?.{bpo['target']}.{bpo['label_field']} ?? '');"
            for bpo in bridge_parent_options
        )
        _bp_virt_lines = (
            f"    parent_type: (() => {{\n{_type_cases}\n      return null;\n    }})(),\n"
            f"    parent_label: (() => {{\n{_label_cases}\n      return null;\n    }})(),"
        )
        virtual_mapping = ((virtual_mapping + '\n') if virtual_mapping else '') + _bp_virt_lines
    non_creator_virtual_columns = [vc for vc in virtual_columns if not vc.get('is_creator_virtual')]
    child_mappings = '\n'.join(
        f"    {c['property_name']}: {parent_camel}.{c['property_name']},"
        for c in children_raw
    )

    # All body fields for API routes
    all_body_fields_create = ', '.join([
        *(p['prop'] if p['prop'] == p['var_name'] else f"{p['prop']}: {p['var_name']}"
          for p in parent_prop_infos),
        *(f"{c['child_var']}_ids" if c['use_connect'] else c['property_name']
          for c in embedded_ch),
    ])
    # Null placeholders for flatten rel params (API routes don't edit flatten rels inline)
    _flatten_null_args = ', '.join(
        'null'
        for r in flatten_rels
        if not r['is_m2o'] and any(not f.get('is_fk') for f in r['fields'])
    )
    service_args_for_create = f"actorId, {parent_service_args}" + (
        f", {child_service_args}" if child_service_args else ""
    ) + (f", {_flatten_null_args}" if _flatten_null_args else "")
    if bridge_child_ir:
        service_args_for_create += ", selectedParentType, selectedParentId"
        all_body_fields_create = (
            (all_body_fields_create + ", " if all_body_fields_create else "")
            + "selectedParentType, selectedParentId"
        )
    service_args_for_update = f"actorId, id, {parent_service_args}" + (
        f", {child_service_args}" if child_service_args else ""
    ) + (f", {_flatten_null_args}" if _flatten_null_args else "")

    # Named constants for x-internal entities (e.g. COMMENT_REACTION_TYPES)
    from generate_types import extract_named_constants
    _all_named_constants = extract_named_constants(schema)

    # Batched groupBy context for getCommentReactions — consumed by service/132b templates
    reaction_batch_query = (
        {
            "fn_name": "getCommentReactions",
            "input": "commentIds: string[]",
            "return_type": "Promise<CommentReactionSummary[]>",
            "strategy": "batched_group_by",
        }
        if comment_children else None
    )

    return dict(
        # Naming
        parent=parent,
        model=model,
        def_key=def_key,
        parent_pascal=parent_pascal,
        parent_camel=parent_camel,
        # Schema / config
        filtered_props=filtered_props,
        model_def=model_def,
        gen_cfg=gen_cfg,
        can_create=can_create,
        can_update=can_update,
        can_delete=can_delete,
        can_list=can_list,
        can_view=can_view,
        # Relationships
        parent_rels=parent_rels,
        parent_rels_raw=parent_rels_raw,
        relationship_targets=relationship_targets,
        should_filter_by_org=should_filter_by_org,
        has_assignee_id=has_assignee_id,
        is_audited=is_audited,
        item_context_select=item_context_select,
        sortable_fields_quoted=sortable_fields_quoted,
        filterable_fields_quoted=filterable_fields_quoted,
        searchable_text_fields=searchable_text_fields,
        default_search_order_field=default_search_order_field,
        default_search_order_dir=default_search_order_dir,
        self_parent_prop=self_parent_prop,
        # Props
        parent_prop_infos=parent_prop_infos,
        parent_params=parent_params,
        parent_params_no_bridge=parent_params_no_bridge,
        parent_params_with_types=parent_params_with_types,
        parent_data_obj=parent_data_obj,
        parent_data_obj_update=parent_data_obj_update,
        validation_data_obj=validation_data_obj,
        parent_default_props=parent_default_props,
        parent_mapping=parent_mapping,
        relationship_mapping=relationship_mapping,
        # Children
        children_raw=children_raw,
        children_data=children_data,
        non_comment_ch=embedded_ch,
        comment_children=comment_children,
        has_commentable=bool(commentable_rel),
        commentable_rel_name=commentable_rel['relation_name'] if commentable_rel else None,
        child_mappings=child_mappings,
        child_form_data_extractions=child_form_data_extractions,
        child_params_for_add=child_params_for_add,
        child_params_for_update=child_params_for_update,
        child_args_for_call=child_args_for_call,
        child_nested_create=child_nested_create,
        child_nested_update=child_nested_update,
        comment_actions_code=comment_actions_code,
        # FormData
        form_data_gets=form_data_gets,
        # Service / snapshots
        snapshot_field_mappings=snapshot_field_mappings,
        snapshot_child_mappings=snapshot_child_mappings,
        snapshot_include_props=snapshot_include_props,
        # Getters
        include_props_list=include_props_list,
        search_include_props_list=search_include_props_list,
        include_props_detail=include_props_detail,
        include_entries_detail=include_entries_detail,
        # Selection targets (page_new / page_edit)
        selection_targets=selection_targets,
        # API routes
        all_body_fields_create=all_body_fields_create,
        service_args_for_create=service_args_for_create,
        service_args_for_update=service_args_for_update,
        # Field categories (FormUpsert / FormView)
        field_categories=field_categories,
        entity_select_options=_get_entity_options(schema),
        # Chart
        chart_cfg=chart_cfg,
        has_chart=has_chart,
        xdisplay=xdisplay,
        xdisplay_table=xdisplay_table_raw,
        # Virtual columns: fields in x-display.table but not in properties.
        virtual_columns=virtual_columns,
        non_creator_virtual_columns=non_creator_virtual_columns,
        virtual_mapping=virtual_mapping,
        # Prisma auto-managed datetime columns displayed via x-display.table
        datetime_display_columns=datetime_display_columns,
        # One-to-one outbound FK rels
        one_to_one_rels=auto_create_oto_rels,      # auto-create OTO only (for types/service templates)
        selector_oto_rels=selector_oto_rels,        # selector OTO (autocomplete UI, filtered getters)
        reverse_oto_rels=reverse_oto_rels,          # reverse OTO: FK in target pointing back to this model
        flatten_rels=flatten_rels,                  # flatten rels: shown as accordion in detail view
        flatten_m2o_fk_props=flatten_m2o_fk_props, # FK prop names in parent for m2o flatten rels
        one_to_one_pre_creates=one_to_one_pre_creates,
        one_to_one_spread=one_to_one_spread,
        one_to_one_include=one_to_one_include,
        # FK-on-parent bridge IR
        bridge_parent_options=bridge_parent_options,   # per-parent display metadata for bridge children
        bridge_child_ir=bridge_child_ir,              # new-form x-bridge on this entity (as child)
        bridge_child_params_str=bridge_child_params_str,      # extra service params for child parent selection
        bridge_child_pre_create_code=bridge_child_pre_create_code,  # parent resolution code before create
        bridge_child_fk_data_line=bridge_child_fk_data_line,  # FK line for create data object
        bridge_cleanup_rels=bridge_cleanup_rels,       # bridges this entity owns (for parent delete cleanup)
        bridge_pre_delete_select=bridge_pre_delete_select,   # select clause string for parent delete
        bridge_post_delete_cleanups=bridge_post_delete_cleanups, # cleanup delete statements for template
        # Page list / view / edit custom components (entity-level, plural).
        entity_custom_components=entity_custom_components,
        entity_view_components=entity_view_components,
        entity_edit_components=entity_edit_components,
        # Helpers exposed for templates
        to_camel_case=to_camel_case,
        to_pascal_case=to_pascal_case,
        to_pascal_case_from_var=to_pascal_case_from_var,
        to_title_case=to_title_case,
        safe_var_name=safe_var_name,
        singularize=singularize,
        get_ts_type=get_ts_type,
        has_string_labels=_has_string_labels,
        int_enum_option=_int_enum_option,
        normalize_kind=_normalize_kind,
        is_date_field=_is_date_field,
        get_actual_type=_get_actual_type,
        is_nullable=_is_nullable,
        # Named constants (x-internal integer enum entities → TS export consts)
        named_constants=_all_named_constants,
        # Batched groupBy context for getCommentReactions (used by service/132b templates)
        reaction_batch_query=reaction_batch_query,
        # Read-only fields: explicit schema annotations (x-readonly / x-readonly-fields).
        # Stage 2 extends this with automatic bridge parent fields.
        readonly_fields=readonly_fields,
        readonly_fields_api=readonly_fields_api,
        readonly_fields_api_select=readonly_fields_api_select,
    )
