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

    # cmd_646: self-referential m2m children whose x-relationships.<rel>.
    # sameEntityField is declared (json_schema.yaml — see the comment on
    # approval_flow.preceded_by for the full contract) get a save-time guard
    # in service_validation.ts requiring every connected row to share the
    # current row's value of that field. Template for future same-entity-
    # only self-refs: declaring sameEntityField on a new relation is enough
    # to opt in here — see docs/knowledge/cmd646-same-entity-field.md.
    same_entity_checks = []
    for c in ctx.get('non_comment_ch', []):
        rel = c.get('relationship') or {}
        same_field = rel.get('same_entity_field')
        if not (c.get('use_connect') and same_field):
            continue
        same_entity_checks.append({
            'prop_name': c['property_name'],
            'label': _field_label(c['property_name']),
            'same_field': same_field,
        })

    return {
        'model': model,
        'required_fields': required_fields,
        'client_required_fields': client_required_fields,
        'one_to_one_checks': one_to_one_checks,
        'same_entity_checks': same_entity_checks,
    }
