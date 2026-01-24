# Database Testing Setup - Quick Reference

## TL;DR

```bash
# 1. Start test database (Docker Compose - easiest!)
npm run docker:test:up

# 2. Setup test database
npm run db:reset:test

# 3. Run e2e tests
npm run cy:run
```

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

# Development with PostgreSQL (default)
npm run dev

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
| Local Experimentation | SQLite | `file:./dev.db` |

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
1. Ensure test database is running (Docker or local PostgreSQL)
2. Reset test DB: `npm run db:reset:test`
3. Run tests: `npm run cy:run`

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
