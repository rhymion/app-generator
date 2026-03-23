"""JSON Schema → TypeScript type mapping — port of helpers/type-mapping.ts"""


def _map_primitive(t: str) -> str:
    return {'string': 'string', 'integer': 'number', 'number': 'number',
            'boolean': 'boolean', 'null': 'null'}.get(t, 'any')


def get_ts_type(prop: dict, for_view_props: bool = False) -> str:
    fmt = prop.get('format')
    is_date = fmt in ('date', 'date-time', 'time')
    prop_type = prop.get('type')

    if isinstance(prop_type, list):
        if is_date:
            return 'Date | null' if ('null' in prop_type or for_view_props) else 'Date'
        return ' | '.join('null' if t == 'null' else _map_primitive(t) for t in prop_type)

    if 'number' in prop_type or 'integer' in prop_type:
        return 'number | null' if ('null' in prop_type or for_view_props) else 'number'

    if prop_type == 'array':
        return 'any[]'

    if is_date and prop_type == 'string':
        return 'Date | null' if for_view_props else 'Date'

    return _map_primitive(prop_type or '')
