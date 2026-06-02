# Local PostHog Setup

This document describes how to run a self-hosted PostHog instance locally for
analytics development and testing.

## Prerequisites

**WSL2 users**: WSL2 does not have Docker CLI installed by default.
You must install Docker before running local PostHog.

Options:
- [Docker Desktop for Windows](https://docs.docker.com/desktop/windows/wsl/) with WSL2 integration enabled
- [Docker Engine in WSL2](https://docs.docker.com/engine/install/ubuntu/) (native Linux install)

Verify Docker is available before proceeding:

```bash
docker --version
docker compose version
```

## Running PostHog Locally

Once Docker is installed, start the self-hosted PostHog stack:

```bash
docker compose -f docker-compose.posthog.yml up -d
```

PostHog UI is available at `http://localhost:8000` after startup (first boot
may take 2–3 minutes while migrations run).

See PostHog self-host docs for full configuration options:
<https://posthog.com/docs/self-host>

## Environment Variables

Set these in your local `.env.local` to point the generated app at the local PostHog instance:

```env
NEXT_PUBLIC_ANALYTICS_ENABLED=true
NEXT_PUBLIC_ANALYTICS_TOPOLOGY=embedded
NEXT_PUBLIC_POSTHOG_KEY=<your-local-project-api-key>
NEXT_PUBLIC_POSTHOG_HOST=http://localhost:8000
NEXT_PUBLIC_ANALYTICS_INGEST_ENDPOINT=/api/analytics/ingest
```

The local project API key is found in PostHog → Project Settings → Project API key.

## Phase 1 Status

Phase 1 (this release) ships the analytics scaffolding only — the provider
is a no-op that accepts no events. No data is sent to PostHog in Phase 1.
Enable `x-analytics.enabled: true` in your schema to generate the provider
scaffold. Set `NEXT_PUBLIC_ANALYTICS_ENABLED=false` to keep it inactive at runtime.

Phase 2 will wire real PostHog `capture()` calls into the no-op stubs.
