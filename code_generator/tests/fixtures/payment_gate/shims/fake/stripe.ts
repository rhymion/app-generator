// Recording stand-in for @/lib/stripe (lifecycle.test.ts only): the three
// Checkout Session calls lib/payment/checkout.ts makes, with just enough
// state to tell an open session from an expired one.
type Row = Record<string, any>;

export const stripeState = {
  created: [] as Row[],
  sessions: new Map<string, { status: 'open' | 'expired' | 'complete'; url: string; payment_status?: 'paid' | 'unpaid'; amount_total?: number; currency?: string }>(),
  expired: [] as string[],
  // Simulates Stripe answering expire() without closing the session.
  expireLeavesOpen: false,
};

export function resetStripe() {
  stripeState.created = [];
  stripeState.sessions = new Map();
  stripeState.expired = [];
  stripeState.expireLeavesOpen = false;
}

export const stripe = {
  checkout: {
    sessions: {
      async create(params: Row) {
        stripeState.created.push(params);
        const id = `cs_test_${stripeState.created.length}`;
        const url = `https://checkout.stripe.test/${id}`;
        stripeState.sessions.set(id, { status: 'open', url, payment_status: 'unpaid' });
        return { id, url, currency: 'usd', amount_total: 9900 };
      },
      async retrieve(id: string) {
        const s = stripeState.sessions.get(id);
        if (!s) throw new Error('No such session');
        return { id, ...s };
      },
      async expire(id: string) {
        const s = stripeState.sessions.get(id);
        if (stripeState.expireLeavesOpen) return { id, status: 'open' as const };
        if (!s || s.status !== 'open') throw new Error('Session is not open');
        s.status = 'expired';
        stripeState.expired.push(id);
        return { id, status: s.status };
      },
    },
  },
};
