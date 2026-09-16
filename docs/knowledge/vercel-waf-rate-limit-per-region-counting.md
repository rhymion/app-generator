# Vercel WAF Rate Limiting: counters are per-region

Vercel WAF rate limit rules (`vercel firewall`, region-based counting) do
**not** count a single global total across all regions a request's traffic
may land in. Each region keeps its own independent counter for the same
rate limit key (e.g. IP address).

Official documentation states this directly:

> Rate limit counters are tracked on a per-region basis; traffic matching
> a given rate limit key in multiple regions can exceed the limit you
> configure for any single region.

Source: [WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), Vercel Documentation (accessed 2026-09-02).

## Practical implication

If traffic for a given key (e.g. a single client IP, via anycast /
multi-region routing, retries, or a distributed attack) is observed by N
distinct regions within the same time window, the requests that actually
reach the application can total up to N times the configured
**Request Limit** — not the configured limit itself. A rule configured as
"5 requests / 60s" does not guarantee at most 5 requests/60s pass through
globally; it guarantees at most 5 requests/60s pass through **per region**.

For a low-traffic deployment (e.g. this project's demo usage), requests
typically land in only 1-2 regions, so the practical gap versus the
configured limit is usually small. It still needs to be stated whenever a
WAF rate limit value is presented as a hard ceiling (e.g. to the project
owner), since the true worst case scales with the number of active
regions, not the configured number.

If a strictly-enforced, single global count is required regardless of
region distribution, the fix is not a firewall rule at all — it requires
in-code rate limiting via a centralized store (e.g. the
[Rate Limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk)
backed by a shared store such as Upstash Redis), which counts against one
shared counter instead of one counter per region.
