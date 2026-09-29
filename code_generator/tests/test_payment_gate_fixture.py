"""
This test suite proves the x-payment
write-once stub mechanism (lib/stripe.ts, app/api/payment/checkout/route.ts,
app/api/webhooks/stripe/route.ts) actually fires end-to-end through the real
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


def test_x_payment_true_writes_checkout_route_stub(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    stub = out / 'app' / 'api' / 'payment' / 'checkout' / 'route.ts'
    assert stub.exists(), 'app/api/payment/checkout/route.ts must be written when x-payment: true is declared'
    content = stub.read_text()
    assert 'checkout.sessions.create' in content
    assert "mode: 'payment'" in content


def test_x_payment_true_writes_webhook_route_stub(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    stub = out / 'app' / 'api' / 'webhooks' / 'stripe' / 'route.ts'
    assert stub.exists(), 'app/api/webhooks/stripe/route.ts must be written when x-payment: true is declared'
    content = stub.read_text()
    assert 'req.text()' in content
    assert 'webhooks.constructEvent' in content
    assert "'checkout.session.completed'" in content


def test_checkout_route_stub_accepts_api_key_and_session_auth(tmp_path):
    # Issue #776: the stub used to authenticate with getSessionUserId() only,
    # so a valid X-API-Key got 401. It must resolve the actor the same way as
    # every other generated API route (resolveActorId from lib/api-auth).
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    content = (out / 'app' / 'api' / 'payment' / 'checkout' / 'route.ts').read_text()
    assert "resolveActorId" in content
    assert "from '@/lib/api-auth'" in content
    assert 'getSessionUserId' not in content
    assert 'export async function POST(req: NextRequest)' in content
    assert 'handleApiError' in content


def test_x_payment_true_writes_checkout_return_pages(tmp_path):
    # Issue #776: the checkout stub sends success_url / cancel_url to
    # /payment/success and /payment/cancel; both pages must exist or the
    # buyer lands on a 404.
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    checkout = (out / 'app' / 'api' / 'payment' / 'checkout' / 'route.ts').read_text()
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
    assert not (out / 'app' / 'api' / 'payment' / 'checkout' / 'route.ts').exists()
    assert not (out / 'app' / 'api' / 'webhooks' / 'stripe' / 'route.ts').exists()
    assert not (out / 'app' / '[locale]' / 'payment').exists()
