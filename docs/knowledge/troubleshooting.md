# Troubleshooting

This document catalogs known failure patterns, their root causes, and step-by-step fixes. Each entry includes the file and line where the issue originates.

---

## 1. Build errors

### 1.1 "Type X is not assignable to type Y" — Prisma/schema mismatch

**Symptom**: `next build` (or `npx tsc --noEmit`) fails with something like:

```
Type 'string' is not assignable to type 'never'.
  at lib/my_entity/getters.ts:42
```

or

```
Property 'my_relation' does not exist on type 'MyEntity'.
  at components/MyEntity/FormUpsert.tsx:18
```

**Root cause**: The generated TypeScript is derived from both `code_generator/json_schema.yaml` and `prisma/schema.prisma`. A mismatch between the two (e.g., a relation field exists in the JSON schema but is named differently in Prisma) causes the Prisma-generated type (`app/generated/prisma/`) to disagree with what the generated TypeScript expects.

**Step-by-step fix**:

1. Identify which entity is failing from the file path (`lib/{entity}/` or `components/{entity}/`).
2. Open `code_generator/json_schema.yaml` and find the entity's detail definition.
3. Open `prisma/schema.prisma` and find the matching `model`.
4. Compare relation field names:
   - JSON schema `x-relationships` key → must exactly match the Prisma field name.
   - For auto-derived one-to-many children (not declared in JSON schema): the Prisma field must be `{child_model_name}s` (e.g., `ai_agent_versions` for model `ai_agent_version`). See `docs/knowledge/prisma-schema-conventions.md:115`.
5. Run `npm run db:generate` to regenerate the Prisma client.
6. Run `npm run generate-code` to regenerate TypeScript from the updated schema.
7. Re-run `npx tsc --noEmit` to confirm.

**Specific known patterns**:

- **Relation name mismatch**: Using a shortened Prisma field name (`versions`) when the JSON schema derives it as `ai_agent_versions`. Fix: rename the Prisma field to match the derived name (`docs/knowledge/prisma-schema-conventions.md:115`).
- **Embedded model with `creator_id`/`updater_id`**: Adding `creator_id` and `creator` to an embedded child model (no `x-generate`) causes a build error because the generated service never writes those columns. Fix: remove `creator_id`, `creator`, `updater_id`, `updater` from the embedded model (`docs/knowledge/prisma-schema-conventions.md:166`).
- **Comment child without `message` field**: An entity used with `x-outputType: comments` must have a `message: string` field. Missing it causes a TypeScript error in the generated actions. See `validate.py:264` for the validation error message.

### 1.2 "Module not found" or "Cannot find module"

**Symptom**: Build fails with:

```
Module not found: Can't resolve '@/lib/my_entity/types'
```

**Root cause**: The file referenced by the import was not generated, or was generated to the wrong path.

**Diagnosis**:

```bash
# Check if the file exists
ls lib/my_entity/

# Re-run generation
npm run generate-code

# Check generate output for "Skipped (exists)" on write-once stubs
```

`generate.py` uses `_write_stub()` for `service_after_create.ts` — it skips writing if the file already exists. All other files are always overwritten (`_write()`). If a stub from an older schema version is present but the entity was renamed, the stale stub stays on disk. Delete it manually.

**Module path rules**: All generated imports use `@/lib/{entity}/...` (alias configured in `tsconfig.json`). A hand-written file in the wrong directory (e.g., `lib/myEntity/` instead of `lib/my_entity/`) will cause "Module not found".

### 1.3 `generate-code` build failure after schema change

**Symptom**: `npm run generate-code` exits with an error, or subsequent `next build` fails after generation.

**Pattern 1 — Missing `@@index`**:

```
SchemaValidationError: Prisma index validation failed — 1 model(s) missing required indexes:

  • model 'my_model': missing required @@index([organization_id]).  ...
    Run `python3 scripts/add_required_indexes.py` to add it, ...
```

`validate.py:78` enforces that `creator_id`, `assignee_id`, and `organization_id` are indexed. Fix:

```bash
python3 scripts/add_required_indexes.py
# or add manually to prisma/schema.prisma:
#   @@index([organization_id])
npm run migrate:dev
```

**Pattern 2 — Entity name not snake_case**:

```
SchemaValidationError: Schema validation failed — 1 error(s):

  • Definition 'MyEntity': name must be lowercase snake_case ...
```

`validate.py:124`. Fix: rename the definition key to `my_entity`.

**Pattern 3 — FK field missing `_id` suffix**:

```
SchemaValidationError: Schema validation failed — 1 error(s):

  • Definition 'booking', property 'resource': FK fields that carry x-relationship must end in '_id' ...
```

`validate.py:150`. Fix: rename the property to `resource_id` in the JSON schema.

**Pattern 4 — Relationship target undefined**:

```
  • Definition 'booking', property 'resource_id': x-relationship target 'resource' is not defined in the schema.
```

`validate.py:161`. The target entity is missing from `json_schema.yaml`. Add the missing definition or correct the `target` field.

**Pattern 5 — chart references nonexistent field**:

```
  • Entity 'shift': x-display.chart references start_field 'start_time' but that field does not exist ...
```

`validate.py:248`. Add the field to the entity's `properties` or update `x-display.chart.start_field`.

---

## 2. Test failures

### 2.1 Cypress hydration timeout — DataGrid SSR re-render

**Symptom** (`cypress/e2e/{entity}.cy.ts` tests 1.2, 1.3):

```
AssertionError: Timed out retrying after 4000ms:
  Expected 'eq' 1, but got 0
```

Row count assertion fires before the MUI DataGrid finishes hydrating.

**Root cause**: `DataGridClient` (`components/DataGridClient.tsx`) is `'use client'` but is still SSR'd by Next.js App Router. The `Paper sx={{ height: 500 }}` container means the DataGrid cannot compute virtual-scroll dimensions server-side, causing a re-render on mount that briefly shows 0 rows.

**Fix**: Assert a named item is visible before checking row count:

```typescript
cy.contains('My Item Name').should('be.visible');  // waits for stable render
getDataGridRowCount().should('eq', 1);
```

See `docs/knowledge/testing-cypress.md` → "MUI DataGrid patterns".

### 2.2 "Timed out retrying" — MUI picker DOM detachment

**Symptom** (any test using `cy.fillDateTime`):

```
AssertionError: Timed out retrying after 4000ms:
Expected to find element: `.MuiPickerPopper-root`, but never found it.
```

**Root cause**: In headless Chromium (`npm run test:e2e`), Cypress synthetic `.click()` does not give the document real focus. MUI DateTimePicker detects blur and closes immediately. The popper never renders.

**Fix**: Type directly into the MUI X input using `cy.fillDateTime`:

```typescript
cy.fillDateTime('Start Time', '01/15/2025 09:00 AM');
```

The command (`cypress/support/commands.ts`) types digit sequences directly into the field's `<input>` — no popup required. Works identically headed and headless.

See `docs/knowledge/testing-cypress.md` → "MUI DateTimePicker patterns".

### 2.3 API test 401/403 — TEST_API_KEY or seed data issues

**Symptom** (`cypress/e2e/api/{entity}.cy.ts` tests 6.1, 6.2, 7.1, 7.2):

```
expected response status to equal 200 but got 401
expected response status to equal 403 but got 401
```

**Diagnosis checklist**:

1. **`TEST_API_KEY` not seeded**: `cypress/support/test-credentials.ts` defines `TEST_CREDENTIALS`. The `db:seed` task (`scripts/seed.ts`) must write `TEST_CREDENTIALS.apiKey` to the test user's `user.api_key`. Run `npm run migrate:reset:test` to re-seed.

2. **`db:createLimitedApiUser(modelName)` task missing**: Test 7.1/7.2 uses `cy.task('db:createLimitedApiUser', 'my_entity')`. This task must be registered in `cypress/support/generated-tasks.ts`. Re-run `npm run generate-code` to regenerate the task registry.

3. **Permission cache stale**: In development builds (`NODE_ENV !== 'production'`), the permission cache is disabled. If tests fail in production builds but pass in dev, check that `db:reset` calls `invalidatePermissionCache()`. The `/api/test-utils/reset-caches` endpoint does this — verify it is called by `cy.task('db:reset')` in `cypress.config.ts`.

4. **AUTH_SECRET empty in CI**: If the `AUTH_SECRET` environment variable is set to an empty string (e.g., an unset GitHub Actions secret), NextAuth will fail to issue the session cookie. Login appears to succeed but the session is never created. Fix: omit `AUTH_SECRET` from the CI env block and let `.env.test` provide it. See `docs/knowledge/testing-cypress.md` → "CI/CD".

### 2.4 A tracked unit test that imports generated code fails only in CI

**Symptom**: A `vitest` unit test under `lib/{entity}/` (or similar) passes locally
and in any gate that includes the `build` step, but fails in the CI
`unit-tests` job specifically, with something like:

```
Error: Failed to resolve import "@/lib/{entity}/{generated_file}" from "lib/{entity}/{subject}.ts".
Does the file exist?
```

**Root cause**: Some handwritten, VCS-tracked source files import generated
files that code_generator/generate.py writes (e.g. an always-emitted helper
like `lib/approval_request/resolve_target.ts`, generated by
`generate.py`'s `resolve_approvable_target.ts.jinja2` template). Vitest can
resolve these imports fine anywhere `generate-code` has already run — which
every *other* gate does implicitly (the `build` gate's `test:e2e:build` runs
`generate-code` as its first step; see
[§ Generated-code prerequisites for gates](../../AGENTS.md#generated-code-prerequisites-for-gates)
in `AGENTS.md`). The CI `unit-tests` job is the one place that runs `npm ci`
→ `db:generate` (Prisma client only) → the unit test command directly,
with no `generate-code` step — so the import is genuinely unresolved there,
even though the source code is correct.

This is easy to miss because most existing tracked unit tests only import
other tracked (non-generated) files, so the gap stays invisible until the
first tracked test that imports a generated file is added (cmd_489,
`lib/approval_request/actions.test.ts` importing `resolve_target.ts`,
2026-07-29).

**Fix**: `.github/workflows/ci.yml`'s `unit-tests` job runs `generate-code`
(with the Python toolchain it requires — `setup-python` + `pip install -r
requirements.txt`) before the Prisma client generation and the unit test
command. `generate-code` itself does not need Docker or a database — only
`build:pdf-font`/schema files on disk — so this stays cheap relative to the
`e2e-tests` job's full `test:e2e:build`.

**Prevention rule**: whenever a new VCS-tracked source or test file is added
under `lib/`, `components/`, or similar, and that file (or its test)
imports something `generate.py` writes, check whether the CI job that runs
its test actually executes `generate-code` first. Don't assume every job
does — verify against `.github/workflows/ci.yml` directly, not against
`AGENTS.md`'s gate matrix (the matrix describes agent-run gates, not what
each individual CI job does under the hood).

---

## 3. Code generation failures

### 3.1 `validate.py` error messages reference

All errors are collected before raising `SchemaValidationError` (`validate.py:279-282`), so you see every problem in one pass:

```
SchemaValidationError: Schema validation failed — N error(s) must be fixed before generation can proceed:

  • <error 1>
  • <error 2>
  ...
```

Full catalog of error messages from `code_generator/validate.py`:

| Error message fragment | Location | Fix |
|---|---|---|
| `name must be lowercase snake_case` | `validate.py:124` | Rename definition key to `snake_case` |
| `FK fields that carry x-relationship must end in '_id'` | `validate.py:150` | Rename property to `xxx_id` |
| `x-relationship target '...' is not defined` | `validate.py:161` | Add target definition or fix target name |
| `labelField '...' is invalid` | `validate.py:178` | Fix `labelField` to resolve through target properties |
| `relationship target '...' has no 'name' field and no labelField` | `validate.py:185` | Add `name` field to target or set `labelField` |
| `many-to-many target '...' has no 'name' field` | `validate.py:220` | Same as above, for `x-relationships` |
| `x-display.chart references start_field '...' but that field does not exist` | `validate.py:248` | Add the field or fix `start_field` |
| `x-display.chart references end_field '...' but that field does not exist` | `validate.py:256` | Add the field or fix `end_field` |
| `child '...' uses x-outputType: comments but has no 'message' field` | `validate.py:270` | Add `message: { type: string, minLength: 1 }` to the child |
| `Prisma index validation failed — ... missing required @@index([creator_id])` | `validate.py:104` | Add `@@index([creator_id])` to the model or run `scripts/add_required_indexes.py` |
| `Prisma schema not found at ...` | `validate.py:83` | Run `generate.py` from the project root, not from `code_generator/` |
| `unbalanced braces starting at offset ...` | `validate.py:49` | Syntax error in `prisma/schema.prisma` |
| `No entities found in schema` | `generate.py:108` | No definition has `x-generate` set |

### 3.2 Discovering undocumented implicit rules

When the generator produces code that builds but behaves incorrectly, the issue is often an implicit rule not validated by `validate.py`. To discover these:

1. **Read the relevant template** directly in `code_generator/templates/`. The Jinja2 templates are the ground truth for what gets generated. Search for the failing behavior:

   ```bash
   grep -n "organization_id\|creator_id\|should_filter" code_generator/templates/getters.ts.jinja2
   ```

2. **Run the generator's own tests**:

   ```bash
   cd code_generator && python -m pytest tests/ -v
   ```

3. **Check `build_context.py` for flag computation**: Most implicit rules live in `code_generator/build_context.py`. The flags it produces (`should_filter_by_org`, `has_assignee_id`, `is_audited`, etc.) determine which template branches fire. Add a `print()` call temporarily to see what flags an entity gets.

4. **Check `check_generated.py` output**:

   ```bash
   cd code_generator && python check_generated.py json_schema.yaml ../
   ```

   This flags direct `prisma.<model>.write` calls and `$queryRaw` usage outside the service layer.

### 3.3 Schema drift detection

"Schema drift" means `code_generator/json_schema.yaml` and `prisma/schema.prisma` are out of sync — a field or relation exists in one but not the other.

**Symptoms**:
- `next build` fails with Prisma type errors (e.g., `Property 'xxx' does not exist`)
- Generated getters reference columns that do not exist in the DB

**Detection**:

```bash
# 1. Check if Prisma client is up to date with schema.prisma
npm run db:generate

# 2. Check if the DB matches schema.prisma
npx prisma migrate status   # shows pending migrations

# 3. Compare JSON schema entities against Prisma models manually
grep "^model " prisma/schema.prisma
grep -E "^  [a-z_]+:" code_generator/json_schema.yaml | head -30

# 4. Run validate.py in isolation (requires the schema path)
cd code_generator && python -c "
from validate import validate_prisma_indexes
validate_prisma_indexes('../prisma/schema.prisma')
print('Indexes OK')
"
```

**Fix**:
- Missing Prisma model: add it (`docs/knowledge/prisma-schema-conventions.md` §4)
- Missing Prisma migration: `npm run migrate:dev`
- JSON schema ahead of Prisma: run `npm run generate-code` after updating Prisma

---

## 4. Database issues

### 4.1 `prisma migrate dev` errors

**"Error: P3006 — Migration failed to apply"**:

```
Error: P3006

The migration `20240101_add_org_id` failed to apply cleanly to the shadow database.
  Error code: 42703 (column "organization_id" of relation "my_model" does not exist)
```

This usually means the migration SQL references a column that does not exist because a previous migration was not applied. Fix:

```bash
# Check which migrations are pending
npx prisma migrate status

# Apply all pending migrations
npm run migrate:dev
```

**"Error: P1001 — Can't reach database server"**:

The PostgreSQL container is not running. Fix:

```bash
# Development database
npm run docker:up:dev   # starts postgres-dev on port 5433 (default; override via POSTGRES_PORT)

# Test database
npm run docker:up:test  # starts postgres-test on port 5432 (default; override via POSTGRES_PORT)

# Verify it's up
docker ps | grep postgres
```

**"Error: P1003 — Database does not exist"**:

The database itself is missing inside the container. This happens after `docker:down` with volume removal. Fix:

```bash
npm run docker:down:dev
npm run docker:up:dev
npm run migrate:dev     # recreates DB schema
npm run db:seed         # seed initial data
```

### 4.2 `docker compose` startup problems

**Symptom**: `npm run docker:up:dev` exits with a port conflict:

```
Error starting userland proxy: listen tcp4 0.0.0.0:5433: bind: address already in use
```

Another Postgres instance (possibly a previous container) is still running on that port:

```bash
# Find the conflicting process
sudo lsof -i :5433

# Stop the conflicting container
docker ps | grep postgres
docker stop <container_id>

# Then retry
npm run docker:up:dev
```

**Verify health after startup**:

```bash
# Check container is healthy
docker ps | grep my-next

# Test connection directly
docker exec -it <container_name> psql -U postgres -c '\l'
```

### 4.3 `db:push` vs `migrate:dev`

Use `npm run db:push` (`prisma db push`) only during early prototyping — it does not create migration files. For any schema change that should be versioned:

```bash
npm run migrate:dev  # creates a migration file and applies it
```

If `db:push` was used and the DB is now ahead of the migration history:

```bash
# Create a migration that captures the current state (without applying)
npm run migrate:dev:create-only
# Then review and apply
npm run migrate:dev
```

### 4.4 Test database reset failures

**Symptom**: `npm run migrate:reset:test` hangs or fails:

```
Error: P3007 — Some migrations cannot be rolled back
```

The test database has unapplied or conflicting migrations. Force-reset:

```bash
npm run docker:down:test
npm run docker:up:test
npm run migrate:reset:test    # drops and recreates the DB, re-applies all migrations
```

If Cypress tests fail because `cy.task('db:reset')` does not fully clear state, confirm that:

1. `cypress.config.ts` imports `getGeneratedTasks()` from `cypress/support/generated-tasks.ts`
2. The task registry is up to date: `npm run generate-code`
3. `db:reset` calls `/api/test-utils/reset-caches` to clear the server-side permission and API-key caches
