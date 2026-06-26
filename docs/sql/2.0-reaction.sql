-- 2.0 upgrade — create the `reaction` table (comment reactions).
--
-- Use this only on the explicit-DDL path (operators who do NOT run
-- `prisma db push`). `prisma db push` creates this table and all three
-- indexes automatically from the schema. New table is empty — no backfill.
--
-- Run BEFORE the app starts. Idempotent via IF NOT EXISTS guards.
CREATE TABLE IF NOT EXISTS "reaction" (
  "id"         TEXT NOT NULL,
  "type"       INTEGER NOT NULL,
  "user_id"    TEXT NOT NULL,
  "comment_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(0) NOT NULL DEFAULT now(),  -- @updatedAt is app-managed; default covers manual inserts
  CONSTRAINT "reaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reaction_comment_id_user_id_type_key"
  ON "reaction"("comment_id", "user_id", "type");
CREATE INDEX IF NOT EXISTS "reaction_user_id_idx"    ON "reaction"("user_id");
CREATE INDEX IF NOT EXISTS "reaction_comment_id_idx" ON "reaction"("comment_id");

-- Foreign keys (guarded so re-running does not error)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reaction_user_id_fkey') THEN
    ALTER TABLE "reaction" ADD CONSTRAINT "reaction_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reaction_comment_id_fkey') THEN
    ALTER TABLE "reaction" ADD CONSTRAINT "reaction_comment_id_fkey"
      FOREIGN KEY ("comment_id") REFERENCES "comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
