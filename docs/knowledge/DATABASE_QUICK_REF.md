# Database Testing Setup - Quick Reference

> **Ports**: the numbers below are docker-compose defaults —
> `${POSTGRES_PORT:-5433}` for dev, `${POSTGRES_PORT:-5432}` /
> `${REDIS_PORT:-6379}` for test. Set the corresponding env var before
> running the `docker:up:*` scripts if you need a different host port.

## TL;DR

```bash
# Development
npm run docker:up:dev    # Start postgres-dev (port 5433, DB=my_next_dev)
npm run setup            # generate-code → db:push → seed
npm run dev              # Start Next.js dev server (port 3001)
npm run docker:down:dev  # Stop when done
```

```bash
# E2E tests
npm run docker:up:test   # Start postgres-test (port 5432) + redis-test (port 6379)
npm run migrate:reset:test
npm run test:e2e
npm run docker:down:test
```

**Manual E2E approach** (if you want to keep dev server running):
```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run tests (NODE_ENV=test is set automatically)
npm run test:e2e:dev
```

## Common Commands

```bash
# Start/stop dev database (Docker Compose)
npm run docker:up:dev    # postgres-dev (port 5433, DB=my_next_dev)
npm run docker:down:dev

# Start/stop test containers (Docker Compose)
npm run docker:up:test   # postgres-test (port 5432) + redis-test (port 6379)
npm run docker:down:test

# Development
npm run dev              # dev server (Next.js native env loading)

# Reset test database (E2E commands use NODE_ENV=test automatically)
npm run migrate:reset:test

# View database in Prisma Studio
npm run db:studio        # uses .env.local or .env.development natively
```

## Database URLs

| Environment | Database | URL Variable |
|-------------|----------|--------------|
| Development | PostgreSQL (Local Docker, port 5433) | `DATABASE_URL` in `.env.development` |
| E2E Testing | PostgreSQL (Local Docker, port 5432) | `DATABASE_URL` in `.env.test` |
| Production | PostgreSQL (Vercel) | `DATABASE_URL` + `PRISMA_DATABASE_URL` |
| Local Experimentation | SQLite | `DATABASE_URL="file:./dev.db"` |

**Note**: Always use `DATABASE_URL` - it's used by both schema.prisma and prisma.config.ts

## Workflow

### Daily Development
1. Start dev database: `npm run docker:up:dev` (postgres-dev, port 5433)
2. Run `npm run dev` (Next.js loads env files automatically)
3. Make changes
4. Run unit tests: `npm test`
5. Stop database when done: `npm run docker:down:dev`

### Testing Database Changes
1. Experiment with schema changes: `npm run db:push`
2. Test with `npm run dev`
3. Apply migrations properly: `npm run migrate:dev`

### E2E Testing
1. Ensure test containers are running: `npm run docker:up:test` (postgres-test + redis-test)
2. Reset test DB: `npm run migrate:reset:test` (E2E commands use NODE_ENV=test automatically)
3. Run tests: `npm run test:e2e` (auto-starts server with test env)
4. Stop containers: `npm run docker:down:test`

Or manually (hot-reload):
1. Terminal 1: `npm run dev`
2. Terminal 2: `npm run test:e2e:dev` (NODE_ENV=test set automatically)

## Files to Update

When you need to fill in your actual credentials:

1. **`.env.local`** (git-ignored, local secrets)
   ```
   PRISMA_DATABASE_URL="your-prisma-accelerate-url"
   ```

2. **`.env.test`** (committed to git)
   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/my_next_test"
   ```

## Troubleshooting

**"Connection refused" during tests?**
→ Start test containers: `npm run docker:up:test` or `docker start postgres-test`

**Schema out of sync?**
→ Run: `npm run migrate:reset:test`

**Want to see test data?**
→ Run: `cross-env NODE_ENV=test npx prisma studio`

**Made schema changes locally?**
→ Apply migrations properly: `npm run migrate:dev`
