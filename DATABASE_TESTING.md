# Database Management for Testing

This project uses a multi-database strategy for different environments:

- **Development**: PostgreSQL (Vercel)
- **E2E Testing**: Separate PostgreSQL database
- **Unit Testing (optional)**: SQLite for speed
- **Production**: PostgreSQL (Vercel)

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
# Start PostgreSQL in Docker
docker run --name postgres-test \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=my_next_test \
  -p 5432:5432 \
  -d postgres:16

# Run migrations and seed
npm run db:reset:test
npm run db:seed:test
```

**Option B: Using Local PostgreSQL**

```bash
# Create test database
createdb my_next_test

# Run migrations and seed
npm run db:reset:test
npm run db:seed:test
```

### 3. Running Tests

**E2E Tests (Cypress with PostgreSQL)**

```bash
# Start dev server
npm run dev

# In another terminal, run Cypress
npm run cy:open
# or headless
npm run cy:run
```

**Unit Tests (Vitest)**

```bash
npm test
```

## Database Switching

### Switch to SQLite (for local experimentation)

```bash
npm run db:use:sqlite
```

This will:
- Switch schema to SQLite
- Create a local `dev.db` file
- Generate Prisma client for SQLite

### Switch back to PostgreSQL

```bash
npm run db:use:postgres
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:reset:test` | Reset test database |
| `npm run db:seed:test` | Seed test database |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:use:sqlite` | Switch to SQLite |
| `npm run db:use:postgres` | Switch to PostgreSQL |

## E2E Test Database Management

### In Cypress Tests

```typescript
import { TEST_CREDENTIALS } from '../support/test-credentials';

describe('My Feature', () => {
  beforeEach(() => {
    // Reset database to clean state
    cy.task('db:reset');
    // Seed with test data (creates test user with known credentials)
    cy.task('db:seed');
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
# Reset test database to clean state
npm run db:reset:test

# Seed with test data
npm run db:seed:test
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

# Reset and migrate
npm run db:reset:test
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

- `.env` - Local development (git-ignored)
- `.env.test` - Test environment (committed)
- `.env.example` - Template (committed)

## Architecture Notes

### Prisma 7 Configuration

This project uses **Prisma 7**, which has important changes from Prisma 6:

**Database URL Configuration**:
- ❌ No longer in `schema.prisma` (`url = env("DATABASE_URL")`)
- ✅ Now in `prisma.config.ts` (`datasource.url`)
- ✅ Environment variables loaded via `dotenv/config`

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
