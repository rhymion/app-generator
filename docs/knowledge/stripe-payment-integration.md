# Stripe payment integration — `x-payment` record lifecycle

**Status: Implemented; the generator side is covered by the `payment_gate` fixture, the consumer side is verified against Stripe test mode separately**
**Date: 2026-08-16 (updated 2026-09-30: Price from `stripe_price_id` only, server-side Price and quantity, promotion codes)**

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
   creates a record that skips payment, and only Stripe's own report (a
   webhook event, or the Checkout Session the success page retrieves) marks a
   `payable` row paid.
2. **Checkout.** After that transaction commits (a Stripe round trip never
   runs inside a database transaction), `startPaymentCheckout()` creates the
   Checkout Session and stores its id on the `payable` row. The single line
   item is the record's Stripe Price and a quantity, both resolved on the
   server (see "Where the Price and quantity come from"); the session sets
   `allow_promotion_codes: true`, so the buyer can enter a Stripe promotion
   code on the hosted page. `client_reference_id` and `metadata.payable_id`
   both hold the `payable` row's id. If the session cannot be created, the record is removed through
   the entity's own generated `delete{Entity}()` and the `payable` row is
   deleted, and the caller gets an error.
3. **Redirect.** The Server Action redirects the buyer to the hosted
   Checkout URL. `POST /api/{entity}` returns `201` with
   `{ "record": { ... }, "checkoutUrl": "https://checkout.stripe.com/..." }`
   instead of the bare record (entities without `x-payment` are unchanged).
4. **Confirm or remove.** `POST /api/webhooks/stripe` verifies the signature
   and calls the generated `dispatchPaymentEvent()`:
   - `checkout.session.completed` (when `payment_status` is `paid`) and
     `checkout.session.async_payment_succeeded` set the `payable` row to
     `paid`, stamp `paid_at` and record `session.amount_total` (the total
     after any promotion code) and `session.currency`. The row is kept as
     the permanent payment record.
   - `checkout.session.expired` and `checkout.session.async_payment_failed`
     delete the record through the entity's own `delete{Entity}()`, then the
     `payable` row.
   A failure inside the dispatch makes the route answer 500, so Stripe
   redelivers the event.
5. **Cancel page.** `/payment/cancel?payable_id=...` expires the still-open
   session (`stripe.checkout.sessions.expire`) and, only when Stripe reports
   the session as `expired`, removes the record in the same request
   (`removeUnpaidPayable()`: the entity's `delete{Entity}()`, then the
   `payable` row). The page is an unauthenticated GET, so the query string
   decides nothing on its own: a session Stripe reports as still open or as
   complete (paid, or payment still processing) leaves the record in place,
   and a `paid` row is never removed. The `checkout.session.expired` event
   that follows finds no `payable` row and does nothing, so it stays as an
   idempotent backstop rather than the only way a cancelled record goes away.
   `/payment/success?session_id=...` is the mirror image: it retrieves the
   session from Stripe and, only when Stripe returns it with
   `payment_status: 'paid'`, marks the matching `payable` row `paid`
   (`confirmPaidSession()`, the same function the completed-session webhook
   uses). The `session_id` in the URL is only a lookup key; an unpaid session,
   an id Stripe does not know, or a paid session no `payable` row names
   confirms nothing. The completed event that follows finds the row already
   `paid` and does nothing.
6. **Abandoned checkout.** The session is created with `expires_at` 31
   minutes ahead (`CHECKOUT_SESSION_LIFETIME_SECONDS` in `lib/payment/checkout.ts`).
   Stripe accepts 30 minutes to 24 hours (epoch seconds; the default is 24
   hours) and measures the 30-minute minimum from when it receives the request,
   so the value is the 30-minute floor plus one minute of slack: the session
   effectively lasts about 31 minutes. A buyer who closes the tab without
   pressing Cancel or reaching the success page releases the record only when
   the session expires, through the `checkout.session.expired` event, so that
   path depends on the session lifetime and on webhook delivery. A buyer who
   needs more than about 31 minutes to pay finds the session expired.

If the webhook is not delivered at all (for example no `stripe listen` in local
development), a cancel from the cancel page still removes the record and the
success page still confirms a payment, but an abandoned checkout stays until
the event arrives. A scheduled job that lists undelivered events is not
implemented.

The pages and the webhook can settle the same record at the same moment (Stripe
sends the expired event right after the cancel page expires the session), so
each step is safe to repeat and to overlap: confirming only flips a row that is
still `pending`, removal starts only from a `pending` row, and the generated
`delete{Entity}()` does nothing for a row that is already gone or that a
concurrent delete removed first, so its audit event and `afterDelete` hook run
once. A `paid` row is never removed. If the process dies between deleting the
record and deleting the `payable` row, the retry finishes the removal.

The cancel and success pages are write-once files: an app generated before
these changes keeps its old pages (the cancel page only expires the session; the
success page is static). Copy the `removeUnpaidPayable` and
`retrievePaidSession`/`confirmPaidSession` calls from the generated templates
to get the new behaviour.

Idempotency needs no separate table. A repeated success event for a `paid`
row does nothing, and a repeated expiry event finds no `payable` row. An
expiry event for a `paid` row never removes it.

One window is left to Stripe's redelivery: the `payable` row holds the
placeholder `pending:<record id>` until the real session id is attached, and
an event for a session that is not attached yet finds no row. It is
acknowledged and ignored, and a later delivery of the event matches.

### Where the Price and quantity come from (no schema options)

`x-payment` stays a bare boolean. There is no amount field: the Price is
always a pre-created Stripe Price id, so discounts, promotion codes and other
currencies are Stripe's own features on that Price and on the Checkout
Session. The Price is found by the field name `stripe_price_id` (a required
`string`), resolved at `generate-code` time in this order:

1. **The entity itself** declares `stripe_price_id`. Every record of the
   entity is charged at that one Price, supplied by the column's `default:`
   (with a matching Prisma `@default(...)`), which is required. The field is
   added to the entity's read-only fields automatically, so it is not a form
   input and the REST `POST` and the Server Action reject a submitted value;
   a buyer cannot choose the Price.
2. **Exactly one related entity** declares it. `generate-code` scans the
   entity's foreign keys (`x-relationship` fields), and the Price is read
   through that relation on the server. `room_reservation` needs no price
   field of its own when `room` declares `stripe_price_id`: a buyer's only
   influence is which `room` the record points at, and each room carries its
   own Price. Nothing about `x-reservation` is involved; a pool-allocated
   `room_id` is an ordinary foreign key here.

`generate-code` fails when the entity has neither, when more than one foreign
key leads to an entity with `stripe_price_id` (two keys to the same entity
count as two; the error names the entity and each key), when the field is not
a `string` or is not required (or defaulted), when the own field has no
`default:`, for the object form `x-payment: { ... }`, and for
`x-generate.delete: false` (an unpaid record must be removable). Declaring
`stripe_price_id` on the entity itself always wins over a related one. A Price
that must differ per record but is not carried by a related entity is not
supported. The field name lives in `code_generator/payment_config.py`; the
generated `lib/payment/payment_source.ts` is the single runtime place that
reads it.

The quantity is decided by a write-once hook per `x-payment` entity,
`lib/payment/<entity>_quantity.ts`:

```ts
export async function resolvePaidWidgetQuantity(_record: paid_widget): Promise<number> {
  return 1;
}
```

It runs on the server after the record's create transaction has committed, with
the stored row, and never sees a client-submitted value. The default charges one
unit of the Price per record. Edit the body when the count depends on the
record, for example nights from a date range:
`Math.max(1, Math.round((record.check_out.getTime() - record.check_in.getTime()) / 86_400_000))`.
That expression counts elapsed 24-hour units, not calendar nights. It is exact
for date-picker input (stored as UTC midnight) and absorbs a one-hour DST shift
for same-time-of-day bookings, but a REST call with non-midnight times can
disagree with the calendar: 22:00Z to 02:00Z two days later is 28 hours, so it
rounds to one unit although it spans two calendar nights. A consumer that bills
calendar nights compares UTC dates instead:
`Math.max(1, Math.round((Date.UTC(co.getUTCFullYear(), co.getUTCMonth(), co.getUTCDate()) - Date.UTC(ci.getUTCFullYear(), ci.getUTCMonth(), ci.getUTCDate())) / 86_400_000))`,
with `ci` and `co` the two dates.
A result that is not a positive integer fails closed: no session is created and
the caller gets an error. The hook returns one quantity today; charging several
line items (a weekday and a weekend rate, for example) would widen its return
type to a list of `{ priceId, quantity }` and `line_items` in
`lib/payment/checkout.ts` to match, without moving where it is called from.

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
| `amount`, `currency` | Filled from the Checkout Session; on payment they are overwritten with the paid `amount_total` (after any promotion code) and `currency` |
| `created_at`, `paid_at` | |

The declaring entity's own table gets no extra column, so every generated list,
view and export path keeps working: a provisional record is an ordinary row
whose `payable` row says `pending`.

A consumer does not copy the `payable` model into its own
`prj/prisma/schema.prisma`. `prj:sync` knows the models `generate.py` appends
itself (`GENERATOR_INJECTED_MODELS` in `scripts/prj_sync.py`: `payable` and
`scheduled_task_run`) and does not count one as dropped when the consumer's
snapshot lacks it; the next `generate-code` appends it again. The drop guard
still reports every other model or field the snapshot is missing, and a
snapshot that does carry `payable` is still compared field by field.

### Interaction with `x-reservation`

Item-mode `x-reservation` allocates inside `add{Entity}()`'s transaction, and its
overlap check only looks at existing rows. A provisional record therefore holds
its slot merely by existing, and deleting it releases the slot. All removal
paths (checkout failure, the cancel page and the webhook) call `delete{Entity}()`, never a raw
Prisma delete, so `x-reservation` and any hand-written `afterDelete` run
without payment-specific code.

## What `x-payment: true` generates

`x-payment` is an entity-level data key (`_ENTITY_LEVEL_DATA_KEYS` in
`build_user_schema.py`, copied onto the raw entity like `x-reservation`). The
shared files below exist once per app, so `generate.py` scans every entity and
emits them when any entity opted in.

Always regenerated (not stubs):

- `lib/payment/payment_source.ts` — reads an entity's Stripe Price id (from
  itself or through a foreign key) and its quantity (via the hook below).
- `lib/payment/checkout.ts` — `startPaymentCheckout()`,
  `expirePendingCheckout()` (true only when Stripe confirms the session
  expired) and `retrievePaidSession()` (the session only when Stripe reports
  it paid).
- `lib/payment/payment_webhook_dispatch.ts` — `dispatchPaymentEvent()`,
  `confirmPaidSession()` and `removeUnpaidPayable()`, one statically imported
  `delete{Entity}()` branch per `x-payment` entity.
- `lib/payment/stripe_client.ts` — the Stripe client `lib/payment/` talks to:
  the real `lib/stripe.ts` client unless `PAYMENT_FAKE_STRIPE=1` is set (see
  "Generated specs without a Stripe key").
- `lib/payment/fake_stripe.ts` — the in-memory Checkout Session fake that
  switch hands out.
- the `payable` model in `prisma/schema.prisma`.
- `add{Entity}()`, `POST /api/{entity}` and the Server Action of each
  `x-payment` entity carry the lifecycle above.

Written once (write-once stubs; regeneration never overwrites edits):

- `lib/payment/<entity>_quantity.ts` — one per `x-payment` entity; how many
  units of the Price one record is charged for (default `1`).
- `lib/stripe.ts` — Stripe SDK initialization. Fail-closed: throws when the
  client is first used (any `stripe.<method>(...)` call) if
  `STRIPE_SECRET_KEY` is unset, so a payment code path can never run
  silently half-configured. The client is constructed lazily behind a
  `Proxy`, not at module evaluation time -- see the "Lazy construction
  note" below for why.
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

### No standalone Checkout route

There is no `app/api/payment/checkout/route.ts`. Checkout is entered only
through an `x-payment` entity's own create path (`startPaymentCheckout()` in
`lib/payment/checkout.ts`), which takes the Price from the entity or its
related entity, never from the request. A route that accepted a `price_id`
from the caller would let any signed-in user or API key create a Checkout
Session for any Price, so the generator no longer writes one.

An app generated before this change may still have the file. `npm run
cleanup` removes it when it is unchanged from what the generator wrote (it is
recorded in `.generated-manifest.json`); an edited copy, or one left because
`generate-code` ran without a prior `cleanup`, stays on disk. Nothing generated
imports it, so delete `app/api/payment/checkout/route.ts` by hand unless the
app deliberately uses it.

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

Which file holds the three keys depends on `NODE_ENV`:

| Environment | File | Notes |
|-------------|------|-------|
| Development (`next dev`) | `.env.local` | gitignored |
| Test environment (`NODE_ENV=test`, `next start` from the E2E scripts) | `.env.test.local` | gitignored; `.env.local` is not loaded in this environment |

`.env.test` is committed, so never put a key in it.

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

Copy the `whsec_...` signing secret it prints into `STRIPE_WEBHOOK_SECRET`
(in the file from the table above).

The forwarder has to be running whenever you exercise a payment locally:

- **Without `stripe listen`, no webhook event arrives.** The cancel and
  success pages still work: cancelling from the Checkout page removes the
  provisional record (the room is released) and returning from a successful
  payment marks the `payable` row `paid`. What depends on the event is an
  abandoned checkout (a closed tab): the record stays held until the session
  expires and the `checkout.session.expired` event is delivered.
- **`<port>` is the port the running server listens on.** In the test
  environment that is `PORT` from `.env.test`, which differs per worktree;
  it is not necessarily 3000.
- **The signing secret is stable.** `stripe listen --print-secret` returns
  the same `whsec_...` on every call for a given Stripe account and CLI
  login, and it equals what `stripe listen` prints, so it can be set once. A
  secret copied from a Dashboard endpoint is a different secret: it makes
  every locally forwarded event fail signature verification.
- When you handle further event types (subscription events, for example),
  add the same event names to `--events`. In the Stripe Dashboard, subscribe
  the endpoint to the same four events.

How a broken setup shows up in the `stripe listen` output:

| Output for a forwarded event | Cause |
|------------------------------|-------|
| `[400]` | `STRIPE_WEBHOOK_SECRET` differs from the value `stripe listen` prints |
| `connection refused` | `--forward-to` port is not the port the server uses |
| `[500]` (server log: `STRIPE_WEBHOOK_SECRET is not set`) | the secret is missing from the file the running environment loads |
| nothing at all | `stripe listen` is not running |

In every row no event is applied: an abandoned checkout stays held, and a
payment or cancel is settled only by the return pages.

## Production setup

This section lists what is specific to this app when it runs against a
deployed environment (staging or production). Stripe's own screens change, so
the steps in the Dashboard are left to Stripe's documentation, linked below.
For a local machine see "Local webhook forwarding" above.

1. **Test mode and live mode are separate worlds.** API keys, Products and
   Prices, and webhook endpoints (each with its own signing secret) exist
   once per mode, and an object from one mode cannot be used in the other
   ([API keys](https://docs.stripe.com/keys),
   [go-live checklist](https://docs.stripe.com/get-started/checklist/go-live)).
   The usual split is staging on test mode and production on live mode, each
   with its own keys, Prices and endpoint.
2. **Every row that supplies a Price needs a `stripe_price_id`.** Create the
   Product and Price in the mode the environment uses
   ([Products and Prices](https://docs.stripe.com/products-prices/manage-prices))
   and store the Price id on the entity that declares `stripe_price_id` (see
   "Where the Price and quantity come from"). When the Price comes from a
   related entity, such as `room`, fill it on **all** rows of that entity: a
   record that points at a row with an empty value fails when the checkout is
   created (`lib/payment/payment_source.ts`: "no `stripe_price_id` on its ...").
   The ids in a database belong to one mode, so a database that is used in
   production holds live-mode ids.
3. **Register one webhook endpoint per environment.** The URL is
   `https://<your-domain>/api/webhooks/stripe`, subscribed to the four events
   from the forwarding command above (`checkout.session.completed`,
   `checkout.session.expired`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`). Each endpoint has its own signing
   secret; it is not the value `stripe listen` prints
   ([webhooks](https://docs.stripe.com/webhooks)).
4. **Set the environment variables on the deployment:** `STRIPE_SECRET_KEY`,
   `STRIPE_PUBLISHABLE_KEY` (both from the mode the environment uses) and
   `STRIPE_WEBHOOK_SECRET` (from that environment's endpoint). Also set
   `NEXTAUTH_URL` to the public origin: the Checkout success and cancel URLs
   are built from it (`lib/payment/checkout.ts`), and it falls back to
   `http://localhost:3000` when unset, which sends the buyer back to
   localhost after paying.
5. **Check it end to end.** Pay with a Stripe test card in a test-mode
   environment (see [testing](https://docs.stripe.com/testing)) and confirm the
   `payable` row becomes `paid`. When it stays `pending`, open the endpoint's
   event deliveries in the Stripe Dashboard and read the response: `400` means
   the signing secret differs from the endpoint's, `500` means
   `STRIPE_WEBHOOK_SECRET` is not set in that environment.

**Vercel Deployment Protection.** On Vercel, Deployment Protection requires
authentication for every request to a protected deployment, and Standard
Protection covers all deployments except the production domains
([Deployment Protection](https://vercel.com/docs/deployment-protection)). A
protected staging deployment therefore does not accept Stripe's unauthenticated
webhook deliveries. Stripe cannot add headers to a delivery, so Vercel's
[Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
supports a query parameter on the endpoint URL, `?x-vercel-protection-bypass=<secret>`.
That URL then carries a secret: register it only in the Stripe endpoint
settings.

**Live payments** additionally require the Stripe account to be activated with
its business details ([account setup](https://docs.stripe.com/get-started/account/activate)).

## Lazy construction note (updated 2026-08-19: module-top-level throw removed)

`lib/stripe.ts`'s stub used to run its `STRIPE_SECRET_KEY` check and
`new Stripe(...)` construction at module top level (outside any
function), and the webhook route stub did the same for
`STRIPE_WEBHOOK_SECRET`. This broke `next build` in any consumer that
declared `x-payment: true`: Next.js's "Collecting page data" build step
evaluates every route module regardless of which HTTP methods it
exports, so importing a `POST`-only route such as the Checkout route this
generator then wrote (since removed) pulled in `lib/stripe.ts`, whose top-level `throw` fired during
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
describes; after the fix, the same command succeeds with the routes
re-appearing in the build output, and a separate manual check confirmed
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

## Generated specs without a Stripe key

A gate or CI run has no Stripe key and no real Price, yet the generated API,
UI and mobile specs of an `x-payment` entity create records, and a create opens
a Checkout Session. The generated specs therefore run against a fake Stripe
client, chosen by one explicit environment variable:

- `PAYMENT_FAKE_STRIPE=1` makes `lib/payment/stripe_client.ts` hand out
  `lib/payment/fake_stripe.ts` instead of the client from `lib/stripe.ts`. Any
  other value, or no value, keeps the real client. The `test:e2e:cy:api`,
  `test:e2e:cy:ui`, `test:e2e:cy:start` and `test:e2e:cy:dev` npm scripts set it
  and nothing else does: `test:e2e:start`, `test:e2e:dev`, `dev` and every
  production start path leave it unset, so trying real Stripe test mode by hand
  (test key in `.env.test.local`, `stripe listen`) still reaches Stripe.
- `NODE_ENV` is not part of the condition. A hand run against Stripe test keys
  shares `NODE_ENV=test` with the gate, and `next build` bakes
  `NODE_ENV=production` into the bundle, so it cannot tell them apart.
- It fails closed in a live environment. With the variable set and either
  `VERCEL_ENV=production` or an `sk_live_` key present, the first use of the
  client throws; it neither falls back to the real client nor serves the fake.
- The fake never touches the network. `create` returns the success URL as the
  checkout URL (the hosted page is unreachable offline) and keeps the session in
  memory; `retrieve` and `expire` answer from that state.
- While the fake is active, a record whose related entity (or itself) has no
  `stripe_price_id` resolves to the placeholder Price `price_fake` instead of
  failing, since the fake never sends it anywhere. With the real client the
  check is unchanged and still refuses to start checkout.

The generator's `payment_gate` fixture uses the same `fake_stripe.ts` as its
Stripe double (`shims/fake/stripe.ts` re-exports it), so there is one fake. The
real Stripe path stays covered by that fixture's lifecycle test and by
test-mode verification in a consumer.

## Verification

`code_generator/tests/fixtures/payment_gate/` declares two `x-payment`
entities (`paid_widget`, priced through its foreign key to `widget_catalog`,
which carries `stripe_price_id`; `paid_gadget`, priced by its own
`stripe_price_id` default) and a control entity without `x-payment`
(`plain_widget`). It runs through the real `build_user_schema.py` →
`generate.py` pipeline in `code_generator/tests/test_payment_gate_fixture.py`,
asserting:

- all four stub files are written when `x-payment: true` is declared, and none
  when no entity declares it (`invalidate_gate` is the negative control)
- the `payable` model is generated once and only for `x-payment` schemas
- for every `x-payment` entity, `add{Entity}()` creates the `payable` row and
  opens the Checkout Session, the REST route and the Server Action both go
  through it, and a checkout failure removes the record via `delete{Entity}()`;
  the control entity has none of this
- the webhook dispatcher has one branch per `x-payment` entity and none for the
  control entity
- the Price is read through the foreign key for `paid_widget` and off the
  record for `paid_gadget`; the Checkout Session takes `{ price, quantity }`
  with `allow_promotion_codes: true` and has no inline-amount branch
- the fake Stripe client is chosen only by `PAYMENT_FAKE_STRIPE=1`, is refused
  in a live environment, and the placeholder Price exists only behind it; only
  the `test:e2e:cy:*` npm scripts set the variable
- a quantity hook is written once per `x-payment` entity, defaults to `1`, and
  keeps a hand edit across regeneration
- `paid_gadget`'s own `stripe_price_id` is never client input: the REST route
  and the Server Action reject a submitted value and the create data omits the
  column, so the Prisma default is what is stored
- validation fails for no Price source, an ambiguous related Price (different
  or repeated foreign keys), a wrongly typed or optional Price field, an own
  Price without a `default:`, an object-form `x-payment`, and
  `x-generate.delete: false`; an `amount_cents` field is not a Price source
- no standalone Checkout route is written, and nothing generated references
  `/api/payment/checkout`
- the `success_url` / `cancel_url` targets in `lib/payment/checkout.ts` have
  generated pages whose copy comes from the `Payment` i18n namespace (both
  `en.json` and `ja.json`)
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
executing the generated code: a related entity's Price, or the record's own,
is what the session is created with, and a missing related Price fails closed
without creating a session; the quantity hook's result is the line-item
quantity, and a quantity that is not a positive integer creates no session; the
session allows promotion codes and the discounted `amount_total` is what a
paid event records; a created record is `pending`; a paid event
confirms it; a repeated paid event changes nothing; an expiry event (or a
failed asynchronous payment) removes the record through the entity's delete
function and the `payable` row; an event for one entity does not touch the
other entity's pending row; an expiry after payment removes nothing; a retry
finishes a removal a crash left half-done; the cancel page removes the record
with no webhook delivered, but only when Stripe reports the session expired (an
open or completed session, a paid payable and a repeat visit remove nothing);
the success page confirms a paid session with no webhook delivered and confirms
nothing for an unpaid, unknown or foreign session; either page and the matching
webhook event, in either order or at the same moment, remove or confirm the
record once (one delete, one audit event, one `afterDelete`, one `paid_at`);
the session is created with an `expires_at` of about 31 minutes. The create-time rollback inside
`add{Entity}()` is checked structurally by the pytest assertions above, not
executed. It is a required, unconditional CI job (`payment-gate-fixture`).

The fakes do not exercise Stripe itself, a real database, or
`x-reservation`; those are checked in a consumer against Stripe test mode. Under
Stripe's Adaptive Pricing it has not been measured whether `session.currency`
holds the buyer's payment currency or the settlement currency.

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

Subscriptions, several line items per record (differing weekday and weekend
rates), a per-record Price that no related entity carries, restricting a record
after payment, and showing a pending
record differently in list or view screens (`payable.status` is available for
it). A record whose Checkout Session never produces an event relies on Stripe
expiring the session; no scheduled clean-up exists.
