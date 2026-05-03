---
description: Investigate code or answer a question — Type C, no edits, no gates.
argument-hint: <question>
---

Treat this as a Type C (investigation) task per CLAUDE.md.

Rules:

- **Do not edit** any files.
- **Do not run** code generation, builds, tests, or docker.
- Read the code (`grep`, `find`, `Read`).
- Answer with `file:line` references where relevant.
- If a proposal would require code changes, present the option(s) with tradeoffs
  but do not implement. Ask whether to proceed; if so, switch to `/feature` or
  `/schema-update`.

Question: $ARGUMENTS
