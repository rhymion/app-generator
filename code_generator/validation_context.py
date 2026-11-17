"""Shared validation metadata used by generated form and service validators."""

from helpers.naming import to_title_case
from build_context import is_forced_required_field
from helpers.string_limits import is_length_checked_string, string_max_length

_RULE_TYPES = ('string', 'integer', 'number', 'boolean')
_RULE_FORMATS = ('uri', 'email')
_NUMERIC_BOUNDS = ('minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum')


def build_field_rule(prop: str, defn: dict) -> dict | None:
    """The runtime rule for one writable scalar field (Issue #1271), or None when it has none.

    The JSON type is always checked; enum, numeric bounds, minLength, pattern and format only when
    the schema declares them. Decimal and date/time columns keep their own dedicated checks, and a
    foreign-key column's pattern is not enforced (its reachability check decides).
    """
    if defn.get('_prisma_decimal_type') or defn.get('format') in _DATE_FORMATS:
        return None
    types = defn.get('type')
    if isinstance(types, str):
        types = [types]
    base = [t for t in (types or []) if t != 'null']
    if len(base) != 1 or base[0] not in _RULE_TYPES:
        return None
    rule: dict = {'key': prop, 'label': _field_label(prop), 'type': base[0]}
    enum = defn.get('enum')
    if isinstance(enum, list) and enum and all(isinstance(v, (str, int, float, bool)) for v in enum):
        rule['enum'] = enum
    if base[0] in ('integer', 'number'):
        for k in _NUMERIC_BOUNDS:
            v = defn.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                rule[k] = v
    if base[0] == 'string':
        ml = defn.get('minLength')
        if isinstance(ml, int) and not isinstance(ml, bool) and ml > 0:
            rule['minLength'] = ml
        if isinstance(defn.get('pattern'), str) and 'x-relationship' not in defn:
            rule['pattern'] = defn['pattern']
        if defn.get('format') in _RULE_FORMATS:
            rule['format'] = defn['format']
    return rule

_DATE_FORMATS = ('date', 'date-time', 'time')
_SYSTEM_FIELDS = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'}


def _is_missing_value(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ''
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return value != value  # NaN check
    if hasattr(value, 'isValid') and callable(getattr(value, 'isValid')):
        try:
            return not value.isValid()
        except Exception:
            return True
    return False


def _field_label(prop_name: str) -> str:
    return to_title_case(prop_name.removesuffix('_id'))


def build_validation_context(ctx: dict) -> dict:
    """Build per-entity validation metadata from the generated build context."""
    model = ctx['model']
    model_def = ctx['model_def']
    parent_prop_infos = ctx['parent_prop_infos']
    selector_oto_rels = ctx.get('selector_oto_rels', [])
    required_props = set(model_def.get('required') or [])
    # Read-only fields are never user-supplied (the form omits them from its inputs),
    # so they must not be in REQUIRED_FIELDS — otherwise validateForm flags them as
    # missing ("<Field> is required"). Their stored value is preserved on update.
    readonly_props = set(ctx.get('readonly_fields') or [])

    # `required_fields` (schema `required:` only) feeds service_validation.ts,
    # which guards validateOnAdd() too -- a select-like field with a Prisma
    # `@default(...)` must stay legal to OMIT entirely on create (the default
    # fills it in; the generated API POST tests rely on exactly this). Forcing
    # it there rejects every such create with "<Field> is required" (cmd_472
    # regression: POST /api/room without `status` started 500ing).
    #
    # `client_required_fields` additionally covers select-like non-nullable
    # fields (cmd_472/R-2) and feeds only form_validation.ts: the client form
    # always pre-fills such a field (the "new" page's `src` literal sets
    # `status: 'available'`), so it is never legitimately absent there --
    # only explicitly cleared, which getValidationError() must block.
    required_fields: list[dict] = []
    client_required_fields: list[dict] = []
    # decimal_fields: Decimal-backed columns (schema_deriver._prisma_decimal_type)
    # need a numeric-string format check that plain 'string' fields don't --
    # they are exposed as JSON type "string" (precision-preserving, no JS
    # float), but an unvalidated non-numeric value would otherwise reach
    # Prisma's create()/update() and surface as an opaque write error rather
    # than a field-level validation message. Shared by both
    # form_validation.ts (client UX) and service_validation.ts (the actual
    # guard -- covers the REST API / server action path; CSV import has its
    # own format check in api_import_route.ts.jinja2 since it writes via
    # `tx.model.create()` directly, bypassing validateOnAdd()).
    decimal_fields: list[dict] = []
    # date_fields: date / date-time / time columns. The same reasoning as for
    # decimals: an unparseable value would otherwise reach Prisma and surface as
    # an HTTP 500 instead of a field-level validation error. The rules live in
    # lib/_date_value.ts, shared by the Web form, the service guard and the
    # mobile inputs.
    date_fields: list[dict] = []
    # string_length_fields: every writable string column, with the schema's
    # maxLength or the default cap (helpers/string_limits.py, Issue #1273).
    # Only service_validation.ts uses it: the form keeps enforcing a declared
    # maxLength only, and CSV import checks the same limit per cell.
    string_length_fields: list[dict] = []
    # field_rules: the runtime type / range / allowed-value rules of every writable
    # scalar field (Issue #1271); service_validation.ts checks each supplied value.
    field_rules: list[dict] = []
    for prop_info in parent_prop_infos:
        prop = prop_info['prop']
        if prop in _SYSTEM_FIELDS:
            continue
        if prop in readonly_props:
            continue
        defn = prop_info.get('def') or {}
        entry = {'key': prop, 'label': _field_label(prop)}
        if prop in required_props:
            required_fields.append(entry)
            client_required_fields.append(entry)
        elif is_forced_required_field(defn):
            client_required_fields.append(entry)
        if defn.get('_prisma_decimal_type'):
            decimal_fields.append(entry)
        if defn.get('format') in _DATE_FORMATS:
            date_fields.append({**entry, 'format': defn['format']})
        if is_length_checked_string(defn):
            string_length_fields.append({**entry, 'max_length': string_max_length(defn)})
        rule = build_field_rule(prop, defn)
        if rule:
            field_rules.append(rule)

    one_to_one_checks = []
    for rel in selector_oto_rels:
        prop = rel['prop_name']
        one_to_one_checks.append({
            'key': prop,
            'label': _field_label(prop),
            'target': rel['target'],
            'required': rel.get('nullable', True) is False,
            'unique': True,
        })

    return {
        'model': model,
        'required_fields': required_fields,
        'client_required_fields': client_required_fields,
        'decimal_fields': decimal_fields,
        'date_fields': date_fields,
        'string_length_fields': string_length_fields,
        'field_rules': field_rules,
        'one_to_one_checks': one_to_one_checks,
    }
