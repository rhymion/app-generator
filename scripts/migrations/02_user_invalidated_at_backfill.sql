-- cmd_564: add user.invalidated_at (generic invalidate mechanism) and
-- backfill it from anonymized_at for any user already anonymized before
-- this column existed.
--
-- Test and dev environments use `prisma db push`, which adds the nullable
-- column directly with no backfill needed (there is no existing data to
-- reconcile in a fresh test DB). This script is for production-style
-- deployments where anonymizeUser() may already have run against users
-- before this column existed, and anonymized_at is the source of truth
-- for the invalidated_at value: anonymizeUser() sets both together going
-- forward, so pre-existing rows are the only ones needing a backfill.

BEGIN;

ALTER TABLE "user"
  ADD COLUMN "invalidated_at" TIMESTAMP;

UPDATE "user"
   SET "invalidated_at" = "anonymized_at"
 WHERE "anonymized_at" IS NOT NULL;

COMMIT;
