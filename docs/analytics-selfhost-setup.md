# Analytics — Self-Hosted PostHog Setup

This document describes how to configure the generated app to send analytics
events to a self-hosted PostHog instance. The same §9 policy constants apply
as for PostHog Cloud — only the host URL differs.

## WSL2 Docker Constraint

**WSL2 environments do not have Docker CLI installed by default.**

Self-hosted PostHog requires Docker (multi-service compose stack). If
`docker --version` fails in your WSL2 terminal, you cannot run local PostHog
until Docker is installed.

### Option A — Docker Desktop for Windows with WSL2 integration (recommended)

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/windows/wsl/).
2. In Docker Desktop → Settings → Resources → WSL Integration, enable
   integration for your WSL distribution.
3. Verify in WSL2:
   ```bash
   docker --version
   docker compose version
   ```

### Option B — Docker Engine inside WSL2

Install Docker Engine directly in the WSL2 distribution (no Docker Desktop):

```bash
# Ubuntu / Debian example
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo service docker start
```

Verify:
```bash
docker --version
docker compose version
```

### If Docker is unavailable

Use PostHog Cloud test project credentials, or keep
`NEXT_PUBLIC_ANALYTICS_ENABLED=false` until Docker is available. Do not skip
the Docker prerequisite check — the self-host PostHog stack will not start
without it.

## Starting Local PostHog

Once Docker is confirmed working:

```bash
docker compose -f docker-compose.posthog.yml up -d
```

PostHog UI is available at `http://localhost:8000` after startup. First boot
may take 2–3 minutes while database migrations run.

Full self-host documentation: <https://posthog.com/docs/self-host>

## Environment Variables

Set these in `.env.local` to point the generated app at the local PostHog
instance:

```env
NEXT_PUBLIC_ANALYTICS_ENABLED=true
NEXT_PUBLIC_POSTHOG_KEY=<your-local-project-api-key>
NEXT_PUBLIC_POSTHOG_HOST=http://localhost:8000
NEXT_PUBLIC_ANALYTICS_TOPOLOGY=embedded
NEXT_PUBLIC_ANALYTICS_INGEST_ENDPOINT=/api/analytics/ingest
```

The local project API key is found in PostHog UI → Project Settings →
Project API key after creating a project in the local instance.

## §9 Policy Constants (same as Cloud)

Self-hosted PostHog uses the **identical §9 policy** as PostHog Cloud.
Values are baked directly into the template; `code_generator/analytics_policy.py`
is the specification reference, enforced by pytest assertions.

| SDK Init Option | Value | Policy Constant |
|---|---|---|
| `disable_session_recording` | `true` | `POSTHOG_DISABLE_SESSION_RECORDING = True` |
| `autocapture` | `false` | `POSTHOG_DISABLE_AUTOCAPTURE = True` |
| `capture_pageview` | `false` | managed by provider's route listener |
| `capture_pageleave` | `false` | managed by provider's route listener |
| `disable_surveys` | `true` | `POSTHOG_DISABLE_SURVEYS = True` |
| `enable_heatmaps` / `capture_heatmaps` | `false` | `POSTHOG_DISABLE_HEATMAPS = True` |
| `advanced_disable_feature_flags` | `true` | `POSTHOG_DISABLE_FEATURE_FLAGS = True` |
| `disable_persistence` | `false` | opt-in analytics; consent state uses session storage |

The `NEXT_PUBLIC_POSTHOG_HOST` is the only value that changes between
cloud and self-host. Everything else — SDK init flags, policy constants,
event taxonomy, allowlist sanitizer — is identical.

## Host URL Summary

| Environment | `NEXT_PUBLIC_POSTHOG_HOST` |
|---|---|
| PostHog Cloud (US) | `https://us.i.posthog.com` |
| Local self-host | `http://localhost:8000` |
| Custom self-host | `https://posthog.your-domain.com` |

## References

- PostHog self-host docs: <https://posthog.com/docs/self-host>
- Docker Desktop WSL2 backend: <https://docs.docker.com/desktop/features/wsl/>
- Cloud setup counterpart: `docs/analytics-cloud-setup.md`
- Internal design: `docs/analytics-design.md`
- Policy constants: `code_generator/analytics_policy.py`
