# Consumer Migration Naming Debt: `approval_edit_terminal_test_and_withdraw`

**Status: Documented (accepted debt — no code change)**
**Date: 2026-08-27**

## What happened

Consumer repo insurance-app shipped and merged a migration folder named
`20260826044839_approval_edit_terminal_test_and_withdraw`. The name leaked
in from a different consumer repo, app-template, where a migration with
matching content had been created for a fixture entity literally named
`approval_edit_terminal_test`. insurance-app has no such entity — the
migration only adds a `withdrawn` enum value — so the name is misleading
about what it actually does.

### Root cause

A dispatch instruction told the assigned agent to make insurance-app's
migration "match app-template's, in both name and content." The
instruction meant this as guidance on *how to write* the migration (the
same enum-value-add pattern), not as license to copy app-template's literal
migration folder name verbatim. The agent took it literally and copied the
name unchanged, carrying app-template-specific vocabulary (a fixture entity
name that doesn't exist in insurance-app) into an unrelated repo.

## Why it is not being renamed

The migration is not source-only: it was already applied, through Vercel
preview builds, to insurance-app's shared Neon database, and the PR that
added it has since merged to `develop`. Prisma tracks applied migrations by
folder name in the `_prisma_migrations` table. Renaming the folder in the
repo without also updating that table row would make the repo and the
database disagree on the migration's name — the next deploy would see the
repo's new name as an unapplied migration and re-run its (non-idempotent)
`ALTER TYPE ... ADD VALUE` statement, which is exactly the failure shape
behind a prior production incident where a non-idempotent enum-add
migration was re-run against an already-migrated database and errored out
(Prisma error code P3009). Rewriting the `_prisma_migrations` row would fix
the mismatch, but requires direct database credentials that are not
available to an ordinary agent, and doing so for a purely cosmetic rename
was judged not worth the risk. The decision is to accept the name as
permanent debt and record it here rather than rename it.

## Prevention: how to phrase migration-naming guidance for consumer tasks

When a dispatch instruction points to another consumer repo's migration as
a model to follow, state explicitly which parts of that example are meant
to be copied (e.g., the SQL pattern, the general approach) and which parts
must instead be re-derived for the target repo (the folder name and any
identifiers drawn from *that* repo's own schema) — never phrase it as
"match repo X's migration" without drawing that line, since a name or
identifier left unqualified in an example is exactly what gets copied
verbatim.
