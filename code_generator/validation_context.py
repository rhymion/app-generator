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

    required_fields: list[dict] = []
    for prop_info in parent_prop_infos:
        prop = prop_info['prop']
        if prop in _SYSTEM_FIELDS:
            continue
        if prop in readonly_props:
            continue
        defn = prop_info.get('def') or {}
        if prop not in required_props and not is_forced_required_field(defn):
            continue
        required_fields.append({
            'key': prop,
            'label': _field_label(prop),
        })

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
        'one_to_one_checks': one_to_one_checks,
    }
