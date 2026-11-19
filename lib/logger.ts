// The one place that may write to the console. Everything passed in is redacted first:
//   * object keys that look like credentials (see lib/logger-redaction-rules.ts), at any depth,
//     case-insensitively;
//   * email addresses (and bearer tokens / JWTs) inside any string;
//   * Error objects are reduced to name, message, stack, cause and their own enumerable fields,
//     all redacted by the same rules.
// Usage: `logger.error('[orders] export failed', err)`. Do not call `console.*` directly; ESLint fails on it.
//
// On the server each call writes one JSON object per line (Issue #1323), so a log processor can
// parse and correlate it: `{"timestamp","level","severity","message","context"}`. In the browser
// the redacted arguments go to the matching console method unchanged. `LOG_FORMAT=text` keeps the
// plain console arguments on the server too (local development).
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
    // Build entries and create the object with Object.fromEntries: it defines own properties, so a
    // hostile key such as "__proto__" becomes a plain data key instead of re-pointing the prototype.
    const entries: [string, unknown][] = [];
    if (value instanceof Error) {
      entries.push(['name', value.name], ['message', redactString(value.message)]);
      if (value.stack) entries.push(['stack', redactString(value.stack)]);
      if ('cause' in value && value.cause !== undefined) entries.push(['cause', redactInner(value.cause, depth + 1, seen)]);
    }
    for (const [k, v] of Object.entries(value)) {
      entries.push([k, isRedactedKey(k) ? REDACTED_PLACEHOLDER : redactInner(v, depth + 1, seen)]);
    }
    return Object.fromEntries(entries);
  } finally {
    // Only a true cycle (an ancestor) is "Circular"; a shared reference seen twice is not.
    seen.delete(value);
  }
}

export function redact(value: unknown): unknown {
  return redactInner(value, 0, new WeakSet());
}

export type Level = 'debug' | 'info' | 'warn' | 'error';

// Cloud Logging reads `severity`; other processors read `level`.
const SEVERITY: Record<Level, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' };

// A string argument that holds a JSON object or array (`logger.warn('[tag]', JSON.stringify(x))`)
// is embedded as the parsed value, so the line is not double-encoded and its keys are redacted
// like any other object.
function embedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) return value;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return value;
  }
}

/**
 * One log record as a single JSON line. The first argument is the message when it is a string;
 * the remaining arguments are the context (one value as is, several as an array). Every value is
 * redacted first.
 */
export function formatLogLine(level: Level, args: unknown[], now: Date = new Date()): string {
  const [first, ...rest] = args;
  const hasMessage = typeof first === 'string';
  const contextArgs = (hasMessage ? rest : args).map((a) => redact(embedJson(a)));
  const record: Record<string, unknown> = {
    timestamp: now.toISOString(),
    level,
    severity: SEVERITY[level],
    message: hasMessage ? redactString(first) : '',
  };
  if (contextArgs.length === 1) record.context = contextArgs[0];
  else if (contextArgs.length > 1) record.context = contextArgs;
  // redact() already turned cycles, bigints and symbols into strings, so this cannot throw.
  return JSON.stringify(record);
}

function jsonLines(): boolean {
  if (typeof window !== 'undefined') return false;
  return (typeof process === 'undefined' ? '' : (process.env.LOG_FORMAT ?? '')).trim().toLowerCase() !== 'text';
}

function write(level: Level, args: unknown[]): void {
  // The only direct console call in application code (allowlisted in eslint.config.mjs).
  if (jsonLines()) console[level](formatLogLine(level, args));
  else console[level](...args.map((a) => redact(a)));
}

export const logger = {
  debug: (...args: unknown[]): void => write('debug', args),
  info: (...args: unknown[]): void => write('info', args),
  warn: (...args: unknown[]): void => write('warn', args),
  error: (...args: unknown[]): void => write('error', args),
};
