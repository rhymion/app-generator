import { describe, it, expect } from 'vitest';
import { pinSslModeVerifyFull } from './db-url';

describe('pinSslModeVerifyFull', () => {
  it('pins sslmode=require (Neon default) to verify-full', () => {
    const out = pinSslModeVerifyFull(
      'postgresql://user:pass@host.neon.tech/db?sslmode=require&channel_binding=require'
    );
    expect(new URL(out).searchParams.get('sslmode')).toBe('verify-full');
  });

  it('pins sslmode=prefer to verify-full', () => {
    const out = pinSslModeVerifyFull('postgresql://user:pass@host/db?sslmode=prefer');
    expect(new URL(out).searchParams.get('sslmode')).toBe('verify-full');
  });

  it('pins sslmode=verify-ca to verify-full', () => {
    const out = pinSslModeVerifyFull('postgresql://user:pass@host/db?sslmode=verify-ca');
    expect(new URL(out).searchParams.get('sslmode')).toBe('verify-full');
  });

  it('leaves sslmode=verify-full untouched', () => {
    const out = pinSslModeVerifyFull('postgresql://user:pass@host/db?sslmode=verify-full');
    expect(new URL(out).searchParams.get('sslmode')).toBe('verify-full');
  });

  it('leaves sslmode=disable untouched', () => {
    const out = pinSslModeVerifyFull('postgresql://user:pass@host/db?sslmode=disable');
    expect(new URL(out).searchParams.get('sslmode')).toBe('disable');
  });

  it('is a no-op when sslmode is absent (local/CI Postgres)', () => {
    const raw = 'postgresql://postgres:postgres@localhost:5432/my_next_test';
    expect(pinSslModeVerifyFull(raw)).toBe(new URL(raw).toString());
  });

  it('returns the input unchanged when it is not a parseable URL', () => {
    expect(pinSslModeVerifyFull('not-a-url')).toBe('not-a-url');
  });
});
