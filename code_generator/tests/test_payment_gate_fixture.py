"""
This test suite proves the x-payment
write-once stub mechanism (lib/stripe.ts, app/api/payment/checkout/route.ts,
app/api/webhooks/stripe/route.ts) actually fires end-to-end through the real
build_user_schema.py -> generate.py pipeline, not just at a unit-test level.

Modeled on code_generator/tests/test_invalidate_mechanism_fixture.py's
fixture-pipeline pattern.
"""
from pathlib import Path
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


def test_stripe_lib_stub_is_fail_closed_on_missing_secret_key(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    content = (out / 'lib' / 'stripe.ts').read_text()
    assert "if (!process.env.STRIPE_SECRET_KEY)" in content
    assert 'throw new Error(' in content


def test_webhook_route_stub_is_fail_closed_on_missing_webhook_secret(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE_DIR, tmp_path)
    content = (out / 'app' / 'api' / 'webhooks' / 'stripe' / 'route.ts').read_text()
    assert "if (!process.env.STRIPE_WEBHOOK_SECRET)" in content
    assert 'throw new Error(' in content


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
