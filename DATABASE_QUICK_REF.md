# Database Testing Setup - Quick Reference

## TL;DR

```bash
# 1. Start test database (Docker Compose - easiest!)
npm run docker:up:test

# 2. Setup test database
npm run db:reset

# 3. Run e2e tests (automatically starts dev server)
npm run cy:test
```

**Manual approach** (if you want to keep dev server running):
```bash
# Switch to test environment first
npm run env:use -- test

# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run tests
npm run cy:run
```

**Note**: Use `npm run dev:test` to run the dev server against the test database, or `npm run env:use -- test` to symlink `.env` → `.env.test` for tools that read `.env` directly. `npm run dev` uses `.env.local` natively (no setup needed).

Alternative (plain Docker):
```bash
docker run --name postgres-test -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=my_next_test -p 5432:5432 -d postgres:16
```

## Common Commands

```bash
# Start/stop test database (Docker Compose)
npm run docker:up:test
npm run docker:down:test

# Switch environment
npm run env:use -- test  # Switch to test environment (.env.test symlink)
npm run env:use -- off   # Reset to native .env.local loading
npm run env:current      # Show current environment

# Development
npm run dev              # dev server (uses .env.local natively)
npm run dev:test         # dev server with test database (.env.test)

# Switch to SQLite for quick experimentation  
npm run db:use:sqlite
npm run dev

# Switch back to PostgreSQL
npm run db:use:postgres

# Reset test database
npm run db:reset

# View database in Prisma Studio
npm run db:studio        # uses .env.local natively
npm run db:studio:test   # uses test database (.env.test)
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
1. Use PostgreSQL from Vercel (already configured in `.env.local`)
2. Run `npm run dev` (Next.js loads `.env.local` automatically)
3. Make changes
4. Run unit tests: `npm test`

### Testing Database Changes
1. Switch to SQLite: `npm run db:use:sqlite`
2. Experiment with schema changes
3. Test with `npm run dev`
4. When satisfied, switch back: `npm run db:use:postgres`
5. Apply migrations properly: `npm run migrate:dev`

### E2E Testing
1. Ensure test database is running: `npm run docker:up:test`
2. Reset test DB: `npm run db:reset`
3. Run tests: `npm run cy:test` (auto-starts dev server with test DB)

Or manually:
1. Terminal 1: `npm run dev:test` (starts dev server against test DB)
2. Terminal 2: `npm run cy:run`

## Files to Update

When you need to fill in your actual credentials:

1. **`.env`** (git-ignored, managed via `env:use` command)
   - Set by `npm run env:use -- test` (links to `.env.test`); use `npm run env:use -- off` to return to native `.env.local`

2. **`.env.local`** (git-ignored, cloud/Vercel credentials)
   ```
   DATABASE_URL="your-vercel-postgres-url"
   PRISMA_DATABASE_URL="your-prisma-accelerate-url"
   ```

3. **`.env.test`** (committed to git)
   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/my_next_test"
   ```

## Troubleshooting

**"Connection refused" during tests?**
→ Start PostgreSQL: `npm run docker:up:test` or `docker start postgres-test`

**Schema out of sync?**
→ Run: `npm run db:reset`

**Want to see test data?**
→ Run `npm run db:studio:test`

**Made schema changes in SQLite mode?**
→ Switch back to PostgreSQL and run proper migration: `npm run db:use:postgres && npm run migrate:dev`
