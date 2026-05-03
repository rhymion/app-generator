---
description: Update prisma/schema.prisma and/or code_generator/json_schema.yaml — Type A workflow.
argument-hint: <change description>
---

Treat this as a Type A (schema-only) task per CLAUDE.md.

Steps:

1. Read the relevant docs under `docs/knowledge/` before editing — at minimum
   `prisma-schema-conventions.md` and `schema-yaml-configuration.md`, plus
   `code-generation-custom-extensions.md` if `x-generate` is involved.
2. Briefly state the planned schema change in 1–3 sentences.
3. Edit `prisma/schema.prisma` and/or `code_generator/json_schema.yaml`. If you
   discover drift between docs and reality, update the doc as part of this
   change.
4. Run the Type A gate:
   - `npm run docker:test:up`
   - `npm run demo:generate`
   - `npm run build`
   - `npm run cy:test:api`
5. If you find that Python generators (`code_generator/*.py`) or non-generated
   TypeScript also need to change, **stop and announce**: this is now Type B,
   not Type A. Switch to the Type B gate.

Schema change request: $ARGUMENTS
