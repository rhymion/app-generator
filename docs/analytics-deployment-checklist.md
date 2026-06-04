# Analytics Deployment Checklist

Use this checklist before deploying a generated app with analytics enabled
(`x-analytics.enabled: true`).

## Environment Variables

- [ ] `NEXT_PUBLIC_POSTHOG_KEY` is set to a valid PostHog project API key (`phc_…`)
- [ ] `NEXT_PUBLIC_POSTHOG_HOST` is set to the correct endpoint:
  - PostHog Cloud US: `https://us.i.posthog.com`
  - Self-hosted: custom URL (e.g., `https://posthog.your-domain.com`)
  - Local dev: `http://localhost:8000`
- [ ] `NEXT_PUBLIC_ANALYTICS_ENABLED=true` is set in the deployment environment
- [ ] No PostHog management or admin keys are exposed as `NEXT_PUBLIC_` variables

## Policy Constants

- [ ] All §9 policy constants match `code_generator/analytics_policy.py` specification
  and are baked into `code_generator/templates/analytics_provider.tsx.jinja2`; pytest
  tests assert every value is present in the rendered output
- [ ] `POSTHOG_DISABLE_SESSION_RECORDING = True`
- [ ] `POSTHOG_DISABLE_AUTOCAPTURE = True`
- [ ] `POSTHOG_DISABLE_HEATMAPS = True`
- [ ] `POSTHOG_DISABLE_SURVEYS = True`
- [ ] `POSTHOG_DISABLE_FEATURE_FLAGS = True`
- [ ] `QUERY_STRING_POLICY = "always_drop"` (query strings never in route payloads)

## Schema Compatibility

- [ ] `x-analytics: enabled: false` (absent or false) generates **identical output**
  to schemas without any `x-analytics` key — verify with regression test
- [ ] `x-analytics` fields `topology`, `posthog_host`, and `ingest_endpoint` fall
  back to their defaults when omitted (confirmed by `build_context.py` read path)

## Disabled Analytics Guard

- [ ] When `NEXT_PUBLIC_ANALYTICS_ENABLED=false` (or `x-analytics.enabled: false`),
  the PostHog SDK is **not initialised** — the provider renders as a no-op
- [ ] No PostHog SDK code is imported into the client bundle when analytics is disabled
- [ ] No events are sent during disabled-analytics E2E or unit tests

## Query String Handling

- [ ] All `route` and `page_view` payloads have query strings stripped before send
- [ ] `QUERY_STRING_POLICY = "always_drop"` constant is enforced in the provider,
  not worked around

## Regression Test

- [ ] Run pytest with SKIP=0:
  ```bash
  cd code_generator
  python3 -m pytest --tb=short -q
  ```
  All tests pass. Zero SKIPs. Zero failures.
- [ ] Confirm `x-analytics: enabled: false` schema output is byte-identical to
  output from a schema with no `x-analytics` key (backward-compat test)

## References

- Cloud setup: `docs/analytics-cloud-setup.md`
- Self-host setup: `docs/analytics-selfhost-setup.md`
- Design and policy decisions: `docs/analytics-design.md §9`
- Policy constants: `code_generator/analytics_policy.py`
