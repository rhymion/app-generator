# Vercel Function Region ↔ Neon DB Region Alignment

## Why this matters

Vercel Serverless Functions run in a fixed region unless `vercel.json` tells
them otherwise (the platform default is `iad1`, US East). If that region does
not match the region of the Postgres database the app connects to, every
query pays a cross-region network round trip.

Measured on this project (2026-07-24): moving the
function region from `iad1` (US East) to `sin1` (Singapore, matching the
Neon project's `ap-southeast-1` region) took per-query latency from ~216ms to
~4ms — roughly a 54x improvement. The fix is placement, not code: same
query, same pooled connection, different function region.

## Single source of truth

The function region is set in **`vercel.json`**, the `regions` field, at the
repo root:

```json
{
  "regions": ["sin1"]
}
```

This is the *only* place the region needs to be set for an actual deploy —
`vercel.json` is deploy configuration read directly by the Vercel platform
on every deploy (dashboard region settings are not authoritative and can
drift silently; the checked-in file always wins). Do not hardcode a region
anywhere else that could drift from this file.

One existing exception, not a place to add a new one: `code_generator/generate.py`'s
`_VERCEL_JSON_DEFAULTS` dict hardcodes `'regions': ['sin1']` as the fallback
content used both when `vercel.json` doesn't already exist yet, and as a
self-heal backfill when an existing `vercel.json` is missing the `regions`
key entirely (e.g. a file written before this key existed, or one that
lost it by hand-edit). Normal `generate-code` runs read back and preserve
an *existing* `regions` value verbatim, whatever it is — only a genuinely
absent key gets the default filled in, and only the `crons` key is
otherwise rewritten. `code_generator/tests/test_vercel_json_crons.py`
covers both directions: a missing `regions` key gets backfilled with
`['sin1']`, and an existing value (including one that differs from the
default, e.g. `['fra1']`) is left untouched. It also asserts
`regions == ['sin1']` as a test fixture for the default itself. If the
region is ever changed per the steps below, update `_VERCEL_JSON_DEFAULTS`
and the test fixture too, or a future first-time `vercel.json` generation
(or the self-heal path) would silently regress to `sin1`.

**Consumers also carry `regions` directly now**: `proj_c`/`proj_g`/`proj_h`
each got their `vercel.json`'s `regions` key added or confirmed explicitly,
as a separate, parallel change to this generator-side self-heal. The
generator-side self-heal above is a safety net for the case a consumer's
`vercel.json` loses or never had the key — it is not the primary mechanism
consumers are expected to rely on.

**Multi-region fan-out is not an approved path around the Vercel WAF
request cap**: the project's design deliberately keeps a single region
(`sin1`) per deploy. If that single region's traffic approaches the
platform's WAF request-rate cap, the fix is to request a higher cap for
that region, not to spread requests across multiple regions. Do not
reintroduce a multi-region `regions` array as a cap workaround.

## Changing the region (e.g. customer provisions Neon in a different region)

1. Note the Neon project's region (visible in the Neon console, or in the
   connection string host, e.g. `...-ap-southeast-1.aws.neon.tech`).
2. Look up the matching Vercel region code:
   https://vercel.com/docs/edge-network/regions
3. Update the single `regions` entry in `vercel.json` to that code and
   redeploy.

Common Neon region → Vercel region code pairs (non-exhaustive — always
confirm against the Vercel docs link above, region codes can be added over
time):

| Neon region              | Vercel region code |
|---------------------------|---------------------|
| US East (Ohio)             | `iad1` (US East)    |
| US West (Oregon)           | `sfo1` / `pdx1`     |
| Europe (Frankfurt)         | `fra1`              |
| Asia Pacific (Singapore)   | `sin1`              |

## Dashboard setting is reconciled by `vercel-setup.sh`

A project created by `vercel project add` starts on the platform default
(`iad1`). The committed `vercel.json` only applies once Root Directory points
at the app-generator submodule, so a build that runs before that leaves the
project on `iad1` with nothing to flag it. Step 1.5 of `scripts/vercel-setup.sh`
therefore reads the project's `serverlessFunctionRegion` through the Vercel
Projects API and PATCHes it to the first `regions` entry of
`app-generator/vercel.json` when it differs. It is idempotent, skips when the
file has no `regions` entry, and is only echoed under `DRY_RUN=true`. Do not
add a `regions` key to the consumer's top-level `vercel.json` stub; it is not
the file read when Root Directory points at the submodule. The logic lives in
`scripts/vercel-region.sh` and is covered by `scripts/vercel-region.test.ts`
(fake `curl`, no live API).

## Scope note

This repo (`app-generator`) is the generator source of truth for the
`vercel.json` that ships to consuming projects (e.g. `app-template`) via
submodule. Choosing the region value is still manual (see the steps above);
`vercel-setup.sh` only copies the committed value onto the project's dashboard
setting.
