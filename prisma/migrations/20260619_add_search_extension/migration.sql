-- pg_trgm extension for trigram-based fuzzy/partial-match search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on organization.name for fast trigram similarity queries
CREATE INDEX IF NOT EXISTS idx_organization_name_trgm
  ON "organization" USING GIN (name gin_trgm_ops);

-- GIN index on organization.description (nullable) for trigram similarity
CREATE INDEX IF NOT EXISTS idx_organization_description_trgm
  ON "organization" USING GIN (description gin_trgm_ops);
