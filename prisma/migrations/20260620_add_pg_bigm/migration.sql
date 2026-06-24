-- pg_bigm extension for Japanese 2-gram search
CREATE EXTENSION IF NOT EXISTS pg_bigm;

-- role entity (text_fields: name, description)
CREATE INDEX IF NOT EXISTS idx_role_name_bigm
  ON "role" USING GIN (name gin_bigm_ops);
CREATE INDEX IF NOT EXISTS idx_role_description_bigm
  ON "role" USING GIN (description gin_bigm_ops)
  WHERE description IS NOT NULL;

-- organization entity (text_fields: name, description)
CREATE INDEX IF NOT EXISTS idx_organization_name_bigm
  ON "organization" USING GIN (name gin_bigm_ops);
CREATE INDEX IF NOT EXISTS idx_organization_description_bigm
  ON "organization" USING GIN (description gin_bigm_ops)
  WHERE description IS NOT NULL;
