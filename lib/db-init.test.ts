import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const state = vi.hoisted(() => ({
  indexes: [] as string[],
  extensions: ['pg_trgm'] as string[],
  denyCreate: ((_sql: string) => false) as (sql: string) => boolean,
  failCreate: ((_sql: string) => false) as (sql: string) => boolean,
  executed: [] as string[],
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('pg_indexes')) return state.indexes.map((indexname) => ({ indexname }));
      if (sql.includes('pg_extension')) return state.extensions.map((extname) => ({ extname }));
      throw new Error(`unexpected query: ${sql}`);
    }),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      state.executed.push(sql);
      if (state.denyCreate(sql)) {
        throw Object.assign(
          new Error('Invalid `prisma.$executeRaw()` invocation: Raw query failed. Code: `42501`. Message: `must be owner of table role`'),
          { code: 'P2010', meta: { code: '42501' } },
        );
      }
      if (state.failCreate(sql)) throw new Error('boom');
      return 0;
    }),
  },
}));

import { ensureSearchIndexes } from './db-init';

const CREATE = 'CREATE INDEX CONCURRENTLY';
const ALL_INDEX_NAMES = async (): Promise<string[]> => {
  // Discover the generated index names by running once against an empty catalog.
  state.indexes = [];
  state.executed = [];
  await ensureSearchIndexes();
  const names = state.executed
    .filter((sql) => sql.startsWith(CREATE))
    .map((sql) => /"(idx_[^"]+)"/.exec(sql)![1]);
  state.executed = [];
  return names;
};

describe('ensureSearchIndexes', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.indexes = [];
    state.extensions = ['pg_trgm'];
    state.denyCreate = () => false;
    state.failCreate = () => false;
    state.executed = [];
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it('issues nothing and logs nothing when every index exists, even if CREATE would be denied', async () => {
    const names = await ALL_INDEX_NAMES();
    expect(names.length).toBeGreaterThan(0);
    state.indexes = names;
    state.denyCreate = () => true;
    await expect(ensureSearchIndexes()).resolves.toBeUndefined();
    expect(state.executed).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('creates only the missing indexes', async () => {
    const names = await ALL_INDEX_NAMES();
    state.indexes = names.slice(1);
    await ensureSearchIndexes();
    const created = state.executed.filter((sql) => sql.startsWith(CREATE));
    expect(created).toHaveLength(1);
    expect(created[0]).toContain(`"${names[0]}"`);
  });

  it('creates pg_trgm only when it is missing', async () => {
    await ALL_INDEX_NAMES();
    state.extensions = [];
    await ensureSearchIndexes();
    expect(state.executed.some((sql) => sql.startsWith('CREATE EXTENSION'))).toBe(true);
    state.executed = [];
    state.extensions = ['pg_trgm'];
    await ensureSearchIndexes();
    expect(state.executed.some((sql) => sql.startsWith('CREATE EXTENSION'))).toBe(false);
  });

  it('warns once naming every denied index, keeps trying the rest, and does not throw', async () => {
    const names = await ALL_INDEX_NAMES();
    expect(names.length).toBeGreaterThan(2);
    state.denyCreate = (sql) => sql.includes(`"${names[0]}"`) || sql.includes(`"${names[1]}"`);
    await expect(ensureSearchIndexes()).resolves.toBeUndefined();
    const attempted = state.executed.filter((sql) => sql.startsWith(CREATE));
    expect(attempted).toHaveLength(names.length);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain(names[0]);
    expect(message).toContain(names[1]);
    expect(message).not.toContain(names[2]);
    expect(message).toContain('scripts/create-gin-indexes.sql');
    expect(message).toContain('DIRECT_URL');
    expect(error).not.toHaveBeenCalled();
  });

  it('still surfaces a failure that is not a privilege error, after trying the rest', async () => {
    const names = await ALL_INDEX_NAMES();
    state.failCreate = (sql) => sql.includes(`"${names[0]}"`);
    await expect(ensureSearchIndexes()).rejects.toThrow('boom');
    expect(state.executed.filter((sql) => sql.startsWith(CREATE))).toHaveLength(names.length);
  });

  it('matches an index name PostgreSQL truncated to 63 bytes', async () => {
    const names = await ALL_INDEX_NAMES();
    state.indexes = names.map((n) => Buffer.from(n).subarray(0, 63).toString());
    await ensureSearchIndexes();
    expect(state.executed).toEqual([]);
  });
});
