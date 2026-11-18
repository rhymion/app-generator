# Claude Code hooks, subagents and the learning-observer skill

This repo ships Claude Code automation under `.claude/`:

| Path | What |
|---|---|
| `.claude/settings.json` → `hooks` | Registers the hooks below |
| `.claude/hooks/project_hooks.py` | All command hooks: one script, one sub-command per hook, standard library only |
| `.claude/agents/gate-runner.md` | Subagent that runs a task's completion gate |
| `.claude/agents/schema-consistency-reviewer.md` | Read-only subagent that reviews schema changes against the conventions docs |
| `.claude/skills/learning-observer/SKILL.md` | Skill that turns corrections and gate surprises into proposed rule updates |
| `code_generator/tests/test_claude_project_hooks.py` | Tests for every hook (part of `npm run test:pytest`, so CI runs them) |

These apply only to sessions started from this repo's root (see
`claude-code-settings-consumer-side.md` §1). A consumer such as app-template
does not inherit them; see "Consumers" below.

## Hooks

Hooks are deterministic: a script decides, not the model. Use one when a
rule can be checked mechanically (`gate-exemption-must-be-machine-checkable.md`).

| Event | Sub-command | Effect |
|---|---|---|
| `SessionStart` | `session-env` | Writes `export PATH="<repo>/.venv/bin:$PATH"` to `$CLAUDE_ENV_FILE`, so every Bash command in the session uses the project venv. `cleanup`, `generate-code` and `test:pytest` fail with `ModuleNotFoundError` (ruamel, pytest) under the system `python3`. In a linked worktree, which has no `.venv` of its own, it falls back to the main checkout's `.venv`. Does nothing when no venv exists. |
| `PreToolUse` (`Edit\|Write\|MultiEdit\|NotebookEdit`) | `guard-generated` | Blocks (exit 2) an edit to generated code: any file under the gitignored output directories (`app/generated/`, `mobile/e2e/generated/`, `code_generator/.generated/`, `prisma/migrations/`), plus every file `.generated-manifest.json` lists with `mode: "overwrite"`. Write-once stubs (`mode: "stub"`, e.g. `lib/<entity>/service_validation_custom.ts`) stay editable. The message points to the template, generator or schema instead. Override for one session: start Claude Code with `CLAUDE_ALLOW_GENERATED_EDITS=1`. |
| `PostToolUse` (`Edit\|Write\|MultiEdit`) | `check-written-file` | (1) Reports (exit 2) a direct `@mui` import in a `code_generator/templates/**/*.jinja2` file (same regex as `test_template_mui_imports.py`; a test keeps them equal). (2) Reports a `$queryRawUnsafe(` / `$executeRawUnsafe(` / `Prisma.raw(` call in a `.ts/.tsx/.js/.mjs/.cjs/.jinja2` file. Comment lines that only name the API pass, and `.semgrep/` fixtures are exempt (`raw-sql-policy.md`). (3) Runs `git add -N` on a new, untracked, not-ignored `.ts/.tsx/.js/.mjs/.cjs/.py` file. `check_tracked_generated_imports.py` reads the git index, so a tracked file that imports a brand-new untracked module would otherwise fail pytest. Intent-to-add stages no content. |
| `UserPromptSubmit` | `investigate-snapshot` | When the prompt is an investigate task (`/investigate …` or its expanded text), records a fingerprint of the work tree: sha256 of every changed or untracked, not-ignored file. It is stored in `<git-dir>/claude-hooks/investigate-<session>.json`, so it is never tracked. A later generate-schema / update-generator / add-component / update-code command ends investigate mode. Other follow-up prompts keep it. |
| `Stop` | `investigate-verify` | If an investigate snapshot exists and a file changed since then, blocks the stop and tells Claude to report the changed files to the user, and not to revert them without approval. Changes made before the investigate task started don't count. Never blocks twice in a row (`stop_hook_active`). |
| `Stop` | (prompt hook) | Model-judged sanity check: task type stated, gates reported, nothing left. See `claude-code-settings-consumer-side.md` §6. |

`.claude/worktrees/` (nested worktrees) is ignored by all hooks.

Design rules for `project_hooks.py`:

- **Never break a session.** Any unexpected exception exits 0 with a note
  on stderr. Only intended checks return 2 or a block decision.
- **Standard library only.** `SessionStart` runs before any venv is active.
- **Each hook is tested** in `test_claude_project_hooks.py` against a
  throwaway git repo. A test also checks that `settings.json` registers
  every sub-command.
- **Limits.** Edits made through Bash (`sed -i`, heredocs) bypass the
  `Edit/Write` hooks. `check:generated`, the pytest MUI gate and the
  raw-SQL checks in `check_generated.py` remain the real gates; the hooks
  only catch problems earlier.

Personal opt-out: `"disableAllHooks": true` in your own
`.claude/settings.local.json` (this disables all hooks, including the Stop
prompt).

## Subagents

Agent files are free until invoked. Each invocation starts with a fresh
context, so it costs tokens to rebuild what it needs.

- **`gate-runner`** (Sonnet): takes a task type and runs the steps of the
  `## Completion gate` section of `.claude/commands/<type>.md` in order, each
  as a standalone command so the `settings.json` allow rules match. It stops
  at the first failure and returns a pass/fail table, about 40 relevant log
  lines and the CLAUDE.md "Debug priority" row. It never edits or fixes
  anything. Use it so that `test:e2e:build` and Cypress output stay out of
  the main conversation. The main session still owns the fix and reports
  the gate result (the Stop hook checks that).
- **`schema-consistency-reviewer`** (inherits the session model): read-only
  review of a `prisma/schema.prisma` / `json_schema.yaml` change against
  `prisma-schema-conventions.md`, `schema-yaml-configuration.md`,
  `code-generation-custom-extensions.md` and the schema-trap skills. Run it
  before `generate-code`. `build_user_schema.py` only catches some
  divergences (R5), and a failed build costs far more than a review.

## learning-observer skill

A short in-house skill inspired by rebelytics' task-observer (CC BY 4.0;
idea only, no upstream code). Upstream was not vendored because it has a
753-line SKILL.md plus about 900 KB of references and scripts, loads before
every session's first tool call, and keeps its log at user scope rather than
in a repo.

The skill makes CLAUDE.md common rule 6 ("if you discover a new rule…")
systematic. It notices corrections, undocumented gate failures, implicit
rules and repeated manual steps, and picks a destination in this order:
machine check or hook, then `docs/knowledge/`, a skill, CLAUDE.md or a
command, and auto memory for personal facts. It fixes a doc inline only when
the current change requires that doc fix. Every other update goes into a
"Proposed rule updates (not applied)" list at the end of the final message,
at most three per task. It keeps no log file.

## Consumers

Consumers (app-template, inventory-app, insurance-app) launch Claude Code
from their own root, so nothing here applies to them automatically. To adopt:

- Copy `.claude/hooks/project_hooks.py` and the `hooks` block. Adjust
  `GENERATED_DIRS` and the `.venv` location if the consumer's layout differs.
  The hook reads `.generated-manifest.json` from the project root, so check
  where the consumer's `generate-code` writes it.
- Copy the agent files. `gate-runner` reads the consumer's own
  `.claude/commands/<type>.md` gate (`consumer-commands-canonical-source.md`),
  so it needs no changes.
- The tests live in this repo's `code_generator/tests/` and do not travel
  with a copy.

## Codex

`.codex/hooks/stop-sanity-check.sh` remains a reminder only. These hooks
have not been ported to Codex.
