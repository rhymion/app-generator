# Database Management for Testing

This project uses a multi-database strategy for different environments:

- **Development**: PostgreSQL via Docker (`docker-compose.dev.yml`, port 5433, DB `my_next_dev`)
- **E2E Testing**: Separate PostgreSQL + Redis via Docker (`docker-compose.test.yml`)
- **Unit Testing (optional)**: SQLite for speed
- **Production**: PostgreSQL (Vercel)

## Dev vs Test Container Overview

| | Development | Test |
|---|---|---|
| Compose file | `docker-compose.dev.yml` | `docker-compose.test.yml` |
| DB name | `my_next_dev` | `my_next_test` |
| Postgres port | 5433 | 5434 |
| Redis | None (in-memory rate limiter) | `redis-test` (port 6381) |
| Start | `npm run docker:up:dev` | `npm run docker:up:test` |
| Stop | `npm run docker:down:dev` | `npm run docker:down:test` |

Dev omits Redis — `REDIS_URL` is unset in `.env.development`, so `getRateLimiter()` falls back to the in-memory rate limiter automatically.

## Quick Start

### 1. Setup Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your actual database URLs:
- `DATABASE_URL`: Your Vercel PostgreSQL connection string
- `PRISMA_DATABASE_URL`: Your Prisma Accelerate URL (if using)

### 2. Setup Test Database (PostgreSQL)

For e2e tests, you need a separate PostgreSQL database:

**Option A: Using Docker (Recommended)**

```bash
# Start test containers in Docker (postgres-test + redis-test)
npm run docker:up:test

# Reset and migrate test database
npm run migrate:reset:test
```

**Option B: Using Local PostgreSQL**

```bash
# Create test database
createdb my_next_test

# Reset and migrate test database
npm run migrate:reset:test
```

### 3. Running Tests

**E2E Tests (Cypress with PostgreSQL)**

```bash
# Full E2E (build + start + cypress, NODE_ENV=test set automatically)
npm run test:e2e

# Or hot-reload mode (no build required)
npm run test:e2e:dev
```

**Unit Tests (Vitest)**

```bash
npm test
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run docker:up:dev` | Start dev Postgres container (`postgres-dev`, port 5433) |
| `npm run docker:down:dev` | Stop dev Postgres container |
| `npm run docker:up:test` | Start test containers (`postgres-test` + `redis-test`) |
| `npm run docker:down:test` | Stop test containers |
| `npm run migrate:dev` | Run Prisma migrations (dev) |
| `npm run migrate:reset:test` | Reset test database migrations (NODE_ENV=test) |
| `npm run db:studio` | Open Prisma Studio (uses `.env.local` natively) |
| `cross-env NODE_ENV=test npx prisma studio` | Open Prisma Studio with test database |
| `npm run test:e2e` | Full E2E tests (build + start + cypress, NODE_ENV=test) |
| `npm run test:e2e:dev` | E2E tests in hot-reload mode (NODE_ENV=test) |

## E2E Test Database Management

### In Cypress Tests

```typescript
import { TEST_CREDENTIALS } from '../support/test-credentials';

describe('My Feature', () => {
  beforeEach(() => {
    // Cypress tasks for DB management are registered in cypress.config.ts.
    // See existing tests under cypress/e2e/ for usage examples.
  });

  it('should login with test user', () => {
    cy.visit('/login');
    cy.get('input[name="email"]').type(TEST_CREDENTIALS.email);
    cy.get('input[name="password"]').type(TEST_CREDENTIALS.password);
    cy.get('button[type="submit"]').click();
    // Test user is now logged in
  });
});
```

### Test Credentials

All test environments use the same credentials (defined in `cypress/support/test-credentials.ts`):

- **Email**: `test@example.com`
- **Password**: `password123` (plain text)
- **Hashed**: Generated with bcrypt, salt rounds = 10

The password hash is **consistent across all environments** because:
- Same bcrypt version
- Same salt rounds (10)
- Same password input

This means you can use `TEST_CREDENTIALS` in your tests without worrying about environment-specific hashes.

### Manual Database Reset

```bash
# Reset test database to clean state (runs migrations with NODE_ENV=test)
npm run migrate:reset:test
```

## Best Practices

### ✅ DO:
- Use separate test database for e2e tests
- Reset database state before each e2e test
- Use PostgreSQL for e2e tests (matches production)
- Use SQLite for quick local experimentation
- Keep test data minimal and focused

### ❌ DON'T:
- Use production database for testing
- Use development database for e2e tests
- Rely on database state between tests
- Use SQLite for e2e tests (different behavior from production)

## Troubleshooting

### PostgreSQL Connection Issues

```bash
# Check if PostgreSQL is running
docker ps | grep postgres-test

# Check logs
docker logs postgres-test

# Restart container
docker restart postgres-test
```

### Schema Out of Sync

```bash
# Regenerate Prisma client
npx prisma generate

# Reset and migrate (test environment)
npm run migrate:reset:test
```

### Port Conflicts

If port 5432 is already in use:

```bash
# Use different port in docker
docker run --name postgres-test \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=my_next_test \
  -p 5433:5432 \
  -d postgres:16

# Update .env.test
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/my_next_test"
```

## Environment Files

- `.env` - Common baseline (committed)
- `.env.development` - Local development (committed, non-secrets)
- `.env.test` - Test environment (committed)
- `.env.local` - Local secrets (git-ignored, created manually if needed)
- `.env.example` - Template (committed)

## Architecture Notes

### Prisma 7 Configuration

This project uses **Prisma 7**, which has important changes from Prisma 6:

**Database URL Configuration**:
- ❌ No longer in `schema.prisma` (`url = env("DATABASE_URL")`)
- ✅ Now in `prisma.config.ts` (`datasource.url`)
- ✅ Environment variables loaded via `@next/env` in `prisma.config.ts` (matches Next.js NODE_ENV-based loading)

**PrismaClient Configuration**:
- Must provide `accelerateUrl` to constructor (required by `@prisma/extension-accelerate`)
- The extension handles both direct connections and Accelerate connections
- Use `DATABASE_URL` for direct connections
- Use `PRISMA_DATABASE_URL` for Accelerate connections

### How Prisma Accelerate Works

With `@prisma/extension-accelerate` installed, the PrismaClient requires an `accelerateUrl`:

**Development/Production** (lib/prisma.ts):
- Uses `accelerateUrl: process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ''`
- Falls back to direct connection if `PRISMA_DATABASE_URL` is not set
- Accelerate extension detects URL format and uses caching only for `prisma+postgres://` URLs

**Testing** (cypress/support/db-helpers.ts, scripts/seed-test-db.ts):
- Uses `new PrismaClient()` without Accelerate extension
- Direct connection to local test database via `DATABASE_URL` from `.env.test`
- No `accelerateUrl` parameter needed
- Faster and simpler for local testing

**Why no Accelerate in tests?**
- Test database is local (localhost), no need for connection pooling
- Direct connections are faster for local databases
- Accelerate URLs (`prisma+postgres://...`) are for remote production databases

### Why Separate Test Database?

1. **Isolation**: Tests don't affect development data
2. **Reproducibility**: Clean state for each test run
3. **Performance**: Can reset/truncate without worry
4. **Parallelization**: Can run tests in parallel

### Why PostgreSQL for E2E?

1. **Production Parity**: Same database as production
2. **Feature Compatibility**: All PostgreSQL features work
3. **Constraint Validation**: Proper foreign keys, types, etc.
4. **Realistic Testing**: Catches DB-specific issues

### When to Use SQLite?

1. **Quick Prototyping**: Testing schema changes
2. **Local Experiments**: No need for PostgreSQL setup
3. **Unit Tests**: Fast in-memory testing (optional)
4. **CI/CD**: Faster test runs for unit tests

**Note**: Always verify changes work with PostgreSQL before deploying!
