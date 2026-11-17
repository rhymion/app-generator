import { describe, expect, it } from 'vitest';
import { p2000Field, p2000Message } from './_prisma_value_too_long';

describe('p2000Field (Issue #1393)', () => {
  it('reads the column from the Rust engine meta', () => {
    expect(p2000Field({ column_name: 'code' })).toBe('code');
  });

  it('reads the column from a driver adapter LengthMismatch cause', () => {
    expect(p2000Field({ driverAdapterError: { cause: { kind: 'LengthMismatch', column: 'code' } } })).toBe('code');
  });

  it('is undefined when the database did not report the column', () => {
    expect(p2000Field({ driverAdapterError: { cause: { kind: 'LengthMismatch' } } })).toBeUndefined();
    expect(p2000Field(undefined)).toBeUndefined();
    expect(p2000Field({ driverAdapterError: { cause: { kind: 'Other', column: 'x' } } })).toBeUndefined();
  });

  it('says the value is too long, with or without the field', () => {
    expect(p2000Message('code')).toBe('code is too long');
    expect(p2000Message(undefined)).toBe('A value is too long for its column');
  });
});
