import { describe, it, expect, afterAll } from 'vitest';
import { ChildProcess } from 'child_process';
import * as net from 'net';
import { startServer, stopServer, signUp, signIn, waitForPortFree } from './helpers';

const PORT = 3001;

/* describe('dev:full → auth flow', { timeout: 1_200_000 }, () => {
  let server: ChildProcess | null = null;

  afterAll(() => {
    if (server) stopServer(server);
  });

  it('scenario 1: sign up via POST /api/auth/register returns 201', async () => {
    server = await startServer('dev:full', PORT, { timeout: 600_000, env: { NODE_ENV: 'development' } });
    const uniqueEmail = `test+${Date.now()}@example.com`;
    const res = await signUp(PORT, {
      email: uniqueEmail,
      password: 'TestPassword123!',
      name: 'Test User',
    });
    expect(res.status).toBe(201);
  });

  it('scenario 2: sign in via NextAuth callback returns 302', async () => {
    if (!server) {
      server = await startServer('dev:full', PORT, { timeout: 600_000, env: { NODE_ENV: 'development' } });
    }
    // seeded user from scripts/seed-tenant.ts
    const res = await signIn(PORT, {
      email: 'admin@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(302);
  });
});
 */
describe('port conflict handling', { timeout: 120_000 }, () => {
  it('scenario 11: dev:full times out when port 3001 is already occupied', async () => {
    // Wait for any previous dev server to release the port
    await waitForPortFree(PORT, 60_000);

    // Occupy port 3001 with a temporary TCP server
    const blocker = net.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(PORT, '127.0.0.1', resolve);
    });

    try {
      // startServer should reject because waitForPort times out (port never becomes
      // available from the new server's perspective — the blocker holds it)
      await expect(
        startServer('dev:full', PORT, { timeout: 15_000, env: { NODE_ENV: 'development' } })
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
