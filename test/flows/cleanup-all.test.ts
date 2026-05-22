import { describe, it, expect } from 'vitest';
import { runCmd, assertTestDb } from './helpers';

describe('cleanup:all', () => {
  it('観点3: 実行前に test DB を確認', () => {
    assertTestDb();
  });

  it('観点1: cleanup:all が exit 0 で完走する', () => {
    const r = runCmd('npm run cleanup:all', { timeout: 120_000 });
    expect(r.code, `cleanup:all failed:\n${r.stderr.slice(0, 500)}`).toBe(0);
  });

  it('観点4: 旧コマンド名(demo:*)が package.json に残っていない', () => {
    const r = runCmd("node -e \"const p=require('./package.json'); const old=['demo:start','demo:generate','demo:cleanup']; const found=old.filter(n=>n in p.scripts); process.stdout.write(JSON.stringify(found))\"");
    const found = JSON.parse(r.stdout.trim() || '[]');
    expect(found, `旧コマンド名が残存: ${JSON.stringify(found)}`).toHaveLength(0);
  });

  it('観点4: README / docs に旧コマンド名(demo:*)の参照が残っていない', () => {
    // system dirs (.claude, .codex, memory, node_modules) を除外して検索
    const r = runCmd(
      "grep -rn 'demo:start\\|demo:generate\\|demo:cleanup' " +
      "--include='*.md' " +
      "--exclude-dir='.claude' " +
      "--exclude-dir='.codex' " +
      "--exclude-dir='memory' " +
      "--exclude-dir='node_modules' " +
      ". 2>/dev/null || true"
    );
    expect(r.stdout.trim(), `proj_a docs に旧コマンド名の参照が残存:\n${r.stdout}`).toBe('');
  });
});
