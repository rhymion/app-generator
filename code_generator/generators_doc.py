"""generators_doc.py — Context builders for documentation generation.

Produces contexts for:
  - doc_entity.md.jinja2  (one file per entity → docs/generated/{parent}.md)
  - doc_index.md.jinja2   (top-level index  → docs/generated/index.md)
"""

from helpers.naming import to_title_case

_READONLY_FIELDS = {'id', 'created_at', 'updated_at', 'creator_id'}


# ---------------------------------------------------------------------------
# Field type / note helpers
# ---------------------------------------------------------------------------

def _field_type_str(defn: dict) -> str:
    """Human-readable type string from a JSON Schema field definition."""
    t = defn.get('type')
    fmt = defn.get('format')
    enum_vals = defn.get('enum')
    nullable = isinstance(t, list) and 'null' in t
    actual = next((x for x in t if x != 'null'), None) if isinstance(t, list) else t

    if actual == 'string' and fmt == 'date-time':
        base = 'datetime'
    elif actual == 'string' and fmt == 'date':
        base = 'date'
    elif actual == 'string' and fmt == 'time':
        base = 'time'
    elif actual == 'string' and fmt == 'uri':
        base = 'uri'
    elif actual in ('integer', 'number') and enum_vals:
        base = 'integer'
    elif actual in ('integer', 'number'):
        base = 'number'
    elif actual == 'boolean':
        base = 'boolean'
    elif actual == 'string' and enum_vals:
        base = 'enum'
    elif actual == 'string':
        base = 'string'
    elif actual == 'array':
        base = 'array'
    else:
        base = actual or 'any'

    return f'{base} \\| null' if nullable else base


def _field_notes_str(defn: dict) -> str:
    """Constraint notes for a JSON Schema field definition (Markdown-safe)."""
    parts = []
    if defn.get('minLength'):
        parts.append(f'min {defn["minLength"]} chars')
    if defn.get('maxLength'):
        parts.append(f'max {defn["maxLength"]} chars')
    if defn.get('minimum') is not None:
        parts.append(f'min: {defn["minimum"]}')
    if defn.get('maximum') is not None:
        parts.append(f'max: {defn["maximum"]}')
    enum_vals = defn.get('enum')
    if enum_vals:
        vals = ', '.join(f'`{v}`' for v in enum_vals)
        parts.append(f'values: {vals}')
    rel = defn.get('x-relationship')
    if rel:
        target = rel.get('target', '')
        label = rel.get('labelField')
        parts.append(f'FK → [{target}]({target}.md) (label: `{label}`)')
    pattern = defn.get('pattern')
    if pattern and 'c[a-z0-9]' in pattern:
        parts.append('CUID')
    if defn.get('format') == 'uri':
        parts.append('URL')
    default = defn.get('default')
    if default is not None:
        parts.append(f'default: `{default}`')
    return ', '.join(parts) if parts else ''


def _api_hint(defn: dict) -> str:
    """Example JSON value for a field (used in request body snippets)."""
    t = defn.get('type')
    fmt = defn.get('format')
    enum_vals = defn.get('enum')
    nullable = isinstance(t, list) and 'null' in t
    actual = next((x for x in t if x != 'null'), None) if isinstance(t, list) else t

    if actual == 'string' and fmt == 'date-time':
        return '"2024-01-01T00:00:00.000Z"'
    if actual == 'string' and fmt == 'date':
        return '"2024-01-01"'
    if actual == 'string' and fmt == 'time':
        return '"09:00:00"'
    if actual in ('integer', 'number') and enum_vals:
        return str(enum_vals[0])
    if actual in ('integer', 'number'):
        return '0'
    if actual == 'boolean':
        return 'false'
    if actual == 'string' and enum_vals:
        return f'"{enum_vals[0]}"'
    if actual == 'string':
        return 'null' if nullable else '"..."'
    return 'null'


def _response_hint(name: str, type_str: str) -> str:
    """Example JSON value for a field in a response snippet."""
    if name == 'id':
        return '"clxxxxxxxxxxxxxxxxxxxxxxxx"'
    if 'datetime' in type_str:
        return '"2024-01-01T00:00:00.000Z"'
    if type_str == 'date':
        return '"2024-01-01"'
    if type_str == 'time':
        return '"09:00:00"'
    if type_str in ('number', 'integer'):
        return '0'
    if type_str == 'boolean':
        return 'false'
    if 'null' in type_str:
        return 'null'
    return '"..."'


# ---------------------------------------------------------------------------
# JSON body snippet builders
# ---------------------------------------------------------------------------

def _build_request_body_json(writable_fields: list, child_body_fields: list) -> str:
    all_fields = [
        {'name': f['name'], 'hint': f['hint']} for f in writable_fields
    ] + [
        {'name': f['name'], 'hint': f['hint']} for f in child_body_fields
    ]
    if not all_fields:
        return '{}'
    lines = ['{']
    for i, f in enumerate(all_fields):
        comma = ',' if i < len(all_fields) - 1 else ''
        lines.append(f'  "{f["name"]}": {f["hint"]}{comma}')
    lines.append('}')
    return '\n'.join(lines)


def _build_response_item_json(field_rows: list) -> str:
    if not field_rows:
        return '{}'
    lines = ['{']
    for i, f in enumerate(field_rows):
        comma = ',' if i < len(field_rows) - 1 else ''
        hint = _response_hint(f['name'], f['type'])
        lines.append(f'  "{f["name"]}": {hint}{comma}')
    lines.append('}')
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Main context builder
# ---------------------------------------------------------------------------

def build_doc_entity_context(ctx: dict) -> dict:
    """Build the Jinja2 context for doc_entity.md.jinja2."""
    parent       = ctx['parent']
    model        = ctx['model']
    parent_pascal = ctx['parent_pascal']
    model_def    = ctx['model_def']
    filtered_props = ctx['filtered_props']
    gen_cfg      = ctx['gen_cfg']
    parent_rels  = ctx['parent_rels']
    children_raw = ctx['children_raw']
    non_comment_ch = ctx.get('non_comment_ch', [])
    has_chart    = ctx.get('has_chart', False)
    chart_cfg    = ctx.get('chart_cfg')

    can_list    = ctx.get('can_list',   True)
    can_view    = ctx.get('can_view',   True)
    can_create  = ctx.get('can_create', True)
    can_update  = ctx.get('can_update', True)
    can_delete  = ctx.get('can_delete', True)
    can_api     = gen_cfg.get('api', False)

    required_fields = set(model_def.get('required') or [])
    all_props = model_def.get('properties', {})

    # All fields (displayed in Fields table)
    field_rows = [
        {
            'name':     name,
            'type':     _field_type_str(defn),
            'required': name in required_fields,
            'readonly': name in _READONLY_FIELDS,
            'notes':    _field_notes_str(defn),
        }
        for name, defn in all_props.items()
    ]

    # Writable scalar fields (for request body)
    writable_fields = [
        {
            'name': name,
            'type': _field_type_str(defn),
            'hint': _api_hint(defn),
        }
        for name, defn in filtered_props.items()
        if name not in _READONLY_FIELDS
    ]

    # Child array fields (for request body)
    child_body_fields = []
    for c in non_comment_ch:
        if c.get('use_connect'):
            child_body_fields.append({
                'name': f"{c['child_var']}_ids",
                'type': 'string[]',
                'hint': '["clxxx..."]',
                'description': f'IDs of `{c["name"]}` records to associate (replaces existing)',
            })
        else:
            child_body_fields.append({
                'name': c['property_name'],
                'type': 'object[]',
                'hint': '[{...}]',
                'description': f'`{c["name"]}` child records (all replaced on update)',
            })

    # Relations table
    relations = []
    for r in parent_rels:
        relations.append({
            'field':  r['prop_name'],
            'target': r['target'],
            'type':   'many-to-one',
            'out':    '',
        })
    for child in children_raw:
        rel = child.get('relationship') or {}
        rel_type = rel.get('type', 'one-to-many')
        out_type = child.get('output_type') or ''
        relations.append({
            'field':  child['property_name'],
            'target': child['name'],
            'type':   rel_type,
            'out':    out_type,
        })

    # Operations summary
    ops = []
    if can_list:   ops.append('List')
    if can_view:   ops.append('View')
    if can_create: ops.append('Create')
    if can_update: ops.append('Update')
    if can_delete: ops.append('Delete')

    # Pre-built JSON snippets
    request_body_json  = _build_request_body_json(writable_fields, child_body_fields)
    response_item_json = _build_response_item_json(field_rows)

    return {
        'parent':       parent,
        'model':        model,
        'parent_pascal': parent_pascal,
        'title':        to_title_case(parent),
        'can_list':     can_list,
        'can_view':     can_view,
        'can_create':   can_create,
        'can_update':   can_update,
        'can_delete':   can_delete,
        'can_api':      can_api,
        'has_chart':    has_chart,
        'chart_span':   chart_cfg.get('span')   if chart_cfg else None,
        'chart_row_by': chart_cfg.get('row_by') if chart_cfg else None,
        'operations':   ops,
        'field_rows':   field_rows,
        'writable_fields':   writable_fields,
        'child_body_fields': child_body_fields,
        'relations':    relations,
        'request_body_json':  request_body_json,
        'response_item_json': response_item_json,
    }


def build_doc_index_context(entity_summaries: list) -> dict:
    """Build the Jinja2 context for doc_index.md.jinja2."""
    return {'entities': entity_summaries}


# ---------------------------------------------------------------------------
# GFM → MDX conversion (HTML tables, no remark-gfm needed at runtime)
# ---------------------------------------------------------------------------

import re as _re


def _md_inline_to_html(text: str, link_prefix: str = '') -> str:
    """Convert inline markdown in a table cell to HTML.

    link_prefix: prepended to relative link hrefs (e.g. '../' for entity pages).
    """
    # Preserve inline code content from further substitutions
    codes: list[str] = []

    def save_code(m: '_re.Match[str]') -> str:
        inner = (m.group(1)
                 .replace('&', '&amp;')
                 .replace('<', '&lt;')
                 .replace('>', '&gt;')
                 .replace('{', '&#123;')
                 .replace('}', '&#125;'))
        codes.append(inner)
        return f'\x00CODE{len(codes) - 1}\x00'

    text = _re.sub(r'`([^`]+)`', save_code, text)

    # Escape remaining HTML special chars and JSX expression delimiters
    text = (text
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('{', '&#123;')
            .replace('}', '&#125;'))

    # Markdown links: [label](target.md) and [label](target)
    def replace_link(m: '_re.Match[str]') -> str:
        label = m.group(1)
        href = _re.sub(r'\.md$', '', m.group(2))
        return f'<a href="{link_prefix}{href}">{label}</a>'

    text = _re.sub(r'\[([^\]]+)\]\(([^)]+)\)', replace_link, text)

    # Bold
    text = _re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)

    # Restore inline code
    for i, code in enumerate(codes):
        text = text.replace(f'\x00CODE{i}\x00', f'<code>{code}</code>')

    return text


def _table_lines_to_html(lines: list[str], link_prefix: str) -> str:
    """Convert a block of GFM table lines to an HTML table string."""
    if len(lines) < 2:
        return '\n'.join(lines)

    def split_row(line: str) -> list[str]:
        # Split on unescaped pipes only, then restore \| within cells
        raw = line.strip().strip('|')
        cells = _re.split(r'(?<!\\)\|', raw)
        return [c.strip().replace(r'\|', '|') for c in cells]

    headers = split_row(lines[0])
    separators = split_row(lines[1])

    def alignment(sep: str) -> str:
        if sep.startswith(':') and sep.endswith(':'):
            return " style={{textAlign:'center'}}"
        if sep.endswith(':'):
            return " style={{textAlign:'right'}}"
        return ''

    aligns = [alignment(s) for s in separators]

    parts = ['<table><thead><tr>']
    for i, h in enumerate(headers):
        a = aligns[i] if i < len(aligns) else ''
        parts.append(f'<th{a}>{_md_inline_to_html(h, link_prefix)}</th>')
    parts.append('</tr></thead><tbody>')

    for row_line in lines[2:]:
        cells = split_row(row_line)
        parts.append('<tr>')
        for i, cell in enumerate(cells):
            a = aligns[i] if i < len(aligns) else ''
            parts.append(f'<td{a}>{_md_inline_to_html(cell, link_prefix)}</td>')
        parts.append('</tr>')

    parts.append('</tbody></table>')
    return ''.join(parts)


def convert_md_to_mdx(content: str, link_prefix: str = '') -> str:
    """Convert a GFM markdown string to MDX by replacing pipe tables with HTML tables.

    link_prefix: prepended to relative link hrefs inside table cells
    (use '' for the index page, '../' for entity pages).
    """
    lines = content.split('\n')
    result: list[str] = []
    i = 0
    sep_re = _re.compile(r'^[\s|:\-]+$')

    while i < len(lines):
        line = lines[i]
        # Detect start of a GFM table: a pipe row followed by a separator row
        if (line.strip().startswith('|')
                and i + 1 < len(lines)
                and sep_re.match(lines[i + 1])
                and '|' in lines[i + 1]):
            table_lines = [line]
            j = i + 1
            while j < len(lines) and lines[j].strip().startswith('|'):
                table_lines.append(lines[j])
                j += 1
            result.append(_table_lines_to_html(table_lines, link_prefix))
            i = j
        else:
            result.append(line)
            i += 1

    return '\n'.join(result)
