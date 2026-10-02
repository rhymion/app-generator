// Stand-in for @/lib/stripe (lifecycle.test.ts only). It is the generated fake
// Stripe client itself (lib/payment/fake_stripe.ts, the one the gate's
// PAYMENT_FAKE_STRIPE=1 switch hands out), re-exported under the names the
// lifecycle test uses -- there is deliberately no second implementation here.
export {
  fakeStripe as stripe,
  fakeStripeState as stripeState,
  resetFakeStripe as resetStripe,
} from '../../lib/payment/fake_stripe';
