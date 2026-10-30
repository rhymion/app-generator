// The one place that may write to the console. Everything passed in is redacted first:
//   * object keys that look like credentials (see lib/logger-redaction-rules.ts), at any depth,
//     case-insensitively;
//   * email addresses (and bearer tokens / JWTs) inside any string;
//   * Error objects are reduced to name, message, stack, cause and their own enumerable fields,
//     all redacted by the same rules.
// Usage: `logger.error('[orders] export failed', err)`. Do not call `console.*` directly; ESLint fails on it.
import {
  MAX_REDACTION_DEPTH,
  REDACTED_KEY_EXACT,
  REDACTED_KEY_FRAGMENTS,
  REDACTED_PLACEHOLDER,
  REDACTED_VALUE_PATTERNS,
} from './logger-redaction-rules';

const VALUE_PATTERNS = REDACTED_VALUE_PATTERNS.map((p) => ({ label: p.label, re: new RegExp(p.source, p.flags) }));

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isRedactedKey(key: string): boolean {
  const k = normalizeKey(key);
  if (!k) return false;
  return REDACTED_KEY_EXACT.includes(k) || REDACTED_KEY_FRAGMENTS.some((f) => k.includes(f));
}

export function redactString(value: string): string {
  let out = value;
  for (const { label, re } of VALUE_PATTERNS) out = out.replace(re, label);
  return out;
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') {
    // bigint and symbol are not JSON-safe; stringify so console output stays printable.
    return typeof value === 'bigint' || typeof value === 'symbol' ? String(value) : value;
  }
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_REDACTION_DEPTH) return '[Truncated]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => redactInner(v, depth + 1, seen));
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Map) return redactInner(Object.fromEntries(value), depth, seen);
    if (value instanceof Set) return redactInner([...value], depth, seen);
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[Binary]';
    const out: Record<string, unknown> = {};
    if (value instanceof Error) {
      out.name = value.name;
      out.message = redactString(value.message);
      if (value.stack) out.stack = redactString(value.stack);
      if ('cause' in value && value.cause !== undefined) out.cause = redactInner(value.cause, depth + 1, seen);
    }
    for (const [k, v] of Object.entries(value)) {
      out[k] = isRedactedKey(k) ? REDACTED_PLACEHOLDER : redactInner(v, depth + 1, seen);
    }
    return out;
  } finally {
    // Only a true cycle (an ancestor) is "Circular"; a shared reference seen twice is not.
    seen.delete(value);
  }
}

export function redact(value: unknown): unknown {
  return redactInner(value, 0, new WeakSet());
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, args: unknown[]): void {
  // The only direct console call in application code (allowlisted in eslint.config.mjs).
  console[level](...args.map((a) => redact(a)));
}

export const logger = {
  debug: (...args: unknown[]): void => write('debug', args),
  info: (...args: unknown[]): void => write('info', args),
  warn: (...args: unknown[]): void => write('warn', args),
  error: (...args: unknown[]): void => write('error', args),
};
