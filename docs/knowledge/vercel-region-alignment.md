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

This is the *only* place the region needs to be set. There is no other
config file, environment variable, or script in this repo that overrides or
duplicates it — do not hardcode a region anywhere else. `vercel.json` is
deploy configuration read directly by the Vercel platform on every deploy
(dashboard region settings are not authoritative and can drift silently;
the checked-in file always wins).

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

## Scope note

This repo (`app-generator`) is the generator source of truth for the
`vercel.json` that ships to consuming projects (e.g. `app-template`) via
submodule. Automating region selection *at provisioning time* (e.g. having
a Neon-provisioning script write this field automatically) is tracked
separately as part of the Vercel/Neon deploy automation work
(`vercel-setup.sh` in the consuming project's `scripts/`) — out of scope
here. Until that lands, the manual step above is the supported path.
