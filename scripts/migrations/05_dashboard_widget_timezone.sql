-- Issue #911: dashboard_widget gains a "timezone" column of the native `Timezone` enum.
--
-- The zone decides where day / week / month / quarter / year boundaries fall when a widget buckets
-- a date-time field. Existing widgets get 'utc', which is the zone every bucket used before, so
-- their numbers do not change. Date-only fields are always bucketed on their stored date (UTC).
--
-- Requires the "Timezone" enum type, which 04_app_setting_timezone_enum.sql creates; run that
-- migration first. Test and dev databases created with `prisma db push` need no migration.

BEGIN;

ALTER TABLE "dashboard_widget"
  ADD COLUMN IF NOT EXISTS "timezone" "Timezone" NOT NULL DEFAULT 'utc';

COMMIT;
