This is an **update-generator** task. Read AGENTS.md before starting.

Minimum docs to read before starting:
- `docs/knowledge/prisma-schema-conventions.md`
- `docs/knowledge/schema-yaml-configuration.md`
- `docs/knowledge/code-generation-custom-extensions.md`
- `docs/knowledge/testing-cypress.md`
- `docs/knowledge/troubleshooting.md`

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

See `.claude/commands/update-generator.md §Completion gate` — canonical source of truth.
Open the file directly (it is in the same repository under `.claude/commands/`).

## Debug priority

| Failure | Investigate in this order |
|---------|--------------------------|
| Code generation fails | 1. schema (check undocumented implicit rules) → 2. generator bug |
| Build fails | 1. config → 2. schema → 3. code bug (both VCS-managed and generated) |
| Test fails | 1. generated test code bug |
| Other test fails | 1. generation logic missing a case → 2. product code bug |

> When running lint/typecheck in isolation, prefix with `npm run generate-code`.
> See `.codex/rules/generated-code-gates.md` for details.

## Input
$ARGUMENTS
