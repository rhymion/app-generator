# Dependency Bump Acceptance Criteria

**Status: Adopted**
**Author: gunshi (subtask_459b_process_gap)**
**Date: 2026-07-26**

---

## Problem

When an ashigaru runs `npm update` or `npm install <pkg>` to bump a
dependency, `npm audit` may exit 0 even if `package-lock.json` is left
incomplete — indirect dependency entries can be silently dropped from the
lockfile. CI uses `npm ci`, which validates lockfile structural completeness;
the corruption is invisible locally until CI runs.

Two incidents of this failure pattern occurred within one week on the same
project (cmd_442→cmd_443, subtask_457j_i2_fix→cmd_459). A process-level
rule is required to prevent recurrence.

---

## Rule

**Any task that bumps a direct or indirect npm dependency MUST include both
of the following acceptance criteria:**

1. **`npm ci` exits 0** — validates that `package-lock.json` is complete
   and installable on a clean node_modules. This is the check that catches
   lockfile corruption that `npm audit` misses.

2. **`npm audit --omit=dev --audit-level=high` exits 0** — validates that
   no high/critical vulnerabilities are introduced by the bump.

`npm audit` alone is **insufficient** as the sole acceptance criterion for
dependency bump tasks.

### Why npm audit alone is not enough

`npm audit` inspects the set of resolved package names and versions reported
in the lockfile. It does **not** verify that every indirect dependency entry
is present and resolvable. A bump can:

- Add an entry for the bumped package ✓
- Leave indirect dependency entries (`@emnapi/runtime`, postcss peer deps,
  etc.) absent or at incorrect resolution levels ✗

`npm ci` enforces structural lockfile integrity: it fails with an explicit
error listing the missing entry (e.g.
`Missing @emnapi/runtime@1.11.2 from lock file`).

---

## Checklist for Dependency Bump Tasks

When writing or reviewing an ashigaru task that bumps any npm dependency,
confirm the task YAML's `acceptance_criteria` includes:

```yaml
acceptance_criteria:
  - npm ci exits 0 (clean node_modules, not npm install — npm ci validates lockfile integrity)
  - npm audit --omit=dev --audit-level=high exits 0
  - git diff package-lock.json reviewed for unexpected transitive changes
```

The third item (diff review) is recommended for all bumps and mandatory
when bumping peer-dependency-heavy packages (postcss, babel, webpack,
esbuild, napi-rs stack).

---

## Incidents

### Incident 1: cmd_442 → cmd_443 (2026-07-24)

- **Package bumped**: `@emnapi/runtime` and related `@napi-rs/*` stack
- **Failure mode**: `package-lock.json` missing `@emnapi/runtime@1.11.2`
  entry after bump
- **Detection**: CI `npm ci` exit 1 with explicit missing-entry error
- **AC at the time**: `npm audit` only — `npm ci` exit 0 not required
- **Repair**: `git restore package-lock.json && npm install --package-lock-only`
  (see `~/.claude/skills/shogun-npm-lock-integrity-repair/SKILL.md`)
- **Repair task**: cmd_443

### Incident 2: subtask_457j_i2_fix → cmd_459 (2026-07-26)

- **Package bumped**: `postcss` 8.5.15 → 8.5.23
- **Failure mode**: `package-lock.json` lockfile corruption after postcss update
- **Detection**: CI all-red (all checks failing)
- **AC at the time**: `npm audit` only — `npm ci` not listed in acceptance
  criteria for the bump subtask
- **Hotfix task**: cmd_459 subtask_459a (parallel dispatch)

---

## Repair Procedure

If `npm ci` fails after a dependency bump has landed:
→ See `~/.claude/skills/shogun-npm-lock-integrity-repair/SKILL.md`

---

## Related Documents

- `~/.claude/skills/shogun-npm-lock-integrity-repair/SKILL.md` — repair
  procedure after lockfile corruption is detected
- `docs/knowledge/submodule-pointer-bump-policy.md` — analogous policy
  for submodule pointer bump tasks
