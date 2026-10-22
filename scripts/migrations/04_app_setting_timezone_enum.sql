-- Issue #921: app_setting.timezone changes from a free String to the native `Timezone` enum.
--
-- Members are lowercase snake_case identifiers (asia_tokyo); the IANA spelling lives only in the
-- generated lib/_timezone.ts (TIMEZONE_IANA_NAME), never in the database.
--
-- Existing values are mapped as follows:
--   * the literal 'UTC' (the former column default) and any IANA name in the curated list map
--     to that member;
--   * a value already spelled like a member (for example 'asia_tokyo') is kept;
--   * every other value is coerced to 'utc', and each coerced row is recorded in
--     "_app_setting_timezone_coerced" (app_setting id, original value) so the change stays
--     auditable. Review that table, then drop it once it is no longer needed.
--
-- Run once per database, before regenerating against the app-generator version that introduces
-- the enum. Test and dev databases created with `prisma db push` need no migration.

BEGIN;

CREATE TYPE "Timezone" AS ENUM ('pacific_pago_pago', 'pacific_honolulu', 'pacific_marquesas', 'america_anchorage', 'america_los_angeles', 'america_denver', 'america_chicago', 'america_mexico_city', 'america_new_york', 'america_toronto', 'america_bogota', 'america_caracas', 'america_st_johns', 'america_sao_paulo', 'america_nuuk', 'atlantic_azores', 'utc', 'europe_london', 'europe_madrid', 'europe_paris', 'europe_berlin', 'europe_rome', 'africa_lagos', 'africa_cairo', 'africa_johannesburg', 'asia_jerusalem', 'europe_istanbul', 'europe_moscow', 'asia_tehran', 'asia_dubai', 'asia_kabul', 'asia_karachi', 'asia_kolkata', 'asia_kathmandu', 'asia_dhaka', 'asia_yangon', 'asia_bangkok', 'asia_jakarta', 'asia_shanghai', 'asia_hong_kong', 'asia_singapore', 'asia_manila', 'australia_perth', 'australia_eucla', 'asia_seoul', 'asia_tokyo', 'australia_adelaide', 'australia_sydney', 'australia_lord_howe', 'pacific_noumea', 'pacific_auckland', 'pacific_chatham', 'pacific_apia', 'pacific_kiritimati');

CREATE TABLE "_app_setting_timezone_coerced" (
  "app_setting_id" TEXT NOT NULL,
  "original_value" TEXT NOT NULL,
  "coerced_to" "Timezone" NOT NULL,
  "migrated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TEMPORARY TABLE "_timezone_iana_to_member" ("iana" TEXT PRIMARY KEY, "member" TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO "_timezone_iana_to_member" ("iana", "member") VALUES
  ('Pacific/Pago_Pago', 'pacific_pago_pago'),
  ('Pacific/Honolulu', 'pacific_honolulu'),
  ('Pacific/Marquesas', 'pacific_marquesas'),
  ('America/Anchorage', 'america_anchorage'),
  ('America/Los_Angeles', 'america_los_angeles'),
  ('America/Denver', 'america_denver'),
  ('America/Chicago', 'america_chicago'),
  ('America/Mexico_City', 'america_mexico_city'),
  ('America/New_York', 'america_new_york'),
  ('America/Toronto', 'america_toronto'),
  ('America/Bogota', 'america_bogota'),
  ('America/Caracas', 'america_caracas'),
  ('America/St_Johns', 'america_st_johns'),
  ('America/Sao_Paulo', 'america_sao_paulo'),
  ('America/Nuuk', 'america_nuuk'),
  ('Atlantic/Azores', 'atlantic_azores'),
  ('UTC', 'utc'),
  ('Europe/London', 'europe_london'),
  ('Europe/Madrid', 'europe_madrid'),
  ('Europe/Paris', 'europe_paris'),
  ('Europe/Berlin', 'europe_berlin'),
  ('Europe/Rome', 'europe_rome'),
  ('Africa/Lagos', 'africa_lagos'),
  ('Africa/Cairo', 'africa_cairo'),
  ('Africa/Johannesburg', 'africa_johannesburg'),
  ('Asia/Jerusalem', 'asia_jerusalem'),
  ('Europe/Istanbul', 'europe_istanbul'),
  ('Europe/Moscow', 'europe_moscow'),
  ('Asia/Tehran', 'asia_tehran'),
  ('Asia/Dubai', 'asia_dubai'),
  ('Asia/Kabul', 'asia_kabul'),
  ('Asia/Karachi', 'asia_karachi'),
  ('Asia/Kolkata', 'asia_kolkata'),
  ('Asia/Kathmandu', 'asia_kathmandu'),
  ('Asia/Dhaka', 'asia_dhaka'),
  ('Asia/Yangon', 'asia_yangon'),
  ('Asia/Bangkok', 'asia_bangkok'),
  ('Asia/Jakarta', 'asia_jakarta'),
  ('Asia/Shanghai', 'asia_shanghai'),
  ('Asia/Hong_Kong', 'asia_hong_kong'),
  ('Asia/Singapore', 'asia_singapore'),
  ('Asia/Manila', 'asia_manila'),
  ('Australia/Perth', 'australia_perth'),
  ('Australia/Eucla', 'australia_eucla'),
  ('Asia/Seoul', 'asia_seoul'),
  ('Asia/Tokyo', 'asia_tokyo'),
  ('Australia/Adelaide', 'australia_adelaide'),
  ('Australia/Sydney', 'australia_sydney'),
  ('Australia/Lord_Howe', 'australia_lord_howe'),
  ('Pacific/Noumea', 'pacific_noumea'),
  ('Pacific/Auckland', 'pacific_auckland'),
  ('Pacific/Chatham', 'pacific_chatham'),
  ('Pacific/Apia', 'pacific_apia'),
  ('Pacific/Kiritimati', 'pacific_kiritimati');

INSERT INTO "_app_setting_timezone_coerced" ("app_setting_id", "original_value", "coerced_to")
SELECT s."id", s."timezone", 'utc'::"Timezone"
  FROM "app_setting" s
 WHERE s."timezone" NOT IN (SELECT "iana" FROM "_timezone_iana_to_member")
   AND s."timezone" NOT IN ('pacific_pago_pago', 'pacific_honolulu', 'pacific_marquesas', 'america_anchorage', 'america_los_angeles', 'america_denver', 'america_chicago', 'america_mexico_city', 'america_new_york', 'america_toronto', 'america_bogota', 'america_caracas', 'america_st_johns', 'america_sao_paulo', 'america_nuuk', 'atlantic_azores', 'utc', 'europe_london', 'europe_madrid', 'europe_paris', 'europe_berlin', 'europe_rome', 'africa_lagos', 'africa_cairo', 'africa_johannesburg', 'asia_jerusalem', 'europe_istanbul', 'europe_moscow', 'asia_tehran', 'asia_dubai', 'asia_kabul', 'asia_karachi', 'asia_kolkata', 'asia_kathmandu', 'asia_dhaka', 'asia_yangon', 'asia_bangkok', 'asia_jakarta', 'asia_shanghai', 'asia_hong_kong', 'asia_singapore', 'asia_manila', 'australia_perth', 'australia_eucla', 'asia_seoul', 'asia_tokyo', 'australia_adelaide', 'australia_sydney', 'australia_lord_howe', 'pacific_noumea', 'pacific_auckland', 'pacific_chatham', 'pacific_apia', 'pacific_kiritimati');

UPDATE "app_setting" s
   SET "timezone" = m."member"
  FROM "_timezone_iana_to_member" m
 WHERE s."timezone" = m."iana";

UPDATE "app_setting"
   SET "timezone" = 'utc'
 WHERE "timezone" NOT IN ('pacific_pago_pago', 'pacific_honolulu', 'pacific_marquesas', 'america_anchorage', 'america_los_angeles', 'america_denver', 'america_chicago', 'america_mexico_city', 'america_new_york', 'america_toronto', 'america_bogota', 'america_caracas', 'america_st_johns', 'america_sao_paulo', 'america_nuuk', 'atlantic_azores', 'utc', 'europe_london', 'europe_madrid', 'europe_paris', 'europe_berlin', 'europe_rome', 'africa_lagos', 'africa_cairo', 'africa_johannesburg', 'asia_jerusalem', 'europe_istanbul', 'europe_moscow', 'asia_tehran', 'asia_dubai', 'asia_kabul', 'asia_karachi', 'asia_kolkata', 'asia_kathmandu', 'asia_dhaka', 'asia_yangon', 'asia_bangkok', 'asia_jakarta', 'asia_shanghai', 'asia_hong_kong', 'asia_singapore', 'asia_manila', 'australia_perth', 'australia_eucla', 'asia_seoul', 'asia_tokyo', 'australia_adelaide', 'australia_sydney', 'australia_lord_howe', 'pacific_noumea', 'pacific_auckland', 'pacific_chatham', 'pacific_apia', 'pacific_kiritimati');

DROP INDEX IF EXISTS "app_setting_timezone_idx";
ALTER TABLE "app_setting" ALTER COLUMN "timezone" DROP DEFAULT;
ALTER TABLE "app_setting" ALTER COLUMN "timezone" TYPE "Timezone" USING ("timezone"::"Timezone");
ALTER TABLE "app_setting" ALTER COLUMN "timezone" SET DEFAULT 'utc';
CREATE INDEX "app_setting_timezone_idx" ON "app_setting"("timezone");

COMMIT;
