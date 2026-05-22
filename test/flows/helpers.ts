import { spawnSync } from 'child_process';
import * as net from 'net';
import * as path from 'path';

export const PROJ_ROOT = path.resolve(__dirname, '../..');

/** ポートが使用中か確認 */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(() => resolve(false)); });
    server.listen(port);
  });
}

/** コマンドを実行して {code, stdout, stderr} を返す（throwしない） */
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

/** DATABASE_URL が test 環境を指すことを確認（安全アサーション） */
export function assertTestDb() {
  const r = runCmd('npm run env:check 2>&1 | head -5');
  if (!r.stdout.includes('test') && !r.stderr.includes('test')) {
    // env:check で test 環境が確認できない場合は .env.test を直接確認
    const envCheck = runCmd('grep DATABASE_URL .env.test');
    if (!envCheck.stdout.includes('test') && !envCheck.stdout.includes('5433')) {
      throw new Error('DATABASE_URL が test DB を指していない。中断する。' + envCheck.stdout);
    }
  }
}
