# Claude Code settings.json — consumer-side setup (app-generator + app-template)

This doc covers how `.claude/settings.json` is discovered and matched when
working in this repo or in a project generated from it (e.g.
`app-template`, which consumes `app-generator` as a git submodule). It
exists because a real incident showed the naive assumption — "the
submodule's settings apply to the superproject too" — is wrong, and the
fix silently does nothing unless you also get the match rules right.

## 1. Which directory you launch `claude` from decides which settings.json applies

Per the official Claude Code docs (`docs/en/settings`, "Settings sources"):

> Hooks and other `.claude/settings.json` keys load from the current
> working directory's `.claude/` folder with no parent-directory fallback.

There is **no directory-tree search**: launching `claude` does not look
upward into a parent, and it does not look downward into a subdirectory —
including a nested git submodule. `app-template`'s `app-generator/`
directory is a **separate git repository** (a submodule), so
`app-generator/.claude/settings.json` is invisible to a session started at
`app-template/`'s root — even though `app-generator/` is physically nested
inside it.

Concretely, for this project pair:

- Run `claude` from `app-generator/` (this repo, standalone) →
  `app-generator/.claude/settings.json` applies.
- Run `claude` from `app-template/` (the consumer project's root) →
  only `app-template/.claude/settings.json` applies.
  `app-generator/.claude/settings.json` is **not** read, no matter what it
  contains.
- Run `claude` from inside `app-template/app-generator/` directly → that
  session is inside the submodule's own git repo root, so
  `app-generator/.claude/settings.json` applies again (and
  `app-template/.claude/settings.json` does not).

**Practical rule**: if you (or your team) work from `app-template/`'s root
— the normal way to use a generated project — `app-template/.claude/settings.json`
must itself carry the permission rules for the commands you run there
(`npm run generate-code`, `npm run test:e2e:cy:api`, etc., run with
`app-generator/` as a subdirectory of the working tree). Do not rely on
`app-generator/.claude/settings.json` to cover that case; it can't.

`.claude/settings.local.json` (the personal, gitignored override file —
see §3) behaves differently in Claude Code v2.1.211+: it resolves from the
**git repository root**, not strictly the launch directory, so a rule
written there applies to sessions started in any subdirectory or linked
worktree of the *same* repository. It still does not cross a submodule
boundary, for the same reason as above (the submodule is a different git
repository with its own root).

## 2. OS-independent rule syntax

Do not write OS-specific absolute paths (`/tmp/...`, `%TEMP%`,
`/var/folders/...`) into `permissions.allow`/`deny` rules. Three facts from
the official docs make this both necessary and avoidable:

**(a) No environment-variable expansion in rule patterns.** Permission
matching is literal/glob string matching against the exact command text —
there is no shell evaluation step before matching. Claude Code does strip
a *leading* assignment of a small set of known-safe env vars so
`Bash(npm test *)` still matches `NODE_ENV=test npm test`, but that is not
general `$VAR` expansion: writing `$TMPDIR` or `%TEMP%` literally inside a
rule pattern will never match the real, resolved path a command produces
at runtime. Any rule built around a temp-directory path must not depend on
env-var substitution working.

**(b) Wildcards can appear anywhere in a `Bash()` pattern** — start,
middle, or end — and a single `*` can span multiple arguments/words. Two
non-obvious details:
- The space before `*` matters: `Bash(ls *)` matches `ls -la` but not
  `lsof`; `Bash(ls*)` matches both.
- `Bash(git * main)` matches `git push origin main` **and**
  `git merge main` — a mid-pattern wildcard is a legitimate way to write
  one rule that covers a family of subcommands.

**(c) `Read()`/`Edit()` path rules use gitignore syntax with OS-normalized
anchors**, so one rule can cover every OS instead of three:
- `//path` — absolute path from the filesystem root
  (`Read(//Users/alice/secrets/**)`).
- `~/path` — path from the home directory.
- `/path` (single leading slash) — **not** an absolute path; it's
  relative to the settings source (repo root in project settings). This is
  a common trap: `/Users/alice/file` does not mean what it looks like.
- `path` / `./path` — relative to the current directory.
- **Windows paths are normalized to POSIX form before matching**:
  `C:\Users\alice` becomes `/c/Users/alice`. So `//c/**/.env` matches
  `.env` anywhere on the `C:` drive, and `//**/.env` matches it on any
  drive/OS. One rule (`Read(//**/scratchpad/**)`, for example) covers
  Linux, macOS, and Windows/WSL scratch-directory reads without an
  OS-specific variant for each.

Verify with a plain grep before committing a settings file:

```bash
grep -nE '/tmp/|%TEMP%|/var/folders/' .claude/settings.json  # expect no matches
```

## 3. `defaultMode` is a personal choice, not a shared setting

`permissions.defaultMode` (e.g. `"bypassPermissions"`) changes how much
Claude Code prompts you. Whether to skip prompts is an individual
developer's risk tradeoff, not something that should be forced on every
contributor via a committed file. Put it in your own
`.claude/settings.local.json` (gitignored — see `.gitignore` in both this
repo and `app-template`) instead of `.claude/settings.json`. The shared,
committed `settings.json` should carry only `permissions.allow`/`deny`
rules that make sense for everyone (the gate commands this project's
`.claude/commands/*.md` files require, plus the CLAUDE.md Tier-1
destructive-operation denials) and should not bake in a specific
permission mode.

`app-generator/.claude/settings.json` used to set
`defaultMode: "bypassPermissions"` directly (predates this doc); that line
has been removed so the shared, committed file follows the same principle
as `app-template`'s. If you launch Claude Code from `app-generator`'s own
root (rather than as a submodule under `app-template`) and want prompts
skipped by default there too, add it to your own
`.claude/settings.local.json` (gitignored) in that repo:

```json
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
```

## 4. The compound-command trap

Claude Code splits a Bash tool call on shell operators — `&&`, `||`, `;`,
`|`, `|&`, `&`, and newlines — and requires **each resulting subcommand to
match an allow rule independently**. A rule like `Bash(npm run
test:e2e:cy:api)` only covers that exact standalone invocation. The moment
you (or an agent) chain it with something else in one Bash call —

```bash
cd /path/to/worktree && docker compose --env-file .env.test -f docker-compose.test.yml up -d --wait && npm run db:push && npm run db:generate && npm run db:seed-baseline && npm run test:e2e:cy:api
```

— every one of `cd /path/to/worktree`, `docker compose --env-file
.env.test -f docker-compose.test.yml up -d --wait`, `npm run db:push`,
`npm run db:generate`, `npm run db:seed-baseline`, and `npm run
test:e2e:cy:api` must have its own match, or the whole line prompts. This
is why both `.claude/settings.json` files in this project pair carry
explicit `Bash(cd *)` and `Bash(docker compose --env-file .env.test -f
docker-compose.test.yml *)`-style rules in addition to the individual
`npm run <script>` entries — plain `npm run` gate commands run standalone
most of the time, but the isolated-worktree gate-run pattern above (see
this repo's worktree-isolation procedure) is a realistic, common compound
invocation that the old rule set (single-form `npm run` entries only)
did not cover at all.

Reference chained forms actually used by this project's gate workflow, and
which rule(s) each subcommand needs:

| Subcommand | Matching rule |
|---|---|
| `cd <any path>` | `Bash(cd *)` |
| `docker compose --env-file .env.test -f docker-compose.test.yml up -d --wait` | `Bash(docker compose --env-file .env.test -f docker-compose.test.yml *)` |
| `docker compose --env-file .env.test -f docker-compose.test.yml down -v` | same rule (wildcard covers `up`/`down`/any subcommand) |
| `npm run db:push` / `db:generate` / `db:seed-baseline` / `generate-code` / `check:generated` / `test:pytest` / `test:vitest` / `test:e2e:build` / `test:e2e:cy:api` / `test:e2e:cy:ui` / `lint` | exact `Bash(npm run <script>)` entry per script |
| `npm audit --omit=dev --audit-level=high` | `Bash(npm audit --omit=dev --audit-level=high)` |
| `pip-audit -r requirements.txt` | `Bash(pip-audit -r requirements.txt)` |
| `git worktree add <path> <ref>` / `git worktree remove <path>` | `Bash(git worktree add *)` / `Bash(git worktree remove *)` |

`npx`-prefixed commands (e.g. `npx cypress run ...`) are matched as-is —
`npx` is not one of the wrapper commands (`timeout`/`time`/`nice`/`nohup`/
`stdbuf`/`command`/`builtin`/`noglob`/bare `xargs`) that Claude Code
strips before matching, so write the rule as `Bash(npx cypress run
--browser chromium --spec *)`, not `Bash(cypress run *)`.

## 5. Verifying a settings file actually loaded

A syntactically broken `.claude/settings.json` does not raise a visible,
itemized error the way a missing file would — it just fails to contribute
its rules, and there is no per-file success/failure list to read after the
fact. Treat validation as two separate checks, both required:

1. **Syntactic**: before committing, run
   `python3 -m json.tool .claude/settings.json` (or the equivalent for
   `settings.local.json`). Non-zero exit / a printed error means the file
   is broken and none of its rules are in effect, silently.
2. **Behavioral smoke test**: launch `claude` from the directory in
   question and run `/status`. If you expect `bypassPermissions` (set in
   your own `settings.local.json`) and Claude Code still prompts for a
   command that should be covered by an `allow` rule, that is the signal
   the file failed to load or the rule didn't match — re-check both the
   JSON syntax and which directory you launched from (§1).

Do this after any edit to either `.claude/settings.json` file in this
project pair, and after adding/editing your own
`.claude/settings.local.json`.
