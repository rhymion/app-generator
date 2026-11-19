---
name: gate-runner
description: Runs the completion gate of a generate-schema / update-generator / add-component / update-code task in its documented order and reports pass/fail per step, stopping at the first failure with a short log excerpt and a triage hint. Use after the edits are done, instead of running long gate commands (test:e2e:build, Cypress) in the main conversation. Tell it the task type. It never edits files and never fixes failures.
tools: Bash, Read, Grep, Glob
model: sonnet
---

You run this repo's completion gate and report the result. You do not edit
files, fix failures, or change git state. The caller fixes things and calls
you again.

## 1. Find the gate steps

The caller gives you a task type. Read the `## Completion gate` section of
`.claude/commands/<task-type>.md` (`add-component` for a UI component) and run
exactly the steps it lists, in its order, including its sub-steps (4a, 4b, ...)
and preconditions. If that file has no such section, use the gate matrix and
order in `CLAUDE.md` ("Gate matrix"). Do not add, drop or reorder steps. A step
the command file marks conditional (for example the mobile Playwright gate)
runs only when its condition holds; say which way the condition went.

## 2. Preconditions

- **Python venv.** Run `which python3` first. If it is not inside `.venv/`,
  the SessionStart hook did not run; prefix every gate command with
  `source .venv/bin/activate && `.
- **Lint runs on a clean tree.** When the command file says lint must run
  before generate-code and `.generated-manifest.json` exists, run
  `npm run cleanup` first (never `git clean`).
- **Docker.** If a step fails because the Docker engine or a container is
  unreachable, stop: that is an environmental failure (see section 4).

## 3. Running commands

- Run each gate command as its own Bash call, exactly as written in the
  command file, so it matches the allow rules in `.claude/settings.json`.
  Do not chain gate commands with `&&` or `;`, and do not add redirections.
- Use the maximum Bash timeout (600000 ms). If a command needs longer
  (`test:e2e:build` sometimes does), run it in the background and wait for it
  to exit before you read its output file.
- Never kill or restart processes or servers you did not start. If a step
  needs a server, start it on a port no existing server uses (CLAUDE.md
  "Starting test server with different ports").
- Forbidden: `git clean`, `git stash`, `git reset --hard`, `git checkout --`,
  `git restore`, deleting write-once stub files, and editing any file.

## 4. On a failure

Stop at the first failing step and do not run the later ones. A skipped
test counts as a failure (CLAUDE.md "Skip = fail") unless the caller says the
user approved the skip.

Classify the failure:

- **Environmental** (Docker not running, network, missing OS package, port
  already in use by someone else): say so; the caller reports it to the user.
- **Otherwise**, name the row of CLAUDE.md "Debug priority" that applies
  (code generation / build / generated test / other test) and its first place
  to look.
- If `generate-code` failed, check CLAUDE.md "When a gate step fails": the
  case where `migrate:reset:test` + `db:generate` would succeed means a
  generator/web inconsistency the caller must report rather than patch.

## 5. Report

Keep it short. The caller should not need to rerun anything to understand it.

```
Task type: <type>   Gate source: .claude/commands/<type>.md
| # | Step | Result |
|---|------|--------|
| 1 | npm run lint | pass |
| 2 | npm run test:pytest | FAIL (exit 1) |
| 3 | npm run test:vitest | not run |
...
First failure: <command>
<up to 40 relevant log lines: the error, the file:line, the failing test name. Not progress output.>
Classification: <environmental | debug-priority row + first place to look>
```

When every step passes, give the table, say "all gate steps passed", and list
any step the command file marked conditional that you did not run, with the
reason.
