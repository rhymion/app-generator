---
name: git-branch-commit-content-verify
description: |
  When comparing two branches with `git log A..B` to inventory commits unique
  to B, unique commit hashes do NOT prove unique content — the same change may
  already exist on A under a different hash (cherry-picked, re-implemented, or
  independently authored). Before recommending "land" or "discard" for any
  commit found by `git log A..B`, verify per commit: (a) search for an
  equivalent commit message on A via `git log A --grep`, and (b) check whether
  the specific file changes already exist on A via `git show A:<file>` /
  `git diff`. Also check for format-version or schema divergence between the
  branches before assuming a plain cherry-pick is safe. Trigger when asked to
  land, merge, or audit commits unique to a branch, when writing a "land vs
  discard" recommendation for a branch-diff commit inventory, or when a
  `git log A..B` commit count is about to be reported as "N commits need
  attention" without per-commit content verification.
  Do NOT use for: `git log` used purely for history/authorship lookup with no
  land/discard decision involved.
---

# git-branch-commit-content-verify

## North Star

`git log A..B` lists commits reachable from B but not from A **by commit
hash**. A commit hash is unique per exact tree state + parent + metadata; the
same logical change, re-committed differently (cherry-pick with conflict
resolution, manual re-application, independent re-authoring), gets a new hash.
Treating "N commits appear in `A..B`" as "N changes need to be landed" is
wrong whenever any of those N changes already reached A through a different
commit. Reporting a false "N commits need attention" count, or worse,
re-landing content that already exists, wastes review time and can create
duplicate/conflicting changes.

## Verification procedure (per commit found by `git log A..B`)

For each commit `C` unique to B:

1. **Message check**: `git log A --grep='<key phrase from C's message>'` — does
   an equivalent commit already exist on A?
2. **Content check**: for each file `C` touches, `git show A:<file>` (or
   `git diff <C>^ <C> -- <file>` compared against the same file's current state
   on A) — does the actual file content already reflect this change on A, even
   under a different commit message/hash?
3. If both checks find an equivalent on A: verdict is DISCARD (already landed
   under a different hash) — cherry-picking would be a no-op or a duplicate.
4. If neither check finds an equivalent: the change is genuinely unique to B —
   proceed to assess whether it should land.
5. **Format/schema divergence check**: before treating any surviving commit as
   a safe cherry-pick, confirm the two branches' schema/data format versions
   match (e.g. a schema file's `format_version` field). A structurally
   different schema generation on A can make a naive cherry-pick invalid even
   when the content is genuinely new.

## Example

Comparing a refactor branch against its integration branch surfaced 5 commits
via `git log integration..feature/my-refactor`. Two commits looked, by hash,
like unique changes to land. Applying the procedure: `git log integration
--grep` found equivalent commit messages already on `integration`, and
diffing the touched files (a page component, a Cypress support file) showed
zero net content difference. Both were correctly verdicted DISCARD — a naive
cherry-pick would have produced duplicate no-op commits. Two other commits
touched schema/generated-code files where the integration branch was already
at `format_version: "2.0"` while the feature branch predated it at `"1.0"` —
the schema-evolution mismatch made those commits unsafe to cherry-pick
regardless of content uniqueness.

## Do NOT

- Do not report a `git log A..B` commit count as "commits needing action"
  without per-commit message + content verification against A.
- Do not assume a commit is safe to cherry-pick just because its hash is
  absent from A — check the actual file content, not just the hash graph.
- Do not skip the format-version/schema-divergence check when the unique
  commits touch schema or generated-code files.
