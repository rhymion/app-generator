# Analytics — Production PostHog Cloud Setup

This document describes how to configure the generated app to send analytics
events to PostHog Cloud (US region).

## Prerequisites

- A PostHog Cloud account at <https://posthog.com>
- A project created in the PostHog dashboard (US region)
- The project's **Project API Key** (`phc_…`)

## Environment Variables

Set these in your production environment (e.g., Vercel environment variables,
`.env.production.local` for self-managed deployments):

```env
NEXT_PUBLIC_ANALYTICS_ENABLED=true
NEXT_PUBLIC_POSTHOG_KEY=phc_your_project_api_key
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
NEXT_PUBLIC_ANALYTICS_TOPOLOGY=embedded
NEXT_PUBLIC_ANALYTICS_INGEST_ENDPOINT=/api/analytics/ingest
```

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_ANALYTICS_ENABLED` | Yes | Set `true` to activate the analytics provider |
| `NEXT_PUBLIC_POSTHOG_KEY` | Yes | PostHog Cloud project API key (`phc_…`) |
| `NEXT_PUBLIC_POSTHOG_HOST` | Yes | PostHog Cloud US ingest endpoint |
| `NEXT_PUBLIC_ANALYTICS_TOPOLOGY` | No | `embedded` (default) or `separated` |
| `NEXT_PUBLIC_ANALYTICS_INGEST_ENDPOINT` | No | Custom ingest route for `embedded` topology |

## §9 Policy Constants

The SDK init values below are baked directly into
`code_generator/templates/analytics_provider.tsx.jinja2` and cannot be
overridden at runtime. `code_generator/analytics_policy.py` is the authoritative
specification; pytest tests assert every value is present in the rendered output.

| SDK Init Option | Value | Policy Constant |
|---|---|---|
| `disable_session_recording` | `true` | `POSTHOG_DISABLE_SESSION_RECORDING = True` |
| `autocapture` | `false` | `POSTHOG_DISABLE_AUTOCAPTURE = True` |
| `capture_pageview` | `false` | managed by provider's route listener |
| `capture_pageleave` | `false` | managed by provider's route listener |
| `disable_surveys` | `true` | `POSTHOG_DISABLE_SURVEYS = True` |
| `enable_heatmaps` / `capture_heatmaps` | `false` | `POSTHOG_DISABLE_HEATMAPS = True` |
| `advanced_disable_feature_flags` | `true` | `POSTHOG_DISABLE_FEATURE_FLAGS = True` |
| `disable_persistence` | `false` | opt-in analytics; session storage used for consent state |

SDK initialization reference (from `analytics-design.md §2`):

```ts
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  autocapture: false,
  capture_pageview: false,
  disable_session_recording: true,
  advanced_disable_feature_flags: true,
  heatmaps: false,
  surveys: false,
});
```

## Data Retention

Data retention is set to **30 days** in the PostHog Cloud project settings
(Project Settings → Data retention). This matches the policy resolved 2026-06-02.

## US Region

PostHog Cloud US (`https://us.i.posthog.com`) is the fixed production region.
The EU region is not used. Do not change this without a policy review because
data residency and retention commitments are tied to the selected region.

## Query String Handling

All query strings are dropped before route values are included in any event
payload. The `QUERY_STRING_POLICY = "always_drop"` constant in
`analytics_policy.py` governs this behavior. Never include query strings in
`route` or `page_view` payloads.

## Consent and Identity

- Consent scope: all users (`CONSENT_SCOPE = "all_users"`). Show opt-in to
  every user; honour opt-out; send nothing before consent is given.
- Identity: both login user (`distinct_id`) and tenant (group) are attached.
  IDs only — no PII content is attached (`IDENTITY_ATTACH_USER = True`,
  `IDENTITY_ATTACH_TENANT = True`).

## References

- PostHog Next.js docs: <https://posthog.com/docs/libraries/next-js>
- PostHog JS config reference: <https://posthog.com/docs/libraries/js/config>
- Internal design: `docs/analytics-design.md`
- Policy constants: `code_generator/analytics_policy.py`
