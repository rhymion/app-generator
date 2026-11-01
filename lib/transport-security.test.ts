import { describe, it, expect } from 'vitest';
import { assertSecureDatabaseUrl, assertSecureRedisUrl, isHostedProduction } from './transport-security';

const vercelProd = { NODE_ENV: 'production', VERCEL: '1' };
const cloudRunProd = { NODE_ENV: 'production', K_SERVICE: 'app' };

describe('isHostedProduction', () => {
  it('is true only for a production build on Vercel or Cloud Run', () => {
    expect(isHostedProduction(vercelProd)).toBe(true);
    expect(isHostedProduction(cloudRunProd)).toBe(true);
    expect(isHostedProduction({ NODE_ENV: 'production' })).toBe(false);
    expect(isHostedProduction({ NODE_ENV: 'development', VERCEL: '1' })).toBe(false);
  });
});

describe('assertSecureDatabaseUrl', () => {
  it.each([
    'postgresql://u:p@db.example.com/app?sslmode=disable',
    'postgresql://u:p@db.example.com/app',
    'postgresql://u:p@db.example.com/app?sslmode=allow',
    'not a url',
  ])('rejects %s in hosted production', (url) => {
    expect(() => assertSecureDatabaseUrl(url, vercelProd)).toThrow(/must use TLS/);
    expect(() => assertSecureDatabaseUrl(url, cloudRunProd)).toThrow(/must use TLS/);
  });

  it.each([
    'postgresql://u:p@db.example.com/app?sslmode=require',
    'postgresql://u:p@db.example.com/app?sslmode=verify-full',
    'postgresql://u:p@db.example.com/app?ssl=true',
    'postgresql://u:p@localhost/app?host=/cloudsql/project:region:instance',
  ])('accepts %s in hosted production', (url) => {
    expect(() => assertSecureDatabaseUrl(url, vercelProd)).not.toThrow();
  });

  it('allows plain connections outside hosted production', () => {
    const plain = 'postgresql://postgres:postgres@localhost:5432/app';
    expect(() => assertSecureDatabaseUrl(plain, { NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertSecureDatabaseUrl(plain, { NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertSecureDatabaseUrl(plain, { NODE_ENV: 'production' })).not.toThrow();
  });
});

describe('assertSecureRedisUrl', () => {
  it('rejects redis:// in hosted production', () => {
    expect(() => assertSecureRedisUrl('redis://default:t@host:6379', vercelProd)).toThrow(/must use TLS/);
  });

  it('accepts rediss:// in hosted production', () => {
    expect(() => assertSecureRedisUrl('rediss://default:t@host:6379', vercelProd)).not.toThrow();
  });

  it('allows redis:// outside hosted production', () => {
    expect(() => assertSecureRedisUrl('redis://localhost:6379', { NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertSecureRedisUrl('redis://localhost:6379', { NODE_ENV: 'production' })).not.toThrow();
  });
});
