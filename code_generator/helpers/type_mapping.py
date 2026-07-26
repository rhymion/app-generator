"""JSON Schema → TypeScript type mapping — port of helpers/type-mapping.ts"""


def _map_primitive(t: str) -> str:
    return {'string': 'string', 'integer': 'number', 'number': 'number',
            'boolean': 'boolean', 'null': 'null'}.get(t, 'any')


def get_ts_type(prop: dict, for_view_props: bool = False) -> str:
    fmt = prop.get('format')
    is_date = fmt in ('date', 'date-time', 'time')
    prop_type = prop.get('type')

    # A Prisma nativeEnum-backed field (schema_deriver._prisma_native_enum_type
    # marker) has a concrete string-literal-union type on the Prisma client
    # side (e.g. 'pending' | 'rejected'), narrower than plain `string`. Emit
    # that literal union so values assigned into a Prisma `data: {...}` write
    # type-check without a cast. The exposed JSON `type` is unaffected
    # (still "string" -- Class B: API/JSON shape unchanged).
    if prop.get('_prisma_native_enum_type') and prop.get('enum') and prop_type == 'string':
        union = ' | '.join(f"'{v}'" for v in prop['enum'])
        return f"{union} | null" if for_view_props else union

    if isinstance(prop_type, list):
        if is_date:
            return 'Date | null' if ('null' in prop_type or for_view_props) else 'Date'
        return ' | '.join('null' if t == 'null' else _map_primitive(t) for t in prop_type)

    if prop_type and ('number' in prop_type or 'integer' in prop_type):
        return 'number | null' if ('null' in prop_type or for_view_props) else 'number'

    if prop_type == 'array':
        return 'any[]'

    if is_date and prop_type == 'string':
        return 'Date | null' if for_view_props else 'Date'

    return _map_primitive(prop_type or '')
