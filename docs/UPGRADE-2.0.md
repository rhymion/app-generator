# Upgrade Guide — 2.0

2.0 consolidates the (unreleased) 1.5 feature set **and** corrects two
breaking changes that shipped silently in 1.4. Because 1.5 was never
announced, the breaking changes are released together under a single major
bump rather than a series of patches.

> The repository ships **no migration files** — schema is applied with
> `prisma db push` (see `db:push`). Fresh installs always start from the
> current schema, so committing version-pinned migrations would be wrong for
> new users. This guide is the migration record instead; it lives in `docs/`,
> **not** under `prisma/migrations/`.

---

## Breaking changes folded into 2.0

| Introduced | Component | Assumed but not provisioned | Symptom on older schema |
|---|---|---|---|
| 1.4 | Comment system (`reaction` toggle: `app/api/comment/[commentId]/reactions/toggle/route.ts`, `lib/db_table/actions.ts`, `components/_standard/CommentReactionBar.tsx`) | `reaction` model + `user`/`comment` relations | `prisma.reaction` does not exist → TS build fails |
| 1.5 | Approval event dispatch (`app/api/approval_request/[id]/approve/route.ts`, `lib/approval_request/actions.ts`) | `approvable.approved_at` column | `approved_at` does not exist on `approvable` → TS build fails |

Both followed the same root cause: **static (non-generated) infrastructure
took an unconditional dependency on a new model/column that the generator
does not emit for schemas that predate it.** Verified non-breaking back to
1.0/1.2 once these two are present.

---

## What 2.0 adds to the schema

```prisma
model reaction {
  id          String   @id @default(cuid())
  type        Int
  user_id     String
  user        user     @relation("ReactionUser", fields: [user_id], references: [id])
  comment_id  String
  comment     comment  @relation(fields: [comment_id], references: [id], onDelete: Cascade)
  created_at  DateTime @default(now()) @db.Timestamptz(0)
  updated_at  DateTime @updatedAt @db.Timestamptz(0)

  @@unique([comment_id, user_id, type])
  @@index([user_id])
  @@index([comment_id])
}

// added to model approvable:
//   approved_at  DateTime?  @db.Timestamptz(0)
```

Plus the back-relations `user.reactions reaction[]` and
`comment.reactions reaction[]`, and the `reaction` entity in the JSON schema.

---

## Fresh install (2.0 from scratch)

Nothing special:

```bash
prisma db push      # creates reaction (+ its unique & indexes) and approvable.approved_at
prisma generate
```

---

## Upgrade an existing 1.0–1.4 deployment → 2.0

All schema changes are **additive** (a new table, a new *nullable* column, new
indexes), so `db push` applies them without data loss and without
`--accept-data-loss`.

```bash
# 1. Pull 2.0, regenerate the client
prisma generate

# 2. Apply additive schema changes. db push reads the @@unique/@@index
#    declarations and creates the indexes for you — no manual DDL needed.
prisma db push

# 3. Backfill ONLY required manual step (data, not schema — db push can't do it).
#    Mark already-fully-approved items as already-fired so the on-approved hook
#    does NOT retroactively dispatch for historical rows. reaction needs no backfill.
psql "$DATABASE_URL" -f docs/sql/2.0-approved_at-backfill.sql

# 4. Restart the app.
```

`2.0-approved_at-backfill.sql`:

```sql
UPDATE "approvable" a
SET "approved_at" = now()
WHERE a."approved_at" IS NULL
  AND EXISTS (SELECT 1 FROM "approval_request" r WHERE r."approvable_id" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "approval_request" r
                  WHERE r."approvable_id" = a."id" AND r."status" <> 1);
```

> The backfill only restores the **idempotency flag**. It does **not** replay
> any `on_approved.set_fields` / `emit_hook` side-effects for historical items —
> that is intentional; post-approval behavior is schema-specific and not
> retroactively replayable.

---

## Alternative: explicit DDL (no `db push`)

For operators who don't want `db push` touching a production database, apply
the equivalent raw SQL — **indexes included** (this is the path where forgetting
them is the real risk). Both files are idempotent (`IF NOT EXISTS` guards):

```bash
psql "$DATABASE_URL" -f docs/sql/2.0-reaction.sql                 # reaction table + indexes + FKs
psql "$DATABASE_URL" -c 'ALTER TABLE "approvable" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ(0);'
psql "$DATABASE_URL" -f docs/sql/2.0-approved_at-backfill.sql     # already-approved backfill
```

---

## Rollback

The additions are purely additive and unused by 1.x code, so a 1.x app can run
against a 2.0-migrated database unchanged. To roll the schema back, drop the
`reaction` table and the `approvable.approved_at` column.

---

## Why this slipped — and the gate that prevents recurrence

"Non-breaking" was asserted, not verified. The permanent fix is a CI
**backward-compatibility gate**: regenerate the previous N versions' reference
schemas with the current generator and run `next build`. Any unresolved
`prisma.<model>` / missing column is a breaking dependency that must be caught
before release, not by a user.
