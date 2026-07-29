# CI must not depend on repository secrets for test-only values

## Problem

`.github/workflows/ci.yml`'s E2E job used to read `AUTH_SECRET` from a
repository secret:

```yaml
- name: Create env file
  run: echo "AUTH_SECRET=${{ secrets.AUTH_SECRET }}" >> .env.test.local
```

GitHub does not pass repository secrets (Settings → Secrets and variables →
Actions) to two classes of `pull_request`-triggered runs:

- **Dependabot PRs** — Dependabot has its own, separate secrets store
  (Settings → Secrets and variables → **Dependabot**). A `pull_request` run
  authored by Dependabot only sees that store, not the regular Actions one.
- **Fork PRs** — repository secrets are withheld from workflows triggered by
  a `pull_request` from a fork, by design (untrusted code shouldn't get
  secrets without explicit opt-in via `pull_request_target`, which has its
  own risks — see "Rejected alternative" below).

`secrets.AUTH_SECRET` therefore resolved to an empty string on those runs.
The workflow step didn't fail — it happily wrote `AUTH_SECRET=` (no value)
to `.env.test.local` — so the failure didn't surface until much later, deep
into the Cypress UI test suite, as an Auth.js error:

```
[auth][error] MissingSecret: Please define a `secret`.
```

Every UI spec that needs a logged-in session failed (session creation goes
through Auth.js, which needs `AUTH_SECRET`). REST API specs
(`cypress/e2e/api/**`) kept passing, because they authenticate with an
`X-API-Key` header instead of a session cookie and never touch Auth.js.
This made the failure look API-vs-UI-specific when the actual cause was
secret propagation, not the auth mechanism itself.

## Fix

`AUTH_SECRET` in CI is a disposable value scoped to a single ephemeral test
run — it has no secrecy value and nothing outside that run ever needs to
reproduce it. So it's generated in-workflow instead of sourced from any
secrets store:

```yaml
- name: Generate disposable test-only AUTH_SECRET (not a production secret)
  run: echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env.test.local
- name: Verify required test env is non-empty (fail-closed)
  run: |
    if [ -z "$(grep '^AUTH_SECRET=' .env.test.local | cut -d= -f2-)" ]; then
      echo "::error::AUTH_SECRET resolved empty in .env.test.local — refusing to continue."
      exit 1
    fi
```

This removes the workflow's only dependency on `secrets.*`, so Dependabot
PRs, fork PRs, and normal PRs all get the same value-generation path — no
more silent divergence.

The second step is a fail-closed guard: if a future change reintroduces an
empty/undefined required env value, CI aborts immediately at env-generation
time with a clear error, instead of resurfacing 15+ minutes later as a
confusing, seemingly-unrelated test failure.

Applies to both `app-generator/.github/workflows/ci.yml` and
`app-template/.github/workflows/ci.yml` (the latter writes to
`app-generator/.env.test.local` from the superproject checkout, since it
builds the submodule) — both had the identical pattern.

## Rejected alternatives

- **Register `AUTH_SECRET` in Dependabot's separate secrets store.** Would
  fix Dependabot PRs but not fork PRs, and doubles the places a value needs
  to be kept in sync for something that doesn't need to be a secret at all.
- **Switch the trigger to `pull_request_target`.** That event runs with the
  base branch's secrets available even for PRs from untrusted forks/bots,
  but it also checks out and executes the PR's (untrusted) code with that
  access — a real security downgrade for a problem that has a strictly
  better fix (stop depending on secrets for a value that was never a real
  secret).

## Local/dev note

This only affects the GitHub Actions runner environment. Local development
and agent worktrees still use a real `AUTH_SECRET` value from a gitignored
`.env.test.local` file (not committed, not derived from any repository
secret) — see `docs/knowledge/testing-cypress.md` for the general
test-environment setup.
