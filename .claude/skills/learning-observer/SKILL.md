---
name: learning-observer
description: |
  Turns what a work session teaches into proposed updates to this repo's
  rules: docs/knowledge/*.md, CLAUDE.md, .claude/skills/, .claude/commands/,
  hooks or machine checks. Notices user corrections, gate failures whose cause
  no doc mentions, workarounds, and steps repeated by hand. At the end of the
  task it lists each proposal with its evidence and destination, and applies
  none outside the current change without the user's approval.
  Use during any generate-schema / update-generator / add-component /
  update-code / investigate task: when the user corrects you ("no, don't…",
  "that's wrong", "always…", "we never…"), when a gate fails for a reason the
  docs don't cover, when you find an undocumented rule, and in the CLAUDE.md
  sanity check before stopping.
  Do NOT use for: facts about one person's machine or habits (use auto
  memory), the doc fix that the current change itself requires (CLAUDE.md
  already says to make it as part of the change), or writing a skill from
  scratch (use skill-creator).
---

# learning-observer: from session friction to rule updates

Adapted from the idea behind task-observer
(<https://github.com/rebelytics/one-skill-to-rule-them-all>, Eoghan Henn,
CC BY 4.0). This is a short re-implementation with no upstream code. It fits
this repo's rule that `docs/knowledge/` is the source of truth.

## 1. What counts as an observation

Note an observation when one of these happens, with its evidence (the user's
words quoted, or the command and error):

| Signal | Example |
|---|---|
| The user corrects you | "Don't run lint after generate-code" |
| A gate fails for a reason no doc mentions | pytest fails on an untracked import |
| You find a rule that is implicit in code but not written down | `schema_deriver.py` rejects `Json` |
| You (or the user) repeat the same manual step | activating `.venv` before every gate |
| A doc or skill says something the code contradicts | a doc names a removed flag |

Ignore one-off typos, matters of taste with no rule behind them, and facts
that only matter in this conversation.

## 2. Choose the destination

Pick the narrowest place that will be read when the problem comes back:

1. **A machine check or hook** when the rule can be checked mechanically
   (`docs/knowledge/gate-exemption-must-be-machine-checkable.md`; hooks live in
   `.claude/hooks/project_hooks.py`, see
   `docs/knowledge/claude-code-hooks-and-agents.md`). Prefer this: a check
   cannot be forgotten.
2. **`docs/knowledge/<topic>.md`** for a rule about the schema, generators,
   generated code or tests. Extend the existing topic doc; create a new one
   only when no topic fits.
3. **`.claude/skills/<name>/`** for a multi-step procedure or a trap that
   should load only when its trigger appears (see the existing skills).
4. **`CLAUDE.md` or a `.claude/commands/*.md` file** only for a rule that
   applies to every task of that type. Keep these files short.
5. **Auto memory** (not this repo) for something specific to one user or one
   machine.

## 3. Apply or propose

- **Part of the current change** (the doc describing the code you are
  changing is now wrong or incomplete): fix it in this change. CLAUDE.md
  already requires this, so no approval is needed.
- **Everything else**, including investigate tasks where no edits are
  allowed: propose it, and do not edit.

List proposals at the end of your final message, after the sanity check:

```
## Proposed rule updates (not applied)
1. <destination file or "new hook in project_hooks.py">: <the rule, one sentence>
   Evidence: <quoted correction or command + error>
   Why there: <one line on why this destination>
```

When the user approves a proposal, apply it under the matching task type
(docs and skills: the current edit task, or `/update-code` from investigate;
a hook or check: `/update-code`, or `/update-generator` for a generator
check), and run that task's gates. When the user declines, drop it and do
not raise it again in this session.

## 4. Keep it cheap

- Do not keep a log file. Proposals live in the final message, and once
  approved they live in the destination file.
- At most three proposals per task. If you have more, keep the three with the
  strongest evidence and mention how many you dropped.
- Never interrupt the task to propose. Proposals wait for the final message.
