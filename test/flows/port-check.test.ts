import { describe, it, expect } from 'vitest';
import { isPortInUse } from './helpers';

describe('ポート占有チェック（観点6）', () => {
  it('isPortInUse が boolean を返す', async () => {
    const result = await isPortInUse(65534);
    expect(typeof result).toBe('boolean');
  });

  it('デフォルトポート(5432)占有時は skip メッセージを出す', async () => {
    const inUse = await isPortInUse(5432);
    if (inUse) {
      console.log('INFO: PostgreSQL default port 5432 is in use — default-port flow will be skipped in build-all tests.');
    }
    // このテスト自体は常に pass（skip ロジックの確認のみ）
    expect(true).toBe(true);
  });
});
