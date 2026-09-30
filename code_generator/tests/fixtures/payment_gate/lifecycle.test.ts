// Behaviour check for the generated x-payment record lifecycle
// (lib/payment/*.ts), run against in-memory fakes -- see vitest.config.mts and
// scripts/check_payment_gate_fixture.sh. These are the generated files the
// gate produced from this fixture's schema (two x-payment entities:
// paid_widget priced through its foreign key to widget_catalog, paid_gadget by
// its own stripe_price_id), not a hand-written copy of their logic.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import prisma, { db, resetDb } from './fake/prisma';
import { stripeState, resetStripe } from './fake/stripe';
import { afterDeleteRan, auditRan, resetEntityService } from './fake/entity-service';
import { startPaymentCheckout, expirePendingCheckout, retrievePaidSession } from '../lib/payment/checkout';
import { dispatchPaymentEvent, removeUnpaidPayable, confirmPaidSession } from '../lib/payment/payment_webhook_dispatch';

// The generated paid_widget quantity hook is write-once and defaults to 1; a
// consumer edits it. This wrapper runs the real generated default unless a
// test installs a replacement, standing in for that hand edit.
const quantityHook = vi.hoisted(() => ({
  override: undefined as undefined | ((record: unknown) => Promise<number>),
  received: [] as unknown[],
}));
vi.mock('../lib/payment/paid_widget_quantity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/payment/paid_widget_quantity')>();
  return {
    resolvePaidWidgetQuantity: async (record: never) => {
      quantityHook.received.push(record);
      return quantityHook.override ? quantityHook.override(record) : actual.resolvePaidWidgetQuantity(record);
    },
  };
});

// What add{Entity}() leaves behind in its transaction: the entity row plus a
// pending payable row with a placeholder session id.
async function createProvisional(entity: 'paid_widget' | 'paid_gadget', id: string, catalogPrice = 'price_catalog') {
  if (entity === 'paid_widget') {
    // The Price lives on the related widget_catalog row, not on the widget.
    db.widget_catalog.push({ id: `cat_${id}`, name: 'c', stripe_price_id: catalogPrice });
    db.paid_widget.push({ id, name: 'w', widget_catalog_id: `cat_${id}` });
  } else {
    db.paid_gadget.push({ id, name: 'g', stripe_price_id: 'price_gadget_fixed' });
  }
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
  quantityHook.override = undefined;
  quantityHook.received = [];
});

describe('starting checkout', () => {
  it('prices an entity through the Price on its related entity and ties the session to the payable row', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    const url = await startPaymentCheckout('paid_widget', 'w1');

    expect(url).toBe('https://checkout.stripe.test/cs_test_1');
    const params = stripeState.created[0];
    expect(params.mode).toBe('payment');
    expect(params.line_items).toEqual([{ price: 'price_catalog', quantity: 1 }]);
    expect(params.client_reference_id).toBe(payable.id);
    expect(params.metadata).toEqual({ payable_id: payable.id });
    expect(params.cancel_url).toContain(`payable_id=${payable.id}`);
    // Stripe's floor is 30 minutes, its default 24 hours: ask for the floor plus slack.
    const lifetime = params.expires_at - Math.floor(Date.now() / 1000);
    expect(lifetime).toBeGreaterThanOrEqual(30 * 60);
    expect(lifetime).toBeLessThanOrEqual(32 * 60);
    expect(db.payable[0].stripe_checkout_session_id).toBe('cs_test_1');
    expect(db.payable[0].status).toBe('pending');
  });

  it('prices an entity with its own stripe_price_id', async () => {
    await createProvisional('paid_gadget', 'g1');
    await startPaymentCheckout('paid_gadget', 'g1');
    expect(stripeState.created[0].line_items).toEqual([{ price: 'price_gadget_fixed', quantity: 1 }]);
  });

  it('charges the Price of whichever related entity the record points at', async () => {
    await createProvisional('paid_widget', 'w1', 'price_suite');
    await createProvisional('paid_widget', 'w2', 'price_standard');
    await startPaymentCheckout('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w2');
    expect(stripeState.created.map((p) => p.line_items[0].price)).toEqual(['price_suite', 'price_standard']);
  });

  it('fails closed, creating no session, when the related entity carries no Price', async () => {
    await createProvisional('paid_widget', 'w1', '');
    await expect(startPaymentCheckout('paid_widget', 'w1')).rejects.toThrow(/no stripe_price_id on its widget_catalog_id/);
    expect(stripeState.created).toHaveLength(0);
  });

  it('lets the buyer enter a promotion code on the hosted page', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    expect(stripeState.created[0].allow_promotion_codes).toBe(true);
  });

  it('records the discounted total Stripe reports, not the list price', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await dispatchPaymentEvent(paid('cs_test_1', { amount_total: 3150 }));
    expect(db.payable[0].amount).toBe(3150);
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

describe('quantity', () => {
  it('charges one unit by default', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    expect(stripeState.created[0].line_items[0].quantity).toBe(1);
  });

  it('charges the quantity the hook returns, called with the stored record', async () => {
    quantityHook.override = async () => 3;
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    expect(stripeState.created[0].line_items).toEqual([{ price: 'price_catalog', quantity: 3 }]);
    expect(quantityHook.received).toEqual([{ id: 'w1', name: 'w', widget_catalog_id: 'cat_w1' }]);
  });

  it.each([0, -1, 1.5, Number.NaN])('fails closed on a quantity of %s, creating no session', async (bad) => {
    quantityHook.override = async () => bad;
    await createProvisional('paid_widget', 'w1');
    await expect(startPaymentCheckout('paid_widget', 'w1')).rejects.toThrow(/quantity must be a positive integer/);
    expect(stripeState.created).toHaveLength(0);
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

// What the generated cancel page does with a hit on /payment/cancel?payable_id=...
async function visitCancelPage(payableId: string) {
  if (await expirePendingCheckout(payableId)) {
    await removeUnpaidPayable(payableId);
  }
}

describe('cancelling from the return page', () => {
  it('removes the record right away, with no webhook ever delivered', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await visitCancelPage(payable.id);

    expect(stripeState.expired).toEqual(['cs_test_1']);
    expect(afterDeleteRan).toEqual(['paid_widget:w1']);
    expect(db.paid_widget).toHaveLength(0);
    expect(db.payable).toHaveLength(0);
  });

  it('leaves the later expired webhook with nothing to do', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await visitCancelPage(payable.id);
    await dispatchPaymentEvent(expired('cs_test_1'));
    expect(afterDeleteRan).toEqual(['paid_widget:w1']); // deleted once, not twice
  });

  it('removes nothing while Stripe still reports the session open', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    stripeState.expireLeavesOpen = true; // someone else hitting the URL: Stripe keeps the session open
    await visitCancelPage(payable.id);

    expect(db.paid_widget).toHaveLength(1);
    expect(db.payable).toHaveLength(1);
    expect(afterDeleteRan).toEqual([]);
  });

  it('removes nothing when Stripe says the session completed', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    stripeState.sessions.get('cs_test_1')!.status = 'complete'; // paid, webhook not yet processed
    await visitCancelPage(payable.id);

    expect(db.paid_widget).toHaveLength(1);
    expect(db.payable).toHaveLength(1);
    expect(afterDeleteRan).toEqual([]);
  });

  it('never removes a payable that is already paid', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await dispatchPaymentEvent(paid('cs_test_1'));
    await visitCancelPage(payable.id);
    await removeUnpaidPayable(payable.id); // even called directly
    expect(db.paid_widget).toHaveLength(1);
    expect(db.payable[0].status).toBe('paid');
    expect(stripeState.expired).toEqual([]);
  });

  it('ignores a second visit, a placeholder session and an unknown id', async () => {
    const pending = await createProvisional('paid_gadget', 'g0'); // no Checkout Session yet
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await visitCancelPage(payable.id);
    await visitCancelPage(payable.id); // record and payable already gone
    await visitCancelPage(pending.id);
    await visitCancelPage('nope');
    expect(stripeState.expired).toEqual(['cs_test_1']);
    expect(afterDeleteRan).toEqual(['paid_widget:w1']);
    expect(db.paid_gadget).toHaveLength(1);
  });
});

// What the generated success page does with a hit on /payment/success?session_id=...
async function visitSuccessPage(sessionId: string) {
  const session = await retrievePaidSession(sessionId);
  if (session) {
    await confirmPaidSession(session);
  }
}

function stripePays(id: string) {
  Object.assign(stripeState.sessions.get(id)!, { status: 'complete', payment_status: 'paid', amount_total: 4200, currency: 'usd' });
}

describe('arriving on the success page', () => {
  it('confirms the record when Stripe reports the session paid, with no webhook ever delivered', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    stripePays('cs_test_1');
    await visitSuccessPage('cs_test_1');

    expect(db.payable[0].status).toBe('paid');
    expect(db.payable[0].amount).toBe(4200);
    expect(db.payable[0].paid_at).toBeTruthy();
    expect(db.paid_widget).toHaveLength(1);
  });

  it('leaves the later completed webhook with nothing to change', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    stripePays('cs_test_1');
    await visitSuccessPage('cs_test_1');
    const paidAt = db.payable[0].paid_at;
    await dispatchPaymentEvent(paid('cs_test_1', { amount_total: 1 }));
    expect(db.payable[0].paid_at).toBe(paidAt);
    expect(db.payable[0].amount).toBe(4200);
  });

  it('confirms nothing while Stripe reports the session unpaid', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await visitSuccessPage('cs_test_1'); // someone opening the URL without paying
    expect(db.payable[0].status).toBe('pending');
  });

  it('confirms nothing for a session id Stripe does not know, or one no payable row names', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await visitSuccessPage('cs_made_up');
    stripeState.sessions.set('cs_other', { status: 'complete', url: 'u', payment_status: 'paid' });
    await visitSuccessPage('cs_other'); // paid on Stripe, but not this app's session
    expect(db.payable[0].status).toBe('pending');
  });
});

// The cancel page and the webhook both settle the same payable, and Stripe
// sends the expired event right after the cancel page expires the session, so
// they routinely overlap. Whatever the order, the record is removed once, its
// audit event and afterDelete hook run once, and a paid record is never touched.
describe('the return pages and the webhook settling the same record', () => {
  it('cancel page first, then the expired webhook: one removal, one audit event', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await visitCancelPage(payable.id);
    await dispatchPaymentEvent(expired('cs_test_1'));
    expect(afterDeleteRan).toEqual(['paid_widget:w1']);
    expect(auditRan).toEqual(['paid_widget:w1']);
    expect(db.payable).toHaveLength(0);
  });

  it('expired webhook first, then the cancel page: one removal, one audit event', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    // Stripe expires the session (the buyer cancelled) and the event lands first.
    stripeState.sessions.get('cs_test_1')!.status = 'expired';
    await dispatchPaymentEvent(expired('cs_test_1'));
    await visitCancelPage(payable.id);
    expect(afterDeleteRan).toEqual(['paid_widget:w1']);
    expect(auditRan).toEqual(['paid_widget:w1']);
    expect(db.payable).toHaveLength(0);
  });

  it('cancel page and expired webhook at the same moment: one removal, one audit event', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await Promise.all([visitCancelPage(payable.id), dispatchPaymentEvent(expired('cs_test_1'))]);
    expect(afterDeleteRan).toEqual(['paid_widget:w1']);
    expect(auditRan).toEqual(['paid_widget:w1']);
    expect(db.paid_widget).toHaveLength(0);
    expect(db.payable).toHaveLength(0);
  });

  it('two overlapping removals of one payable: one removal, one audit event', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    await Promise.all([removeUnpaidPayable(payable.id), removeUnpaidPayable(payable.id), removeUnpaidPayable(payable.id)]);
    expect(afterDeleteRan).toEqual(['paid_widget:w1']);
    expect(auditRan).toEqual(['paid_widget:w1']);
  });

  it('success page first, then the completed webhook: paid once, paid_at unchanged', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    stripePays('cs_test_1');
    await visitSuccessPage('cs_test_1');
    const paidAt = db.payable[0].paid_at;
    await dispatchPaymentEvent(paid('cs_test_1'));
    expect(db.payable).toHaveLength(1);
    expect(db.payable[0].paid_at).toBe(paidAt);
  });

  it('completed webhook first, then the success page: paid once, paid_at unchanged', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    stripePays('cs_test_1');
    await dispatchPaymentEvent(paid('cs_test_1'));
    const paidAt = db.payable[0].paid_at;
    await visitSuccessPage('cs_test_1');
    expect(db.payable[0].paid_at).toBe(paidAt);
    expect(db.payable[0].amount).toBe(4200);
  });

  it('success page and completed webhook at the same moment: one paid row, record kept', async () => {
    await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    stripePays('cs_test_1');
    await Promise.all([visitSuccessPage('cs_test_1'), dispatchPaymentEvent(paid('cs_test_1'))]);
    expect(db.payable).toHaveLength(1);
    expect(db.payable[0].status).toBe('paid');
    expect(db.paid_widget).toHaveLength(1);
    expect(afterDeleteRan).toEqual([]);
  });

  it('a paid record survives the cancel page and an expired webhook arriving together', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    stripePays('cs_test_1');
    await visitSuccessPage('cs_test_1');
    await Promise.all([visitCancelPage(payable.id), dispatchPaymentEvent(expired('cs_test_1'))]);
    expect(db.paid_widget).toHaveLength(1);
    expect(db.payable[0].status).toBe('paid');
    expect(afterDeleteRan).toEqual([]);
    expect(auditRan).toEqual([]);
  });

  it('a stranger opening the cancel URL while the session is open removes nothing, then the buyer can still pay', async () => {
    const payable = await createProvisional('paid_widget', 'w1');
    await startPaymentCheckout('paid_widget', 'w1');
    stripeState.expireLeavesOpen = true;
    await visitCancelPage(payable.id);
    stripeState.expireLeavesOpen = false;
    stripePays('cs_test_1');
    await visitSuccessPage('cs_test_1');
    expect(db.paid_widget).toHaveLength(1);
    expect(db.payable[0].status).toBe('paid');
  });
});
