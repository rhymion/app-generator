-- user.api_key (plaintext) -> user.api_key_hash (SHA-256) template.
--
-- A consumer adds these statements to one of its own Prisma migrations (a
-- hand-edited migration.sql) at deployment time; the generator ships no
-- migrations. See docs/knowledge/api-key-hashing.md.
--
-- Existing keys keep working: each stored key is replaced, in place, by the
-- lowercase-hex SHA-256 of its UTF-8 bytes, which is exactly what
-- hashApiKey() in lib/api-key.ts computes for the key a client presents. No
-- key is rotated. After the migration no plaintext key remains: the column is
-- dropped in the same transaction.
--
-- sha256() is built into PostgreSQL 11 and later; no extension is needed.
-- Run it once, as the table owner. It is not idempotent on purpose: a second
-- run would fail at the first statement because api_key no longer exists.

BEGIN;

ALTER TABLE "user"
  ADD COLUMN "api_key_hash" TEXT,
  ADD COLUMN "api_key_issued_at" TIMESTAMP(3);

-- An empty string is "no key", as it is to the old lookup. The issue time of a
-- key issued before this change is unknown and stays NULL.
UPDATE "user"
SET "api_key_hash" = encode(sha256(convert_to("api_key", 'UTF8')), 'hex')
WHERE "api_key" IS NOT NULL AND "api_key" <> '';

DROP INDEX IF EXISTS "user_api_key_idx";
ALTER TABLE "user" DROP COLUMN "api_key";
CREATE INDEX "user_api_key_hash_idx" ON "user"("api_key_hash");

COMMIT;
