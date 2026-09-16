-- cmd_844: add approval_request.round_id with a safe 3-step backfill.
--
-- Test and dev environments use `prisma db push`, which collapses these
-- steps into a single rewrite (there is no existing data to reconcile in
-- a fresh test DB). This script is for production-style deployments where
-- existing approval_request rows must survive the column addition.
--
-- Backfill rule: round_id = id for every pre-existing row. Before this
-- column existed, every approval_request row was implicitly its own
-- independent "round" (no multistage flow ever created more than one row
-- per submission with a shared identity) -- see
-- lib/approval_request/submit_predicate.ts's module doc and
-- docs/knowledge/appendix/approval-flow.md for what a "round" means.

BEGIN;

-- 1) Add the column nullable so the rewrite touches every existing row
--    without violating NOT NULL.
ALTER TABLE "approval_request"
  ADD COLUMN "round_id" TEXT;

-- 2) Backfill every existing row to its own id (each pre-existing row is
--    its own round).
UPDATE "approval_request"
   SET "round_id" = "id"
 WHERE "round_id" IS NULL;

-- 3) Lock in the invariant. After this point every approval_request row
--    belongs to an explicit round.
ALTER TABLE "approval_request"
  ALTER COLUMN "round_id" SET NOT NULL;

-- Supporting index: canSubmitForApproval/canWithdrawApproval and the
-- ApprovalSection UI both fetch "all rows of the current round" by
-- round_id.
CREATE INDEX IF NOT EXISTS "approval_request_round_id_idx"
  ON "approval_request"("round_id");

COMMIT;
