// Vitest config for the payment-gate fixture's lifecycle check. Run with
// --root pointing at the generated fixture output (.generated-payment-gate),
// see scripts/check_payment_gate_fixture.sh. The aliases swap the four
// modules the generated lib/payment/*.ts imports that need a real database,
// Stripe account or the full generated entity services for in-memory fakes
// (@/lib/stripe becomes a marker; the fake client comes from the generated
// lib/payment/fake_stripe.ts, see fake/stripe.ts).
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['lifecycle.test.ts'],
    // What the gate's npm scripts set: lib/payment/ talks to the generated fake
    // Stripe client (re-exported by fake/stripe.ts). The tests that exercise
    // the switch itself override it per test.
    env: { PAYMENT_FAKE_STRIPE: '1' },
  },
  resolve: {
    alias: [
      { find: '@/lib/prisma', replacement: path.join(root, 'fake/prisma.ts') },
      { find: '@/lib/stripe', replacement: path.join(root, 'fake/real-stripe.ts') },
      { find: '@/lib/paid_widget/service', replacement: path.join(root, 'fake/entity-service.ts') },
      { find: '@/lib/paid_gadget/service', replacement: path.join(root, 'fake/entity-service.ts') },
      { find: '@/lib/payment', replacement: path.join(root, '../lib/payment') },
    ],
  },
});
