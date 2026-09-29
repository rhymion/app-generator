# Stripe payment integration — `x-payment` record lifecycle

**Status: Implemented; the generator side is covered by the `payment_gate` fixture, the consumer side is verified against Stripe test mode separately**
**Date: 2026-08-16 (updated 2026-09-29: record lifecycle, `payable` model, multi-entity webhook dispatch)**

## Scope decision

Payments are not a default-schema feature. Declaring `x-payment: true` on an
entity ties that entity's record creation to a Stripe Checkout payment: a new
record is provisional until Stripe confirms the payment, and is removed if the
payment never happens. The generator does not generate a
`Plan`/`Product`/`Purchase`-style entity or an entitlement layer.

Scope is one-time purchases only (Checkout Session `mode: payment`).
Subscription lifecycle handling (`invoice.paid`,
`customer.subscription.deleted`, `invoice.payment_failed`, the
`subscription_item.billing_period.start/end` fields, `billing_mode:
'standard'`) is left for a consumer to add by hand if needed. Restricting
edits or deletes of a record after its payment succeeded is likewise not part
of `x-payment`.

## The record lifecycle

1. **Create.** The entity's generated `add{Entity}()` service function
   creates the row and, in the same transaction, a `payable` row with
   `status: pending`. Every create path calls this one function — the form's
   Server Action, `POST /api/{entity}`, bulk create, CSV import — so no path
   creates a record that skips payment, and nothing but the webhook marks a
   `payable` row paid.
2. **Checkout.** After that transaction commits (a Stripe round trip never
   runs inside a database transaction), `startPaymentCheckout()` creates the
   Checkout Session and stores its id on the `payable` row.
   `client_reference_id` and `metadata.payable_id` both hold the `payable`
   row's id. If the session cannot be created, the record is removed through
   the entity's own generated `delete{Entity}()` and the `payable` row is
   deleted, and the caller gets an error.
3. **Redirect.** The Server Action redirects the buyer to the hosted
   Checkout URL. `POST /api/{entity}` returns `201` with
   `{ "record": { ... }, "checkoutUrl": "https://checkout.stripe.com/..." }`
   instead of the bare record (entities without `x-payment` are unchanged).
4. **Confirm or remove.** `POST /api/webhooks/stripe` verifies the signature
   and calls the generated `dispatchPaymentEvent()` inside one
   `prisma.$transaction`:
   - `checkout.session.completed` (when `payment_status` is `paid`) and
     `checkout.session.async_payment_succeeded` set the `payable` row to
     `paid` and stamp `paid_at`. The row is kept as the permanent payment
     record.
   - `checkout.session.expired` and `checkout.session.async_payment_failed`
     delete the record through the entity's own `delete{Entity}()`, then the
     `payable` row.
   A failure inside the dispatch rolls the whole event back and the route
   answers 500, so Stripe redelivers it.
5. **Cancel page.** `/payment/cancel?payable_id=...` expires the still-open
   session (`stripe.checkout.sessions.expire`). Removal itself still happens
   only through the `checkout.session.expired` event, so the record is deleted
   in exactly one place. `/payment/success` confirms nothing; it is a
   plain page, because the webhook is the only thing guaranteed to arrive.

Idempotency needs no separate table. A repeated success event for a `paid`
row does nothing, and a repeated expiry event finds no `payable` row. An
expiry event for a `paid` row never removes it.

One window is left to Stripe's redelivery: the `payable` row holds the
placeholder `pending:<record id>` until the real session id is attached, and
an event for a session that is not attached yet finds no row. It is
acknowledged and ignored, and a later delivery of the event matches.

### Where the amount comes from (no schema options)

`x-payment` stays a bare boolean. The entity declares **exactly one** of two
required fields, whose names are the convention:

| Field | Type | Meaning |
|---|---|---|
| `amount_cents` | integer | Per-record price in the smallest currency unit; sent as an inline `price_data` line item in `usd` |
| `stripe_price_id` | string | A pre-created Stripe Price id, used as-is (the Price carries its own currency) |

`generate-code` fails when the entity declares neither field, both fields,
the wrong field type, an optional field, the object form
`x-payment: { ... }`, or `x-generate.delete: false` (an unpaid record must be
removable). The field names live in `code_generator/payment_config.py`;
the generated `lib/payment/payment_source.ts` is the single runtime place that
reads them.

### The `payable` model

`generate.py` appends the `payable` model and `PayableStatus` enum to
`prisma/schema.prisma` (idempotent, only when an entity declares
`x-payment: true`), the same way `scheduled_task_run` is generated. It is
generated on purpose: a model hand-written into the base `schema.prisma` is
dropped from a consumer's `prj/prisma/schema.prisma` snapshot by `prj:sync`.
A consumer writes its migration at deploy time.

| Column | Notes |
|---|---|
| `id` | cuid; also the `client_reference_id` |
| `entity_name`, `record_id` | The paying entity's row, by value (no foreign key: one table serves every `x-payment` entity). Unique together |
| `status` | `pending` or `paid` |
| `stripe_checkout_session_id` | Unique; the webhook's lookup key |
| `amount`, `currency` | Filled from the created session |
| `created_at`, `paid_at` | |

The declaring entity's own table gets no extra column, so every generated list,
view and export path keeps working: a provisional record is an ordinary row
whose `payable` row says `pending`.

### Interaction with `x-reservation`

Item-mode `x-reservation` allocates inside `add{Entity}()`'s transaction, and its
overlap check only looks at existing rows. A provisional record therefore holds
its slot merely by existing, and deleting it releases the slot. Both removal
paths (checkout failure and the webhook) call `delete{Entity}()`, never a raw
Prisma delete, so `x-reservation` and any hand-written `afterDelete` run
without payment-specific code.

## What `x-payment: true` generates

`x-payment` is an entity-level data key (`_ENTITY_LEVEL_DATA_KEYS` in
`build_user_schema.py`, copied onto the raw entity like `x-reservation`). The
shared files below exist once per app, so `generate.py` scans every entity and
emits them when any entity opted in.

Always regenerated (not stubs):

- `lib/payment/payment_source.ts` — reads an entity's amount / Price id.
- `lib/payment/checkout.ts` — `startPaymentCheckout()` and
  `expirePendingCheckout()`.
- `lib/payment/payment_webhook_dispatch.ts` — `dispatchPaymentEvent()`, one
  statically imported `delete{Entity}()` branch per `x-payment` entity.
- the `payable` model in `prisma/schema.prisma`.
- `add{Entity}()`, `POST /api/{entity}` and the Server Action of each
  `x-payment` entity carry the lifecycle above.

Written once (write-once stubs; regeneration never overwrites edits):

- `lib/stripe.ts` — Stripe SDK initialization. Fail-closed: throws when the
  client is first used (any `stripe.<method>(...)` call) if
  `STRIPE_SECRET_KEY` is unset, so a payment code path can never run
  silently half-configured. The client is constructed lazily behind a
  `Proxy`, not at module evaluation time -- see the "Lazy construction
  note" below for why.
- `app/api/payment/checkout/route.ts` — a standalone Checkout Session stub
  (`POST(req: NextRequest)`) for a checkout that is not tied to an entity's
  record; `x-payment` entities do not go through it. Authenticates like every
  other generated API route: `resolveActorId(req)` accepts a valid `X-API-Key`
  / Bearer header or a signed-in session, and errors go through
  `handleApiError()`. The `price_id` / `line_items` are left as a `TODO`.
- `app/[locale]/payment/success/page.tsx` and
  `app/[locale]/payment/cancel/page.tsx` — the pages Stripe sends the
  buyer back to. Their copy comes from the `Payment` namespace in
  `messages/en.json` / `messages/ja.json`; the pages are not public paths, so
  the buyer needs to be signed in, as they were when creating the Checkout
  Session.
- `app/api/webhooks/stripe/route.ts` — Webhook receiver. Verifies the
  signature via `req.text()` → `stripe.webhooks.constructEvent(...)`
  (Next.js App Router route handlers have no raw `req.body` the way
  Express does under `express.raw()` — reading as text is required), then
  calls `dispatchPaymentEvent()`. Fails closed the same way as
  `lib/stripe.ts` if `STRIPE_WEBHOOK_SECRET` is unset -- checked inside the
  `POST` handler, not at module top level (see "Lazy construction note"
  below).

### Migrating an existing webhook route

`app/api/webhooks/stripe/route.ts` is the one write-once file that gained
logic: an earlier version only verified the signature and did nothing with
the event. Whether regeneration replaces it depends on the generator's
manifest (`.generated-manifest.json`). If the file on disk still equals a
render the manifest recorded for it, `generate-code` refreshes it
automatically ("Refreshed (stale stub ...)"). If the manifest has no such
record (for example after a fresh checkout that does not carry the manifest) or
the file was edited, it is skipped, and the one-line change is made by hand:
call `await dispatchPaymentEvent(event)` from `lib/payment/payment_webhook_dispatch`
inside the signature-verified handler, answering 500 when it throws. Both
outcomes were reproduced against the fixture. The file in the consumer that
declares `x-payment` today (`app-template`) matched its manifest history, so
it is refreshed by the next `generate-code`.

## Secrets

`STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET`
are documented as placeholders in `.env.example` (no values). Both
`lib/stripe.ts` and the webhook route fail closed — an app with
`x-payment` declared but no keys configured refuses to run those code
paths rather than silently no-op-ing (the check now happens the first
time the code path actually runs, not at process/module boot -- see
"Lazy construction note" below). Test keys (`sk_test_...`) are
obtained from the Stripe Dashboard.

### Local webhook forwarding

The Stripe CLI is a separate tool, not the `stripe` SDK package already in
`package.json`: install it from the Stripe docs (or `npm install -g
@stripe/cli`); do not add it to the app's `package.json`. Current CLI
versions refuse `stripe listen` without an event selection, so list the
events the webhook handles:

```
stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired \
  --forward-to localhost:<port>/api/webhooks/stripe
```

Copy the `whsec_...` signing secret it prints into `STRIPE_WEBHOOK_SECRET`.
When you handle further event types (subscription events, for example), add
the same event names to `--events`. In the Stripe Dashboard, subscribe the
endpoint to the same four events.

## Lazy construction note (updated 2026-08-19: module-top-level throw removed)

`lib/stripe.ts`'s stub used to run its `STRIPE_SECRET_KEY` check and
`new Stripe(...)` construction at module top level (outside any
function), and the webhook route stub did the same for
`STRIPE_WEBHOOK_SECRET`. This broke `next build` in any consumer that
declared `x-payment: true`: Next.js's "Collecting page data" build step
evaluates every route module regardless of which HTTP methods it
exports, so importing `app/api/payment/checkout/route.ts` (a `POST`-only
route) pulled in `lib/stripe.ts`, whose top-level `throw` fired during
the build itself whenever `STRIPE_SECRET_KEY` was unset -- as it normally
is on a Vercel Preview deploy, so every Preview build for a consumer with
`x-payment` declared failed outright.

The fix defers both checks to first use instead of import/module-eval
time:

- `lib/stripe.ts` exports `stripe` as a `Proxy` wrapping a lazily
  constructed `Stripe` client -- the real client (and its
  `STRIPE_SECRET_KEY` check) is only built on the first property access
  (`stripe.checkout.sessions.create(...)`, `stripe.webhooks.constructEvent(...)`,
  etc.), so `import { stripe } from '@/lib/stripe'` alone never throws.
  Callers are unaffected -- `stripe.<anything>` still works exactly as
  before.
- The webhook route's `STRIPE_WEBHOOK_SECRET` check moved from module top
  level into the body of `POST()`.

Fail-closed behavior is unchanged in substance -- a request that actually
tries to use Stripe without the required key still throws immediately,
with the same error messages as before. Only the *timing* moved, from
build/import time to request time.

Verified by reproducing the failure first: temporarily declaring
`x-payment: true` on an existing entity, running `generate-code`, then
`env -u STRIPE_SECRET_KEY -u STRIPE_WEBHOOK_SECRET -u
STRIPE_PUBLISHABLE_KEY npm run build` reproduced the exact
`Failed to collect page data for /api/payment/checkout` failure this note
describes; after the fix, the same command succeeds with both
`/api/payment/checkout` and `/api/webhooks/stripe` re-appearing in the
build output, and a separate manual check confirmed
`stripe.checkout.sessions.create(...)` still throws
`STRIPE_SECRET_KEY is not set...` when actually invoked with the key
unset.

## API version note (updated 2026-08-19: literal pin removed)

`lib/stripe.ts`'s stub used to pin `apiVersion: '2025-03-31.basil'` as a
hardcoded literal. This broke `next build` in any consumer that declared
`x-payment: true`: the `stripe` npm package's own TypeScript type for
`apiVersion` (`LatestApiVersion`) is a single fixed literal baked into
whatever SDK version is actually installed, and it changes on every SDK
bump -- including patch bumps within the same `^22.x` caret range, not
just major-version jumps. A hardcoded literal in the stub inevitably goes
stale against a moving type, with nothing catching it because this repo's
own default schema never exercises `x-payment` (see Verification below).

The fix removes the `apiVersion` field entirely rather than updating the
literal to whatever is current today -- replacing one literal with a
newer one is the same defect restated, not a fix. Confirmed via the
installed SDK's own source (`stripe.core.js`): when `apiVersion` is
omitted, the constructor falls back to `DEFAULT_API_VERSION`, the exact
same SDK-baked-in value the type otherwise demands as a literal
(`props.apiVersion || DEFAULT_API_VERSION`) -- so omitting the field is
behaviorally identical to pinning the SDK's current version, minus the
stale-literal hazard. If a consumer needs to pin an older API version on
purpose (e.g. mid-migration), pass `apiVersion` explicitly in their own
hand-edit of the write-once `lib/stripe.ts` stub -- this generator no
longer does so by default.

- `subscription.current_period_start/end` is deprecated → use
  `subscription_item.billing_period.start/end` (irrelevant to the
  one-time-only stub generated here, but relevant if a consumer extends
  to subscriptions).
- `billing_mode` default changed from `standard` to `flexible` — again,
  only matters once subscriptions are added.
- Checkout Session `mode: 'payment'`, `stripe.checkout.sessions.create()`
  shape, and `stripe.webhooks.constructEvent()` are unchanged.

## Verification

`code_generator/tests/fixtures/payment_gate/` declares two `x-payment`
entities (`paid_widget`, priced by `amount_cents`; `paid_gadget`, priced by
`stripe_price_id`) and a control entity without `x-payment`
(`plain_widget`). It runs through the real `build_user_schema.py` →
`generate.py` pipeline in `code_generator/tests/test_payment_gate_fixture.py`,
asserting:

- all five stub files are written when `x-payment: true` is declared, and none
  when no entity declares it (`invalidate_gate` is the negative control)
- the `payable` model is generated once and only for `x-payment` schemas
- for every `x-payment` entity, `add{Entity}()` creates the `payable` row and
  opens the Checkout Session, the REST route and the Server Action both go
  through it, and a checkout failure removes the record via `delete{Entity}()`;
  the control entity has none of this
- the webhook dispatcher has one branch per `x-payment` entity and none for the
  control entity
- validation fails for a missing, duplicated, wrongly typed or optional amount
  field, an object-form `x-payment`, and `x-generate.delete: false`
- the checkout stub resolves the caller with `resolveActorId`, and its
  `success_url` / `cancel_url` targets have generated pages whose copy comes
  from the `Payment` i18n namespace (both `en.json` and `ja.json`)
- the stubs' fail-closed checks are present, the webhook's
  `STRIPE_WEBHOOK_SECRET` check is inside the `POST` handler, and the exported
  `stripe` client is not constructed eagerly (regression guards for the
  module-evaluation defect in "Lazy construction note")
- a hand-edited `lib/stripe.ts` is not overwritten on a second run

`npm run test:payment-gate` (`scripts/check_payment_gate_fixture.sh`) runs the
same fixture through `build_user_schema.py` → `generate.py` →
`prisma generate` → `tsc --noEmit`, type-checking the generated
`lib/payment/*.ts`, the stubs and the return pages against the installed
`stripe` SDK and a real generated Prisma client (this is what catches an
`apiVersion` literal going stale, see the API version note). It then runs
`lifecycle.test.ts` with vitest against in-memory fakes of Prisma and Stripe,
executing the generated code: a created record is `pending`; a paid event
confirms it; a repeated paid event changes nothing; an expiry event (or a
failed asynchronous payment) removes the record through the entity's delete
function and the `payable` row; an event for one entity does not touch the
other entity's pending row; an expiry after payment removes nothing; a retry
finishes a removal a crash left half-done; the cancel page expires the session
but leaves deletion to the expired event. The create-time rollback inside
`add{Entity}()` is checked structurally by the pytest assertions above, not
executed. It is a required, unconditional CI job (`payment-gate-fixture`).

The fakes do not exercise Stripe itself, a real database, or
`x-reservation`; those are checked in a consumer against Stripe test mode.

This repo's own `json_schema.yaml` declares no `x-payment` entity, so its
`test:e2e:build`/`test:e2e:cy:api` gate runs never emit these files;
`test:payment-gate` exists to cover that gap. Neither gate runs a real
`next build`: the "Collecting page data" step that surfaced the module-eval
defect is not visible to `tsc --noEmit`, and a full `next build` of a minimal
fixture app costs 30-60s against ~5s for the current check. The pytest
assertions above are the cheaper structural guard for that defect class. The
`stripe` npm package is a runtime dependency because `lib/stripe.ts` imports
it unconditionally once written.

## Out of scope

Subscriptions, restricting a record after payment, and showing a pending
record differently in list or view screens (`payable.status` is available for
it). A record whose Checkout Session never produces an event relies on Stripe
expiring the session; no scheduled clean-up exists.
