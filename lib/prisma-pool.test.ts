import { describe, it, expect } from 'vitest';
import { resolvePrismaPoolMax } from './prisma-pool';

describe('resolvePrismaPoolMax', () => {
  it('falls back to the default when unset', () => {
    expect(resolvePrismaPoolMax(undefined)).toBe(5);
  });

  it('falls back to the default when the empty string', () => {
    expect(resolvePrismaPoolMax('')).toBe(5);
  });

  it('parses a valid positive integer override', () => {
    expect(resolvePrismaPoolMax('10')).toBe(10);
  });

  it('parses a valid override with a non-default fallback', () => {
    expect(resolvePrismaPoolMax(undefined, 8)).toBe(8);
  });

  it('falls back to the default for a non-numeric value', () => {
    expect(resolvePrismaPoolMax('not-a-number')).toBe(5);
  });

  it('falls back to the default for zero', () => {
    expect(resolvePrismaPoolMax('0')).toBe(5);
  });

  it('falls back to the default for a negative value', () => {
    expect(resolvePrismaPoolMax('-5')).toBe(5);
  });

  it('truncates a decimal override to an integer via parseInt', () => {
    expect(resolvePrismaPoolMax('7.9')).toBe(7);
  });
});
