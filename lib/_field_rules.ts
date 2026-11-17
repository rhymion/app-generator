// Runtime check of a submitted field value against its JSON schema rules (Issue #1271, ASVS V2.2.1).
//
// The generated lib/{entity}/service_validation.ts lists one FieldRule per writable scalar field and
// calls fieldRuleViolation() for every value the caller supplied, on every write path (REST, bulk,
// Server Action, CSV import). The type is always checked; ranges, allowed values, minimum length,
// pattern and format only when the schema declares them. A missing or blank value is not checked
// here: the required-field rule decides whether it may be missing.
//
// Framework-free on purpose (no imports besides lib/_safe_url.ts), like lib/_date_value.ts.
import { isSafeUrl } from '@/lib/_safe_url';

export type FieldRule = {
  key: string;
  label: string;
  type: 'string' | 'integer' | 'number' | 'boolean';
  enum?: readonly (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  pattern?: string;
  format?: 'uri' | 'email';
};

// Deliberately simple: one "@", a non-empty local part, a dotted domain, no whitespace.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const patternCache = new Map<string, RegExp>();

function compiled(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern, 'u');
    patternCache.set(pattern, re);
  }
  return re;
}

/** True when the value counts as not supplied (the required-field rule handles it). */
export function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** The reason the value breaks the rule, or null when it is acceptable. */
export function fieldRuleViolation(rule: FieldRule, value: unknown): string | null {
  if (isBlankValue(value)) return null;
  const { label } = rule;

  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') return `${label} must be a string`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `${label} must be true or false`;
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return `${label} must be an integer`;
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a number`;
      break;
  }

  if (rule.enum && !rule.enum.includes(value as string | number | boolean)) {
    return `${label} must be one of the allowed values`;
  }

  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) return `${label} must be at least ${rule.minimum}`;
    if (rule.maximum !== undefined && value > rule.maximum) return `${label} must be at most ${rule.maximum}`;
    if (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum) {
      return `${label} must be greater than ${rule.exclusiveMinimum}`;
    }
    if (rule.exclusiveMaximum !== undefined && value >= rule.exclusiveMaximum) {
      return `${label} must be less than ${rule.exclusiveMaximum}`;
    }
  }

  if (typeof value === 'string') {
    if (rule.minLength !== undefined && Array.from(value).length < rule.minLength) {
      return `${label} must be at least ${rule.minLength} characters`;
    }
    if (rule.pattern !== undefined && !compiled(rule.pattern).test(value)) {
      return `${label} has an invalid format`;
    }
    if (rule.format === 'uri' && !isSafeUrl(value)) {
      return `${label} must be an http(s) URL or a path starting with /`;
    }
    if (rule.format === 'email' && !EMAIL_RE.test(value)) {
      return `${label} must be an email address`;
    }
  }

  return null;
}
