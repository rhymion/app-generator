# Stripe payment integration — `x-payment` opt-in write-once stubs

**Status: Implemented (generator side only)**
**Date: 2026-08-16**

## Scope decision

Payments are not a default-schema feature. The generator does not generate
a `Plan`/`Product`/`Purchase`-style entity, an authz/entitlement layer, or
any payment UI. It provides a "plug-in point" only: a schema key
(`x-payment`) that, when declared on any entity, causes three write-once
stub files to be emitted the first time `generate-code` runs — the same
write-once convention already used for
`lib/<parent>/invalidate_handler.ts` (see
`invalidate-no-handler-write-once-stub.md`).

This mirrors how `x-generate.invalidate` is a plug-in point rather than
generated domain behavior: the generator makes the wiring exist and build
correctly; a human fills in the business logic.

Scope is one-time purchases only (Checkout Session `mode: payment`).
Subscription lifecycle handling (`invoice.paid`,
`customer.subscription.deleted`, `invoice.payment_failed`, the
`subscription_item.billing_period.start/end` fields, `billing_mode:
'standard'`) is left for a consumer to add by hand if needed — out of
scope for the generator stub.

## What `x-payment: true` generates

Declaring `x-payment: true` on any entity in `json_schema.yaml` (see that
file's own `x-payment` vocabulary block for the authoritative
description) causes `generate.py` to write, once:

- `lib/stripe.ts` — Stripe SDK initialization. Fail-closed: throws at
  import time if `STRIPE_SECRET_KEY` is unset, so an app can never boot
  silently half-configured.
- `app/api/payment/checkout/route.ts` — Checkout Session creation stub
  (`POST`, session-authenticated via `getSessionUserId()`). The
  `price_id` / `line_items` are left as a `TODO` for the consumer to wire
  to their own entity.
- `app/api/webhooks/stripe/route.ts` — Webhook receiver stub. Verifies
  the signature via `req.text()` → `stripe.webhooks.constructEvent(...)`
  (Next.js App Router route handlers have no raw `req.body` the way
  Express does under `express.raw()` — reading as text is required).
  Fails closed the same way as `lib/stripe.ts` if
  `STRIPE_WEBHOOK_SECRET` is unset. Only `checkout.session.completed` is
  wired by default; the business logic inside that case is a `TODO`.

All three are written via `_write_stub()` (write-once): once a consumer
edits them, regeneration never overwrites the edits.

## Why entity-level, not a top-level schema flag

`x-payment` lives in `_ENTITY_LEVEL_DATA_KEYS` in `build_user_schema.py`
(Category C, alongside `x-reservation`/`x-splittable`/`x-self-only`) —
copied onto the reconstructed raw entity during the Stage 4 raw/view
split, same as those. It is a boolean read directly off an entity
definition (`defn.get('x-payment') is True`), not something that changes
what pages/routes get generated for that entity itself — the three stub
files it triggers are global (one `lib/stripe.ts`, not one per entity),
so `generate.py` scans **all** entity definitions once
(`_has_any_payment = any(...)`) and emits the stubs if any entity opted
in, mirroring the existing `_has_any_mention` scan for the mention-parser
utilities.

## Secrets

`STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET`
are documented as placeholders in `.env.example` (no values). Both
`lib/stripe.ts` and the webhook route fail closed — an app with
`x-payment` declared but no keys configured refuses to start those code
paths rather than silently no-op-ing. Test keys (`sk_test_...`) are
obtained from the Stripe Dashboard; webhook secrets for local dev via
`stripe listen --forward-to localhost:<port>/api/webhooks/stripe`.

## API version note (verified 2026-08-16)

`lib/stripe.ts`'s stub pins `apiVersion: '2025-03-31.basil'`. As of this
writing, a locally cached third-party API doc snapshot (recommended
version 22.2.0, last updated 2026-05-29) still shows the older
`2025-02-24` in its examples and does not cover the `2025-03-31` changes
below — those were confirmed instead via a live docs.stripe.com read.
Re-verify before relying on either source if picking this up much later:

- `subscription.current_period_start/end` is deprecated → use
  `subscription_item.billing_period.start/end` (irrelevant to the
  one-time-only stub generated here, but relevant if a consumer extends
  to subscriptions).
- `billing_mode` default changed from `standard` to `flexible` — again,
  only matters once subscriptions are added.
- Checkout Session `mode: 'payment'`, `stripe.checkout.sessions.create()`
  shape, and `stripe.webhooks.constructEvent()` are unchanged.

## Verification

`code_generator/tests/fixtures/payment_gate/` (`paid_widget` with
`x-payment: true`, `plain_widget` without) run through the real
`build_user_schema.py` → `generate.py` pipeline in
`code_generator/tests/test_payment_gate_fixture.py`, asserting:

- all three stub files are written when `x-payment: true` is declared
- both stubs' fail-closed checks are present in the generated content
- a hand-edited `lib/stripe.ts` is not overwritten on a second run
  (write-once)
- no stub is written when no entity in the schema declares `x-payment`
  (using `code_generator/tests/fixtures/invalidate_gate/`, which declares
  no `x-payment` key anywhere, as the negative control)

This repo's own `json_schema.yaml` declares no `x-payment` entity by
default, so the stubs are never emitted by this repo's own
`test:e2e:build`/`test:e2e:cy:api` gate runs — by design (opt-in, not a
default-schema feature). The `stripe` npm package (`^22.5.0`) was added
as a runtime dependency since `lib/stripe.ts` imports it unconditionally
once written.

## Deliberately out of scope for this task

A sample payment-enabled entity in a real consuming application, and
actual Stripe test-mode connection (webhook firing against a real test
key), are blocked on real Stripe test keys being provisioned and are
tracked as a separate follow-up task. This task verified only that the
generator-side mechanism (schema key → write-once stubs) works correctly.
