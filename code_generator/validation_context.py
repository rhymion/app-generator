"""Shared validation metadata used by generated form and service validators."""

from helpers.naming import to_title_case
from build_context import is_forced_required_field

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
        'one_to_one_checks': one_to_one_checks,
    }
