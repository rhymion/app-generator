# Database Testing Setup - Quick Reference

## TL;DR

```bash
# 1. Start test database (Docker Compose - easiest!)
npm run docker:test:up

# 2. Setup test database
npm run db:reset:test

# 3. Run e2e tests (automatically starts dev server)
npm run cy:test
```

**Manual approach** (if you want to keep dev server running):
```bash
# Terminal 1: Start dev server with test database
npm run dev:test

# Terminal 2: Run tests
npm run cy:run
```

**Note**: `npm run dev` uses your production database (Vercel), `npm run dev:test` uses the test database.

Alternative (plain Docker):
```bash
docker run --name postgres-test -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=my_next_test -p 5432:5432 -d postgres:16
```

## Common Commands

```bash
# Start/stop test database (Docker Compose)
npm run docker:test:up
npm run docker:test:down

# Development with PostgreSQL (production/Vercel)
npm run dev

# Development with test database
npm run dev:test

# Switch to SQLite for quick experimentation  
npm run db:use:sqlite
npm run dev

# Switch back to PostgreSQL
npm run db:use:postgres

# Reset test database
npm run db:reset:test

# View database in Prisma Studio
npm run db:studio
```

## Database URLs

| Environment | Database | URL Variable |
|-------------|----------|--------------|
| Development | PostgreSQL (Vercel) | `DATABASE_URL` in `.env` |
| E2E Testing | PostgreSQL (Local) | `DATABASE_URL` in `.env.test` |
| Production | PostgreSQL (Vercel) | `DATABASE_URL` + `PRISMA_DATABASE_URL` |
| Local Experimentation | SQLite | `DATABASE_URL="file:./dev.db"` |

**Note**: Always use `DATABASE_URL` - it's used by both schema.prisma and prisma.config.ts

## Workflow

### Daily Development
1. Use PostgreSQL from Vercel (already configured)
2. Run `npm run dev`
3. Make changes
4. Run unit tests: `npm test`

### Testing Database Changes
1. Switch to SQLite: `npm run db:use:sqlite`
2. Experiment with schema changes
3. Test with `npm run dev`
4. When satisfied, switch back: `npm run db:use:postgres`
5. Apply migrations properly: `npm run db:migrate`

### E2E Testing
1. Ensure test database is running: `npm run docker:test:up`
2. Reset test DB: `npm run db:reset:test`
3. Run tests: `npm run cy:test` (auto-starts dev server with test DB)

Or manually:
1. Terminal 1: `npm run dev:test` (uses test DB)
2. Terminal 2: `npm run cy:run`

## Files to Update

When you need to fill in your actual credentials:

1. **`.env`** (git-ignored, create from `.env.example`)
   ```
   DATABASE_URL="your-vercel-postgres-url"
   PRISMA_DATABASE_URL="your-prisma-accelerate-url"
   ```

2. **`.env.test`** (committed to git)
   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/my_next_test"
   ```

## Troubleshooting

**"Connection refused" during tests?**
→ Start PostgreSQL: `npm run docker:test:up` or `docker start postgres-test`

**Schema out of sync?**
→ Run: `npm run db:reset:test`

**Want to see test data?**
→ Change `.env` to point to test DB temporarily, run `npm run db:studio`

**Made schema changes in SQLite mode?**
→ Switch back to PostgreSQL and run proper migration: `npm run db:use:postgres && npm run db:migrate`
