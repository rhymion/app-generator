"""x-payment: where a payable record's amount / Stripe Price comes from.

`x-payment: true` stays a bare boolean -- there is no configuration object.
An entity that declares it must instead carry exactly one of two fields whose
*names* are the convention:

  amount_cents     (integer)  per-record price, smallest currency unit;
                              sent to Stripe as an inline price_data line item
  stripe_price_id  (string)   a pre-created Stripe Price id, used as-is

This module is the single place that knows those names. validate.py (the
fail-closed check) and generate.py (which passes the resolved kind/field to the
templates) both go through `resolve_payment_source_field`; the generated
lib/payment/payment_source.ts is the single runtime place that reads the
value. If the convention is ever replaced by explicit configuration, only
these three spots change.
"""
from __future__ import annotations

PAYMENT_AMOUNT_FIELD = 'amount_cents'
PAYMENT_PRICE_ID_FIELD = 'stripe_price_id'

# field name -> (source kind used by the templates, JSON-schema type)
PAYMENT_SOURCE_FIELDS: dict[str, tuple[str, str]] = {
    PAYMENT_AMOUNT_FIELD: ('amount', 'integer'),
    PAYMENT_PRICE_ID_FIELD: ('price', 'string'),
}


def resolve_payment_source_field(props: dict) -> tuple[str, str] | None:
    """Return (kind, field_name) when *props* declares exactly one payment
    source field, else None (neither, or both -- ambiguous)."""
    present = [name for name in PAYMENT_SOURCE_FIELDS if name in props]
    if len(present) != 1:
        return None
    return PAYMENT_SOURCE_FIELDS[present[0]][0], present[0]


def payment_context(model: str, schema: dict) -> dict:
    """Template-context keys for one entity: whether it declares x-payment and
    where its amount comes from. Merged into the per-entity ctx so service.ts,
    the REST route and the Server Action all read the same resolved values.

    x-payment lives on the raw entity definition ('__x' after
    build_user_schema.py), which is what _raw_def resolves.
    """
    from build_context import _raw_def
    from helpers.schema_helpers import get_entity_properties

    raw = _raw_def(model, schema) or {}
    if raw.get('x-payment') is not True:
        return {'is_payment': False, 'payment_source_kind': '', 'payment_source_field': ''}
    resolved = resolve_payment_source_field(get_entity_properties(model, schema))
    # validate.py has already rejected a schema with neither/both fields; the
    # empty fallback only matters to callers that skip validation.
    kind, field = resolved if resolved else ('', '')
    return {'is_payment': True, 'payment_source_kind': kind, 'payment_source_field': field}
