"""
This test suite proves the x-payment
write-once stub mechanism (lib/stripe.ts, app/api/webhooks/stripe/route.ts) actually fires end-to-end through the real
build_user_schema.py -> generate.py pipeline, not just at a unit-test level.

Modeled on code_generator/tests/test_invalidate_mechanism_fixture.py's
fixture-pipeline pattern.
"""
from pathlib import Path
import re
import shutil

from build_user_schema import build_user_schema
from generate import generate

REPO_ROOT = Path(__file__).resolve().parents[2]
PAYMENT_FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'payment_gate'
INVALIDATE_FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'invalidate_gate'


def _run_pipeline(fixture_dir: Path, tmp_path: Path) -> Path:
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(fixture_dir / 'schema.prisma', prisma_dir / 'schema.prisma')

    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(
        fixture_dir / 'json_schema.yaml',
        fixture_dir / 'schema.prisma',
        intermediate,
    )
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def test_x_payment_true_writes_stripe_lib_stub(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    stub = out / 'lib' / 'stripe.ts'
    assert stub.exists(), 'lib/stripe.ts must be written when x-payment: true is declared'
    content = stub.read_text()
    assert "from 'stripe'" in content
    assert 'STRIPE_SECRET_KEY' in content


def test_x_payment_true_does_not_write_standalone_checkout_route(tmp_path):
    # Issue #785: a standalone POST /api/payment/checkout let any authenticated
    # caller create a Checkout Session for an arbitrary price_id. The only
    # entrance to Checkout is the x-payment entity's own create path
    # (lib/payment/checkout.ts), so no such route may be generated.
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    assert not (out / 'app' / 'api' / 'payment').exists(), (
        'no app/api/payment/** route may be written for x-payment'
    )
    assert (out / 'lib' / 'payment' / 'checkout.ts').exists()
    for generated in out.rglob('*.ts*'):
        text = generated.read_text()
        assert '/api/payment/checkout' not in text, f'{generated} still references the removed route'


def test_x_payment_true_writes_webhook_route_stub(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    stub = out / 'app' / 'api' / 'webhooks' / 'stripe' / 'route.ts'
    assert stub.exists(), 'app/api/webhooks/stripe/route.ts must be written when x-payment: true is declared'
    content = stub.read_text()
    assert 'req.text()' in content
    assert 'webhooks.constructEvent' in content
    # The stub only verifies; what events do lives in the generated dispatcher.
    assert 'dispatchPaymentEvent(event)' in content
    dispatch = (out / 'lib' / 'payment' / 'payment_webhook_dispatch.ts').read_text()
    assert "'checkout.session.completed'" in dispatch


def test_x_payment_true_writes_checkout_return_pages(tmp_path):
    # Issue #776: lib/payment/checkout.ts sends success_url / cancel_url to
    # /payment/success and /payment/cancel; both pages must exist or the
    # buyer lands on a 404.
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    checkout = (out / 'lib' / 'payment' / 'checkout.ts').read_text()
    for kind in ('success', 'cancel'):
        assert f'/payment/{kind}' in checkout
        page = out / 'app' / '[locale]' / 'payment' / kind / 'page.tsx'
        assert page.exists(), f'app/[[locale]]/payment/{kind}/page.tsx must be written'
        content = page.read_text()
        assert f"t('{kind}Title')" in content
        assert f"t('{kind}Message')" in content


def test_checkout_return_pages_hardcode_no_japanese_prose(tmp_path):
    # Copy must come from the Payment i18n namespace, never be hardcoded
    # (no Japanese prose in the shipped page).
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    for kind in ('success', 'cancel'):
        content = (out / 'app' / '[locale]' / 'payment' / kind / 'page.tsx').read_text()
        assert not re.search(r'[\u3040-\u30ff\u4e00-\u9fff]', content)
        assert "getTranslations('Payment')" in content


def test_payment_i18n_keys_exist_in_both_locales():
    import json

    for lang in ('en', 'ja'):
        messages = json.loads((REPO_ROOT / 'messages' / f'{lang}.json').read_text(encoding='utf-8'))
        payment = messages['Payment']
        for key in ('successTitle', 'successMessage', 'cancelTitle', 'cancelMessage', 'backToHome'):
            assert payment.get(key), f'messages/{lang}.json is missing Payment.{key}'


def test_stripe_lib_stub_is_fail_closed_on_missing_secret_key(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    content = (out / 'lib' / 'stripe.ts').read_text()
    assert "if (!process.env.STRIPE_SECRET_KEY)" in content
    assert 'throw new Error(' in content


def test_webhook_route_stub_is_fail_closed_on_missing_webhook_secret(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    content = (out / 'app' / 'api' / 'webhooks' / 'stripe' / 'route.ts').read_text()
    assert "if (!webhookSecret)" in content
    assert 'throw new Error(' in content


def test_webhook_route_stub_checks_secret_inside_handler_not_at_module_top(tmp_path):
    # cmd_758: a module-top-level throw is evaluated by `next build`'s page
    # data collection for every route regardless of HTTP method, and used to
    # fail the production build whenever STRIPE_WEBHOOK_SECRET was unset
    # (e.g. every Vercel Preview deploy). The check must live inside POST().
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    content = (out / 'app' / 'api' / 'webhooks' / 'stripe' / 'route.ts').read_text()
    handler_start = content.index('export async function POST')
    secret_check = content.index('if (!webhookSecret)')
    assert secret_check > handler_start, (
        'STRIPE_WEBHOOK_SECRET check must be inside the POST handler, not at module top level'
    )


def test_stripe_lib_stub_does_not_throw_at_module_evaluation(tmp_path):
    # cmd_758: the old stub threw at module top level (`if
    # (!process.env.STRIPE_SECRET_KEY) { throw ... }` outside any function),
    # which `next build` evaluates for every route during page data
    # collection. The Stripe client must now be constructed lazily (e.g.
    # behind a function or Proxy) so import alone never throws.
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    content = (out / 'lib' / 'stripe.ts').read_text()
    export_line = next(line for line in content.splitlines() if line.startswith('export const stripe'))
    assert 'new Stripe(' not in export_line, (
        'the exported `stripe` client must not be constructed eagerly at module scope'
    )


def test_stub_write_once_does_not_overwrite_existing_file(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    stub = out / 'lib' / 'stripe.ts'
    hand_edited = '// hand-edited by a consumer\nexport const stripe = null;\n'
    stub.write_text(hand_edited)

    # Re-run the pipeline over the same output dir -- the write-once stub
    # must be skipped, not clobbered (cmd_583 convention).
    intermediate = tmp_path / 'generated_json_schema.yaml'
    generate(str(intermediate), str(tmp_path))

    assert stub.read_text() == hand_edited


def test_no_x_payment_declared_writes_no_stubs(tmp_path):
    # invalidate_gate's fixture schema declares no x-payment key anywhere --
    # the stub files must not appear.
    out = _run_pipeline(INVALIDATE_FIXTURE_DIR, tmp_path)
    assert not (out / 'lib' / 'stripe.ts').exists()
    assert not (out / 'app' / 'api' / 'payment').exists()
    assert not (out / 'app' / 'api' / 'webhooks' / 'stripe' / 'route.ts').exists()
    assert not (out / 'app' / '[locale]' / 'payment').exists()


# ---------------------------------------------------------------------------
# x-payment record lifecycle (Issue #775)
# ---------------------------------------------------------------------------

def test_payable_model_injected_only_when_an_entity_declares_x_payment(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path / 'with')
    schema = (out / 'prisma' / 'schema.prisma').read_text()
    assert 'model payable {' in schema
    assert 'enum PayableStatus' in schema
    # Second run is idempotent: the model is not appended twice.
    intermediate = out / 'generated_json_schema.yaml'
    generate(str(intermediate), str(out))
    assert (out / 'prisma' / 'schema.prisma').read_text().count('model payable {') == 1

    out2 = _run_pipeline(INVALIDATE_FIXTURE_DIR, tmp_path / 'without')
    assert 'model payable' not in (out2 / 'prisma' / 'schema.prisma').read_text()
    assert not (out2 / 'lib' / 'payment').exists()


def test_create_paths_converge_on_add_service_for_every_payment_entity(tmp_path):
    # Design section 9: the REST route and the Server Action both call
    # add{Entity}(), which alone opens the Checkout Session, so the API cannot
    # create a record that skips payment.
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    for entity, pascal in (('paid_widget', 'PaidWidget'), ('paid_gadget', 'PaidGadget')):
        service = (out / 'lib' / entity / 'service.ts').read_text()
        assert "startPaymentCheckout('%s'" % entity in service
        assert 'tx.payable.create' in service
        # Failure to open a session removes the record via the entity's own delete.
        assert f'delete{pascal}(' in service
        route = (out / 'app' / 'api' / entity / 'route.ts').read_text()
        assert f'add{pascal}(' in route
        assert 'checkoutUrl' in route
        actions = (out / 'lib' / entity / 'actions.ts').read_text()
        assert 'redirect(_checkoutUrl)' in actions

    plain = (out / 'lib' / 'plain_widget' / 'service.ts').read_text()
    assert 'startPaymentCheckout' not in plain and 'payable' not in plain
    plain_route = (out / 'app' / 'api' / 'plain_widget' / 'route.ts').read_text()
    assert 'checkoutUrl' not in plain_route


def test_webhook_dispatcher_routes_to_each_entitys_own_delete(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    dispatch = (out / 'lib' / 'payment' / 'payment_webhook_dispatch.ts').read_text()
    assert "case 'paid_widget'" in dispatch and "case 'paid_gadget'" in dispatch
    assert 'plain_widget' not in dispatch
    assert 'deletePaidWidget' in dispatch and 'deletePaidGadget' in dispatch


def test_price_is_read_through_the_related_entity_or_off_the_record_itself(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    source = (out / 'lib' / 'payment' / 'payment_source.ts').read_text()
    # paid_widget has no price column: the Price is selected through its FK
    # relation to widget_catalog, the only related entity that carries one.
    assert 'select: { widget_catalog: { select: { stripe_price_id: true } } }' in source
    # paid_gadget declares its own stripe_price_id.
    assert "prisma.paid_gadget.findUnique({ where: { id: recordId }, select: { stripe_price_id: true } })" in source
    assert 'amount' not in source.lower()


def test_checkout_session_uses_price_and_server_quantity_with_promotion_codes(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    checkout = (out / 'lib' / 'payment' / 'checkout.ts').read_text()
    assert 'line_items: [{ price: source.priceId, quantity }]' in checkout
    assert 'allow_promotion_codes: true' in checkout
    assert 'resolvePaymentQuantity(entityName, recordId)' in checkout
    # No inline-amount path is left.
    assert 'price_data' not in checkout and 'unit_amount' not in checkout
    assert "currency: 'usd'" not in checkout


def test_quantity_hook_is_written_once_per_payment_entity_and_defaults_to_one(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    for entity, pascal in (('paid_widget', 'PaidWidget'), ('paid_gadget', 'PaidGadget')):
        hook = out / 'lib' / 'payment' / f'{entity}_quantity.ts'
        assert hook.exists()
        content = hook.read_text()
        assert f'export async function resolve{pascal}Quantity(_record: {entity}): Promise<number>' in content
        assert 'return 1;' in content
    assert not (out / 'lib' / 'payment' / 'plain_widget_quantity.ts').exists()

    # Write-once: a hand-edited hook survives regeneration.
    hook = out / 'lib' / 'payment' / 'paid_widget_quantity.ts'
    hand_edited = '// hand-edited\nexport async function resolvePaidWidgetQuantity() { return 3; }\n'
    hook.write_text(hand_edited)
    generate(str(out / 'generated_json_schema.yaml'), str(out))
    assert hook.read_text() == hand_edited


def test_own_price_field_is_never_client_input_but_a_related_price_needs_no_guard(tmp_path):
    # A client must not be able to choose the Price. paid_gadget carries its own
    # stripe_price_id, so it rides the read-only exclusion: the REST route and
    # the Server Action reject a submitted value outright, and the create data
    # never contains the column (the Prisma @default supplies it).
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    route = (out / 'app' / 'api' / 'paid_gadget' / 'route.ts').read_text()
    assert "body.stripe_price_id !== undefined" in route
    assert 'read-only and cannot be set' in route
    actions = (out / 'lib' / 'paid_gadget' / 'actions.ts').read_text()
    assert "data.get('stripe_price_id') !== null" in actions
    service = (out / 'lib' / 'paid_gadget' / 'service.ts').read_text()
    add_body = service[service.index('export async function addPaidGadget'):]
    add_body = add_body[:add_body.index('\nexport async function ')]
    assert 'stripe_price_id' not in add_body

    # paid_widget has no such column on its own row, so nothing to exclude:
    # the only related input is which widget_catalog it points at.
    widget_route = (out / 'app' / 'api' / 'paid_widget' / 'route.ts').read_text()
    assert 'stripe_price_id' not in widget_route
    assert 'widget_catalog_id' in widget_route


def test_no_amount_field_is_recognised_any_more(tmp_path):
    import pytest
    from validate import validate_schema, SchemaValidationError

    with pytest.raises(SchemaValidationError, match="requires a 'stripe_price_id'"):
        validate_schema(_payment_schema({'amount_cents': {'type': 'integer'}}))


def _payment_schema(props: dict, x_payment=True, extra: dict | None = None) -> dict:
    defn = {'properties': {'name': {'type': 'string'}, **props}, 'required': list(props), 'x-payment': x_payment}
    defn.update(extra or {})
    return {'definitions': {'booking': defn}}


_PRICE = {'type': 'string', 'default': 'price_fixed'}


def _fk(target: str) -> dict:
    return {'type': 'string', 'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': 'name'}}


def _priced_target() -> dict:
    return {'properties': {'name': {'type': 'string'}, 'stripe_price_id': {'type': 'string'}}, 'required': ['stripe_price_id']}


def test_x_payment_validation_fails_closed_without_a_price_source():
    import pytest
    from validate import validate_schema, SchemaValidationError

    with pytest.raises(SchemaValidationError) as exc:
        validate_schema(_payment_schema({}))
    assert 'stripe_price_id' in str(exc.value) and 'found neither' in str(exc.value)


def test_x_payment_validation_accepts_own_price_or_exactly_one_related_price():
    from validate import validate_schema

    validate_schema(_payment_schema({'stripe_price_id': _PRICE}))
    validate_schema(_payment_schema({}, x_payment=False))

    related = _payment_schema({'venue_id': _fk('venue')})
    related['definitions']['venue'] = _priced_target()
    validate_schema(related)


def test_x_payment_validation_own_price_wins_over_a_related_one():
    from validate import validate_schema

    schema = _payment_schema({'stripe_price_id': _PRICE, 'venue_id': _fk('venue')})
    schema['definitions']['venue'] = _priced_target()
    validate_schema(schema)


def test_x_payment_validation_rejects_an_ambiguous_related_price():
    import pytest
    from validate import validate_schema, SchemaValidationError

    # Two related entities carry a Price.
    schema = _payment_schema({'venue_id': _fk('venue'), 'catering_id': _fk('catering')})
    schema['definitions']['venue'] = _priced_target()
    schema['definitions']['catering'] = _priced_target()
    with pytest.raises(SchemaValidationError) as exc:
        validate_schema(schema)
    message = str(exc.value)
    assert "Definition 'booking'" in message
    assert "'venue_id' -> 'venue'" in message and "'catering_id' -> 'catering'" in message
    assert 'unambiguous' in message

    # Two foreign keys to the same entity are just as ambiguous.
    same = _payment_schema({'first_venue_id': _fk('venue'), 'second_venue_id': _fk('venue')})
    same['definitions']['venue'] = _priced_target()
    with pytest.raises(SchemaValidationError, match="'first_venue_id' -> 'venue', 'second_venue_id' -> 'venue'"):
        validate_schema(same)


def test_x_payment_validation_ignores_related_entities_without_a_price():
    from validate import validate_schema

    schema = _payment_schema({'venue_id': _fk('venue'), 'owner_id': _fk('owner')})
    schema['definitions']['venue'] = _priced_target()
    schema['definitions']['owner'] = {'properties': {'name': {'type': 'string'}}, 'required': []}
    validate_schema(schema)


def test_x_payment_validation_rejects_wrong_type_missing_default_and_object_form():
    import pytest
    from validate import validate_schema, SchemaValidationError

    with pytest.raises(SchemaValidationError, match="must be of type 'string'"):
        validate_schema(_payment_schema({'stripe_price_id': {'type': 'integer', 'default': 1}}))
    # An own Price is excluded from client input, so it must carry a default.
    with pytest.raises(SchemaValidationError, match='must declare a `default:`'):
        validate_schema(_payment_schema({'stripe_price_id': {'type': 'string'}}))
    # A related Price must be a non-nullable column.
    related = _payment_schema({'venue_id': _fk('venue')})
    related['definitions']['venue'] = _priced_target()
    related['definitions']['venue']['required'] = []
    with pytest.raises(SchemaValidationError, match='must be required'):
        validate_schema(related)
    with pytest.raises(SchemaValidationError, match='boolean true'):
        validate_schema(_payment_schema({'stripe_price_id': _PRICE}, x_payment={'priceField': 'x'}))


def test_x_payment_validation_requires_delete_to_stay_enabled():
    import pytest
    from validate import validate_schema, SchemaValidationError

    schema = _payment_schema({'stripe_price_id': _PRICE}, extra={'x-generate': {'delete': False}})
    with pytest.raises(SchemaValidationError, match='x-generate.delete'):
        validate_schema(schema)
