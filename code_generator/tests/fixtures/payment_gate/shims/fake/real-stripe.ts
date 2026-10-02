// Stand-in for @/lib/stripe (lifecycle.test.ts only): a marker that is
// distinguishable from the fake Stripe client, so the "which client does
// lib/payment/ use" tests can tell the real path from the fake one without a
// network or a key. Any call into it is a bug in the test that reached it.
export const stripe = {
  checkout: {
    sessions: {
      create: async () => {
        throw new Error('real Stripe client reached');
      },
    },
  },
};
