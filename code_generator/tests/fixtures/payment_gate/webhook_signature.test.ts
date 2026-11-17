// Contract test for the generated Stripe webhook receiver
// (app/api/webhooks/stripe/route.ts): it must verify the signature with the
// real Stripe SDK before it hands anything to the dispatcher, and must answer
// 400 without dispatching for a missing, wrong or stale signature. Run by
// scripts/check_payment_gate_fixture.sh next to lifecycle.test.ts; see
// vitest.config.mts. The dispatcher is mocked, so only the boundary is tested.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';

const dispatch = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../lib/payment/payment_webhook_dispatch', () => ({ dispatchPaymentEvent: dispatch }));
vi.mock('@/lib/payment/payment_webhook_dispatch', () => ({ dispatchPaymentEvent: dispatch }));
// The route must verify with the real SDK, so this file swaps the marker the
// lifecycle tests use for a real client (no key is needed to verify).
vi.mock('@/lib/stripe', () => ({ stripe: new Stripe('sk_test_fixture') }));

import { POST } from '../app/api/webhooks/stripe/route';

const SECRET = 'whsec_fixture_secret';
const stripe = new Stripe('sk_test_fixture');
const payload = JSON.stringify({
  id: 'evt_1',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_1', object: 'checkout.session', payment_status: 'paid' } },
});

function post(body: string, signature?: string) {
  const headers: Record<string, string> = {};
  if (signature !== undefined) headers['stripe-signature'] = signature;
  return POST(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body, headers }));
}

beforeEach(() => {
  dispatch.mockClear();
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
});

describe('Stripe webhook receiver signature check', () => {
  it('accepts a correctly signed payload and dispatches the event once', async () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await post(payload, header);
    expect(res.status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('rejects a payload signed with another secret', async () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other' });
    const res = await post(payload, header);
    expect(res.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a payload that was changed after it was signed', async () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await post(payload.replace('paid', 'unpaid'), header);
    expect(res.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a malformed signature header', async () => {
    const res = await post(payload, 'not-a-signature');
    expect(res.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a request without a signature header', async () => {
    const res = await post(payload);
    expect(res.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a correctly signed payload whose timestamp is outside the tolerance', async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: stale });
    const res = await post(payload, header);
    expect(res.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
