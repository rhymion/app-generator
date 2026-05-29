---
description: Investigate code or answer a question — no edits, no gates.
argument-hint: <question or topic>
---

This is an **investigate** task. Read CLAUDE.md before starting.

Task: $ARGUMENTS

## Rules

- **Do not edit** any files.
- **Do not run** code generation, builds, tests, or docker.
- Read the code (`grep`, `find`, `Read`).
- Answer with `file:line` references where relevant.
- If a proposal would require code changes, present the option(s) with tradeoffs
  but do not implement. Ask whether to proceed; if so, the user will switch to the
  appropriate task type (`/generate-schema`, `/update-generator`, `/add-component`,
  or `/update-code`).

## Completion gate

None. No files modified, no commands run.

> **Note**: When running lint or typecheck in isolation, prefix with
> `npm run generate-code` first. See `AGENTS.md §Generated-code prerequisites
> for gates` for the full rule.
