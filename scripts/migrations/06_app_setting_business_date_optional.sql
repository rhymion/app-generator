-- Issue #1037: app_setting.business_date becomes optional.
--
-- The business date is now read: a pinned row (is_pinned = true) supplies the stored date, and an unpinned row
-- supplies today's date in its timezone, so an unpinned row has no date of its own. The column therefore turns
-- nullable, and every existing unpinned row has its stored date cleared (it was only ever a placeholder that
-- nothing read). Pinned rows keep their date.
--
-- Run once per database, before regenerating against the app-generator version that makes the column
-- optional. Test and dev databases created with `prisma db push` need no migration. Idempotent.

BEGIN;

ALTER TABLE "app_setting" ALTER COLUMN "business_date" DROP NOT NULL;

UPDATE "app_setting" SET "business_date" = NULL WHERE "is_pinned" = false;

COMMIT;
