# Database Testing Setup - Quick Reference

## TL;DR

```bash
# 1. Start test database (Docker Compose - easiest!)
npm run docker:up:test

# 2. Switch to test environment and set up database
npm run env:use -- test
npm run migrate:reset:test:force

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

**Note**: Use `npm run env:use -- test` to switch to the test environment (links both `.env` and `.env.local` → `.env.test`), then run `npm run dev`. Without `env:use`, `npm run dev` uses `.env.local` natively (no setup needed).

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
npm run env:use -- test  # Switch to test environment (links .env and .env.local → .env.test)
npm run env:use -- off   # Reset to native .env.local loading
npm run env:current      # Show current environment

# Development
npm run dev              # dev server (uses .env.local natively, or .env.test after env:use -- test)

# Reset test database (requires env:use -- test first)
npm run migrate:reset:test:force

# View database in Prisma Studio
npm run db:studio        # uses .env.local natively (or .env.test after env:use -- test)
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
1. Switch to test environment: `npm run env:use -- test`
2. Experiment with schema changes: `npm run db:push`
3. Test with `npm run dev`
4. Apply migrations properly: `npm run migrate:dev`

### E2E Testing
1. Ensure test database is running: `npm run docker:up:test`
2. Reset test DB: `npm run migrate:reset:test:force` (requires `env:use -- test`)
3. Run tests: `npm run cy:test` (auto-starts dev server with test DB)

Or manually:
1. Run `npm run env:use -- test` (switches both `.env` and `.env.local` to `.env.test`)
2. Terminal 1: `npm run dev` (now uses test DB via dual-link)
3. Terminal 2: `npm run cy:run`

## Files to Update

When you need to fill in your actual credentials:

1. **`.env`** and **`.env.local`** (git-ignored, managed via `env:use` command)
   - Set by `npm run env:use -- test` (links both to `.env.test`); use `npm run env:use -- off` to restore native behavior

2. **`.env.cloud.local`** (git-ignored, cloud/Vercel credentials — actual credential file)
   ```
   DATABASE_URL="your-vercel-postgres-url"
   PRISMA_DATABASE_URL="your-prisma-accelerate-url"
   ```
   Note: `.env.local` is an active symlink managed by `env:use`; credential content lives in `.env.cloud.local`.

3. **`.env.test`** (committed to git)
   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/my_next_test"
   ```

## Troubleshooting

**"Connection refused" during tests?**
→ Start PostgreSQL: `npm run docker:up:test` or `docker start postgres-test`

**Schema out of sync?**
→ Run: `npm run env:use -- test && npm run migrate:reset:test:force`

**Want to see test data?**
→ Run `npm run env:use -- test` then `npm run db:studio`

**Made schema changes locally?**
→ Switch to development environment and run proper migration: `npm run migrate:dev`
