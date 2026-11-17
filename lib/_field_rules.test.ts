import { describe, expect, it } from 'vitest';
import { fieldRuleViolation, type FieldRule } from './_field_rules';

const rule = (over: Partial<FieldRule>): FieldRule => ({ key: 'f', label: 'F', type: 'string', ...over });

describe('fieldRuleViolation (Issue #1271)', () => {
  it('skips missing and blank values: the required rule owns them', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(fieldRuleViolation(rule({ type: 'integer', minimum: 1 }), v)).toBeNull();
    }
  });

  it('checks the JSON type', () => {
    expect(fieldRuleViolation(rule({ type: 'string' }), 5)).toBe('F must be a string');
    expect(fieldRuleViolation(rule({ type: 'boolean' }), 'true')).toBe('F must be true or false');
    expect(fieldRuleViolation(rule({ type: 'integer' }), 1.5)).toBe('F must be an integer');
    expect(fieldRuleViolation(rule({ type: 'integer' }), '3')).toBe('F must be an integer');
    expect(fieldRuleViolation(rule({ type: 'number' }), Number.POSITIVE_INFINITY)).toBe('F must be a number');
    expect(fieldRuleViolation(rule({ type: 'number' }), 1.5)).toBeNull();
    expect(fieldRuleViolation(rule({ type: 'boolean' }), false)).toBeNull();
  });

  it('applies a declared range, inclusive and exclusive', () => {
    const r = rule({ type: 'integer', minimum: 0, maximum: 10 });
    expect(fieldRuleViolation(r, 0)).toBeNull();
    expect(fieldRuleViolation(r, 10)).toBeNull();
    expect(fieldRuleViolation(r, -1)).toBe('F must be at least 0');
    expect(fieldRuleViolation(r, 11)).toBe('F must be at most 10');
    const ex = rule({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 });
    expect(fieldRuleViolation(ex, 0)).toBe('F must be greater than 0');
    expect(fieldRuleViolation(ex, 1)).toBe('F must be less than 1');
    expect(fieldRuleViolation(ex, 0.5)).toBeNull();
  });

  it('applies a declared enum', () => {
    const r = rule({ enum: ['open', 'closed'] });
    expect(fieldRuleViolation(r, 'open')).toBeNull();
    expect(fieldRuleViolation(r, 'OPEN')).toBe('F must be one of the allowed values');
  });

  it('applies a declared minLength (code points) and pattern', () => {
    expect(fieldRuleViolation(rule({ minLength: 3 }), 'ab')).toBe('F must be at least 3 characters');
    expect(fieldRuleViolation(rule({ minLength: 2 }), '😀😀')).toBeNull();
    expect(fieldRuleViolation(rule({ pattern: '^[A-Z]{3}$' }), 'ABC')).toBeNull();
    expect(fieldRuleViolation(rule({ pattern: '^[A-Z]{3}$' }), 'abc')).toBe('F has an invalid format');
  });

  it('applies a declared uri format: http(s) or root-relative only', () => {
    const r = rule({ format: 'uri' });
    expect(fieldRuleViolation(r, 'https://example.com/a')).toBeNull();
    expect(fieldRuleViolation(r, '/api/attachments/1')).toBeNull();
    expect(fieldRuleViolation(r, 'javascript:alert(1)')).toMatch(/http\(s\) URL/);
    expect(fieldRuleViolation(r, '//evil.example')).toMatch(/http\(s\) URL/);
  });

  it('applies a declared email format', () => {
    const r = rule({ format: 'email' });
    expect(fieldRuleViolation(r, 'a@example.com')).toBeNull();
    expect(fieldRuleViolation(r, 'not-an-email')).toBe('F must be an email address');
  });

  it('checks nothing beyond the type when no rule is declared', () => {
    expect(fieldRuleViolation(rule({}), 'anything at all')).toBeNull();
    expect(fieldRuleViolation(rule({ type: 'integer' }), -999999)).toBeNull();
  });
});
