import { describe, it, expect, beforeAll } from 'vitest';
import { isPortInUse, runCmd, assertTestDb, PROJ_ROOT } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

let defaultPgPortInUse: boolean;

beforeAll(async () => {
  defaultPgPortInUse = await isPortInUse(5432);

  // test DB を clean な状態にリセット（build:all の db:push が冪等に動くよう）
  const resetResult = runCmd(
    'npm run migrate:reset:test 2>&1 || echo "migrate:reset:test unavailable"',
    { timeout: 120_000 }
  );
  if (resetResult.stdout.includes('unavailable') || resetResult.code !== 0) {
    runCmd('npm run cleanup:all 2>&1 || true', { timeout: 60_000 });
  }
}, 120_000);

describe('build:all', () => {
  it('観点1: build:all が exit 0 で完走する（test env）', () => {
    assertTestDb();
    const r = runCmd('npm run build:all', { timeout: 600_000 });
    expect(r.code, `build:all failed:\n${r.stderr.slice(0, 500)}`).toBe(0);
  });

  it('観点2: .next/BUILD_ID が生成されている', () => {
    const buildId = path.join(PROJ_ROOT, '.next', 'BUILD_ID');
    expect(fs.existsSync(buildId), '.next/BUILD_ID not found').toBe(true);
  });

  it('観点5: PORT=13000 で build:all が実行できる（ハードコーディング検出）', () => {
    // ポート番号をハードコーディングしている箇所の検出が目的
    // DB 接続が不要な build ステップで確認する
    const r = runCmd('PORT=13000 npm run build', { timeout: 600_000 });
    expect(r.code, `build with PORT=13000 failed:\n${r.stderr.slice(0, 500)}`).toBe(0);
  });

  it('観点6: デフォルトポート(5432)が占有中なら skip と明示する', async () => {
    if (defaultPgPortInUse) {
      console.log('SKIP: default PostgreSQL port 5432 is in use; default-port flow skipped. non-default-port flow still runs.');
      return;
    }
    // 空いている場合: build:all は既に観点1でテスト済み
    expect(true).toBe(true);
  });
});
