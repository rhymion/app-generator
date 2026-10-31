import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from './api-key';

describe('hashApiKey', () => {
  it('is the lowercase-hex SHA-256 of the key (known vector)', () => {
    expect(hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is deterministic and differs from the key', () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toBe(key);
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the UTF-8 bytes, as PostgreSQL sha256(convert_to(key, \'UTF8\')) does', () => {
    const key = 'mk_ключ-ü-キー';
    expect(hashApiKey(key)).toBe(createHash('sha256').update(Buffer.from(key, 'utf8')).digest('hex'));
  });
});

describe('generateApiKey', () => {
  it('is mk_ followed by 64 hex characters (256 random bits)', () => {
    expect(generateApiKey()).toMatch(new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{64}$`));
  });

  it('differs on every call', () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });
});
