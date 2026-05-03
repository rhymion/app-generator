---
description: Implement or update a feature — Type B workflow with full gate.
argument-hint: <feature description>
---

Treat this as a Type B (feature) task per CLAUDE.md.

Steps:

1. Identify whether a schema change is required. If yes, plan that first.
2. Outline the implementation in 3–7 bullets and confirm with me before coding.
   Skip confirmation only for trivial changes (single-file, well-scoped).
3. Implement the change. If it introduces user-visible behaviour or new
   conventions, document it under `docs/knowledge/`.
4. Run the Type B gate:
   - `pytest code_generator/tests`
   - `npm run docker:test:up`
   - `npm run demo:generate`
   - `npm run build`
   - `npm run test`
   - `npm run cy:test:api`

Feature request: $ARGUMENTS
