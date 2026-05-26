import { spawnSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

export const PROJ_ROOT = path.resolve(__dirname, '../..');

export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(() => resolve(false)); });
    server.listen(port);
  });
}

export function runCmd(cmd: string, opts: { timeout?: number; cwd?: string } = {}) {
  const result = spawnSync('bash', ['-c', cmd], {
    cwd: opts.cwd ?? PROJ_ROOT,
    timeout: opts.timeout ?? 300_000,
    encoding: 'utf8',
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export async function waitForPort(port: number, timeout = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await isPortInUse(port)) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Port ${port} did not open within ${timeout}ms`);
}

export async function waitForPortFree(port: number, timeout = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!(await isPortInUse(port))) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Port ${port} was not released within ${timeout}ms`);
}

export async function startServer(
  npmScript: string,
  port: number,
  opts: { timeout?: number; cwd?: string; env?: Record<string, string> } = {}
): Promise<ChildProcess> {
  const cwd = opts.cwd ?? PROJ_ROOT;
  if (await isPortInUse(port)) {
    throw new Error(`Port ${port} is already in use`);
  }
  // Clear Next.js build state to prevent "Another dev server is already running" error
  spawnSync('bash', ['-c', 'rm -rf .next'], { cwd, stdio: 'ignore' });
  const proc = spawn('bash', ['-c', `npm run ${npmScript}`], {
    cwd,
    detached: true,
    stdio: 'pipe',
    env: { ...process.env, ...opts.env },
  });
  await waitForPort(port, opts.timeout ?? 120_000);
  return proc;
}

export function stopServer(proc: ChildProcess): void {
  if (proc.pid) {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      proc.kill('SIGTERM');
    }
  }
}

export async function signUp(port: number, data: Record<string, string>): Promise<Response> {
  return fetch(`http://localhost:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function signIn(port: number, data: Record<string, string>): Promise<Response> {
  const csrfRes = await fetch(`http://localhost:${port}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json() as { csrfToken: string };
  const csrfCookie = csrfRes.headers.get('set-cookie') ?? '';
  const body = new URLSearchParams({ ...data, csrfToken });
  return fetch(`http://localhost:${port}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': csrfCookie,
    },
    body: body.toString(),
    redirect: 'manual',
  });
}

export function scriptExists(scriptName: string): boolean {
  const pkgPath = path.join(PROJ_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return scriptName in (pkg.scripts ?? {});
}
