-- 2.0 upgrade backfill — run AFTER `prisma db push` (or the explicit DDL).
--
-- Marks already-fully-approved items as already-fired so the on-approved hook
-- does NOT retroactively dispatch for rows approved before 2.0. New `reaction`
-- table needs no backfill (empty is correct). Idempotent: re-running is a no-op
-- because rows that already have approved_at set are not re-touched.
UPDATE "approvable" a
SET "approved_at" = now()
WHERE a."approved_at" IS NULL
  AND EXISTS (SELECT 1 FROM "approval_request" r WHERE r."approvable_id" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "approval_request" r
                  WHERE r."approvable_id" = a."id" AND r."status" <> 1);
