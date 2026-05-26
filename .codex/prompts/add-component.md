This is an **add-component** task. Read AGENTS.md before starting.

Minimum docs to read before starting (select relevant ones):
- `docs/knowledge/dark-mode-and-hydration.md`
- `docs/knowledge/mobile-responsive-layout.md`
- `docs/knowledge/testing-cypress.md`
- `docs/knowledge/troubleshooting.md`
- Other relevant docs under `docs/knowledge/`

## Task-specific rules

- When creating or updating a component, also create or update its component test.

## Common rules

1. `npm run lint` must pass.
2. If a gate step fails: investigate root cause → fix → re-run until it passes.
3. Always maintain compatibility between Prisma schema and JSON schema.
4. Follow model and field naming conventions.
   See `docs/knowledge/prisma-schema-conventions.md`.
5. Follow the docs (`docs/knowledge/` is the source of truth).
6. If you discover a new rule or useful skill, update the rule/skill documentation.
7. Read the docs before acting: at minimum AGENTS.md, and relevant `docs/knowledge/` files.

## Completion gate

Run in this order:

1. `npm run test:e2e:build`  — docker:up:test + generate-code + db:push + db:generate + db:seed-tenant + build
2. `npm run test`            — vitest component tests
3. `npm run test:e2e:cy:api` — API Cypress specs only
4. `npm run lint`
5. `npm audit --omit=dev --audit-level=high`

(`npm run test:pytest` is skipped — Python generators unchanged.)

## Debug priority

| Failure | Investigate in this order |
|---------|--------------------------|
| Code generation fails | 1. schema (check undocumented implicit rules) → 2. generator bug |
| Build fails | 1. config → 2. schema → 3. code bug (both VCS-managed and generated) |
| Test fails | 1. generated test code bug |
| Other test fails | 1. generation logic missing a case → 2. product code bug |

## Input
$ARGUMENTS
