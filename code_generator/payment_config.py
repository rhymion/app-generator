"""x-payment: where a payable record's Stripe Price comes from.

`x-payment: true` stays a bare boolean -- there is no configuration object.
The Price is always a pre-created Stripe Price id, found by convention on a
field named `stripe_price_id`:

  self      the x-payment entity itself declares `stripe_price_id`
            (a fixed Price per entity: the column's `default:` supplies it and
            client input can never set it)
  relation  otherwise, exactly one of the entity's foreign keys points at an
            entity that declares `stripe_price_id` (e.g. room_reservation ->
            room); the Price is read through that relation on the server

Discounts, other currencies and the like are Stripe's own features on the
Price/Checkout Session, so there is no amount field.

This module is the single place that knows the field name and the resolution
order. validate.py (the fail-closed check) and generate.py (which passes the
resolved source to the templates) both go through
`resolve_payment_price_source`; the generated lib/payment/payment_source.ts is
the single runtime place that reads the value.
"""
from __future__ import annotations

from helpers.schema_helpers import get_entity_properties

PAYMENT_PRICE_ID_FIELD = 'stripe_price_id'


def resolve_payment_price_source(props: dict, schema: dict) -> dict:
    """Resolve where an x-payment entity's Stripe Price id lives.

    *props* is the entity's own merged properties. Returns one of:

      {'kind': 'self', 'field': 'stripe_price_id'}
      {'kind': 'relation', 'field': 'stripe_price_id', 'fk_field': 'room_id',
       'relation_name': 'room', 'target': 'room'}
      {'kind': 'ambiguous', 'candidates': [{'fk_field': ..., 'target': ...}, ...]}
      {'kind': 'none'}

    The entity's own field always wins and short-circuits the FK scan. The scan
    counts FK *fields*: two foreign keys to the same entity are as ambiguous as
    two foreign keys to different ones.
    """
    if PAYMENT_PRICE_ID_FIELD in props:
        return {'kind': 'self', 'field': PAYMENT_PRICE_ID_FIELD}

    candidates: list[dict] = []
    for prop_name, prop in props.items():
        if not isinstance(prop, dict):
            continue
        rel = prop.get('x-relationship') or {}
        target = rel.get('target')
        if not target or rel.get('type') == 'direct':
            continue
        if PAYMENT_PRICE_ID_FIELD in get_entity_properties(target, schema):
            candidates.append({
                'fk_field': prop_name,
                'relation_name': prop_name.removesuffix('_id') if prop_name.endswith('_id') else prop_name,
                'target': target,
            })
    if len(candidates) == 1:
        return {'kind': 'relation', 'field': PAYMENT_PRICE_ID_FIELD, **candidates[0]}
    if candidates:
        return {'kind': 'ambiguous', 'candidates': candidates}
    return {'kind': 'none'}


def payment_context(model: str, schema: dict) -> dict:
    """Template-context keys for one entity: whether it declares x-payment and
    where its Price comes from. Merged into the per-entity ctx so service.ts,
    the REST route and the Server Action all read the same resolved values.

    x-payment lives on the raw entity definition ('__x' after
    build_user_schema.py), which is what _raw_def resolves.
    """
    from build_context import _raw_def

    raw = _raw_def(model, schema) or {}
    if raw.get('x-payment') is not True:
        return {
            'is_payment': False,
            'payment_price_kind': '',
            'payment_price_field': '',
            'payment_price_fk_field': '',
            'payment_price_relation': '',
        }
    resolved = resolve_payment_price_source(get_entity_properties(model, schema), schema)
    # validate.py has already rejected a schema whose Price cannot be resolved
    # to exactly one source; the empty fallback only matters to callers that
    # skip validation.
    if resolved['kind'] not in ('self', 'relation'):
        resolved = {'kind': ''}
    return {
        'is_payment': True,
        'payment_price_kind': resolved['kind'],
        'payment_price_field': resolved.get('field', ''),
        'payment_price_fk_field': resolved.get('fk_field', ''),
        'payment_price_relation': resolved.get('relation_name', ''),
    }
