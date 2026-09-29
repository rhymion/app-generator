// Behaviour check for the generated x-payment record lifecycle
// (lib/payment/*.ts), run against in-memory fakes -- see vitest.config.mts and
// scripts/check_payment_gate_fixture.sh. These are the generated files the
// gate produced from this fixture's schema (two x-payment entities:
// paid_widget priced by amount_cents, paid_gadget by stripe_price_id), not a
// hand-written copy of their logic.
import { beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import prisma, { db, resetDb } from './fake/prisma';
import { stripeState, resetStripe } from './fake/stripe';
import { afterDeleteRan, resetEntityService } from './fake/entity-service';
import { startPaymentCheckout, expirePendingCheckout } from '../lib/payment/checkout';
import { dispatchPaymentEvent } from '../lib/payment/payment_webhook_dispatch';

// What add{Entity}() leaves behind in its transaction: the entity row plus a
// pending payable row with a placeholder session id.
async function createProvisional(entity: 'paid_widget' | 'paid_gadget', id: string) {
  db[entity].push(
    entity === 'paid_widget'
      ? { id, name: 'w', amount_cents: 4200 }
      : { id, name: 'g', stripe_price_id: 'price_123' },
  );
  return prisma.payable.create({
    data: { entity_name: entity, record_id: id, stripe_checkout_session_id: `pending:${id}` },
  });
}

function event(type: string, session: Partial<Stripe.Checkout.Session>): Stripe.Event {
  return { id: `evt_${type}`, type, data: { object: session } } as unknown as Stripe.Event;
}

const paid = (id: string, extra: Partial<Stripe.Checkout.Session> = {}) =>
  event('checkout.session.completed', { id, payment_status: 'paid', amount_total: 4200, currency: 'usd', ...extra });
const expired = (id: string) => event('checkout.session.expired', { id });

beforeEach(() => {
  resetDb();
  resetStripe();
  resetEntityService();
});

describe('starting checkout', () => {
  it('prices an amount_cents entity with inline price_data and ties the session to the payable row', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    const url = await startPaymentCheckout('paid_widget', 'w1');

    expect(url).toBe('https://checkout.stripe.test/cs_test_1');
    const params = stripeState.created[0];
    expect(params.mode).toBe('payment');
    expect(params.line_items).toEqual([
      { price_data: { currency: 'usd', unit_amount: 4200, product_data: { name: 'paid_widget' } }, quantity: 1 },
    ]);
    expect(params.client_reference_id).toBe(payable.id);
    expect(params.metadata).toEqual({ payable_id: payable.id });
    expect(params.cancel_url).toContain(`payable_id=${payable.id}`);
    expect(db.payable[0].stripe_checkout_session_id).toBe('cs_test_1');
    expect(db.payable[0].status).toBe('pending');
  });

  it('prices a stripe_price_id entity with the pre-created Price', async () => {
    await createProvisional('paid_gadget', 'g1');
    await startPaymentCheckout('paid_gadget', 'g1');
    expect(stripeState.created[0].line_items).toEqual([{ price: 'price_123', quantity: 1 }]);
  });

  it('resumes the open session instead of creating a second one', async () => {
    await createProvisional('paid_widget', 'w1');
    const first = await startPaymentCheckout('paid_widget', 'w1');
    const second = await startPaymentCheckout('paid_widget', 'w1');
    expect(second).toBe(first);
    expect(stripeState.created).toHaveLength(1);
  });

  it('returns no URL for a record that is already paid', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await dispatchPaymentEvent(paid('cs_test_1'));
    expect(await startPaymentCheckout('paid_widget', 'w1')).toBeNull();
  });
});

describe('confirming', () => {
  it('marks the payable paid and leaves the record itself untouched', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await dispatchPaymentEvent(paid('cs_test_1'));

    expect(db.payable[0].status).toBe('paid');
    expect(db.payable[0].paid_at).toBeInstanceOf(Date);
    expect(db.paid_widget).toHaveLength(1);
    expect(afterDeleteRan).toEqual([]);
  });

  it('is a no-op the second time the same event arrives', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await dispatchPaymentEvent(paid('cs_test_1'));
    const firstPaidAt = db.payable[0].paid_at;
    await new Promise((r) => setTimeout(r, 5));
    await dispatchPaymentEvent(paid('cs_test_1'));
    expect(db.payable[0].paid_at).toBe(firstPaidAt);
  });

  it('waits for async_payment_succeeded when the completed session is still unpaid', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await dispatchPaymentEvent(paid('cs_test_1', { payment_status: 'unpaid' }));
    expect(db.payable[0].status).toBe('pending');
    await dispatchPaymentEvent(event('checkout.session.async_payment_succeeded', { id: 'cs_test_1', payment_status: 'paid' }));
    expect(db.payable[0].status).toBe('paid');
  });

  it('finds the payable through metadata when the event outruns the session-id update', async () => {
    const payable = await createProvisional('paid_widget', 'w1'); // still holds the placeholder id
    await dispatchPaymentEvent(paid('cs_early', { metadata: { payable_id: payable.id } }));
    expect(db.payable[0].status).toBe('paid');
    expect(db.payable[0].stripe_checkout_session_id).toBe('cs_early');
  });

  it('ignores a session that is not one of ours', async () => {
    await createProvisional('paid_widget', 'w1');
    await dispatchPaymentEvent(paid('cs_unknown'));
    expect(db.payable[0].status).toBe('pending');
  });
});

describe('removing an unpaid record', () => {
  it('deletes the record through the entity delete function, then the payable row', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await dispatchPaymentEvent(expired('cs_test_1'));

    expect(afterDeleteRan).toEqual(['paid_widget:w1']);
    expect(db.paid_widget).toHaveLength(0);
    expect(db.payable).toHaveLength(0);
  });

  it('is a no-op the second time the same event arrives', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await dispatchPaymentEvent(expired('cs_test_1'));
    await dispatchPaymentEvent(expired('cs_test_1'));
    expect(afterDeleteRan).toEqual(['paid_widget:w1']);
  });

  it('also removes the record when an asynchronous payment fails', async () => {
    await createProvisional('paid_gadget', 'g1');
    await startPaymentCheckout('paid_gadget', 'g1');
    await dispatchPaymentEvent(event('checkout.session.async_payment_failed', { id: 'cs_test_1' }));
    expect(db.paid_gadget).toHaveLength(0);
    expect(db.payable).toHaveLength(0);
  });

  it('never removes a record that was already paid', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await dispatchPaymentEvent(paid('cs_test_1'));
    await dispatchPaymentEvent(expired('cs_test_1'));
    expect(db.paid_widget).toHaveLength(1);
    expect(db.payable[0].status).toBe('paid');
    expect(afterDeleteRan).toEqual([]);
  });

  it('finishes the job on retry when a crash left the payable row behind an already-deleted record', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    db.paid_widget = []; // entity row gone, payable row still pending
    await dispatchPaymentEvent(expired('cs_test_1'));
    expect(db.payable).toHaveLength(0);
  });
});

describe('several x-payment entities behind one webhook', () => {
  it('routes each event to the entity its payable row names and touches no other', async () => {
    await createProvisional('paid_widget', 'w1');
    await createProvisional('paid_gadget', 'g1');
    await startPaymentCheckout('paid_widget', 'w1'); // cs_test_1
    await startPaymentCheckout('paid_gadget', 'g1'); // cs_test_2

    await dispatchPaymentEvent(expired('cs_test_1'));
    expect(db.paid_widget).toHaveLength(0);
    expect(db.paid_gadget).toHaveLength(1);
    expect(db.payable.map((p) => [p.entity_name, p.status])).toEqual([['paid_gadget', 'pending']]);

    await dispatchPaymentEvent(paid('cs_test_2'));
    expect(db.payable[0].status).toBe('paid');
    expect(afterDeleteRan).toEqual(['paid_widget:w1']);
  });
});

describe('cancelling from the return page', () => {
  it('expires the open session but leaves the deletion to the expired webhook', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await expirePendingCheckout(payable.id);

    expect(stripeState.expired).toEqual(['cs_test_1']);
    expect(db.paid_widget).toHaveLength(1); // not removed here
    await dispatchPaymentEvent(expired('cs_test_1'));
    expect(db.paid_widget).toHaveLength(0);
  });

  it('ignores an already-expired session, a paid payable and an unknown id', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await expirePendingCheckout(payable.id);
    await expirePendingCheckout(payable.id); // Stripe rejects the second expire: swallowed
    await expirePendingCheckout('nope');
    expect(stripeState.expired).toEqual(['cs_test_1']);
  });
});
