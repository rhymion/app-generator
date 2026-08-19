import { Prisma } from '@/app/generated/prisma/client';

/**
 * Recursively maps every `Prisma.Decimal` occurrence inside `T` to `string`
 * (arrays and plain objects are walked; `Date` and other non-plain values
 * pass through unchanged). Mirrors what deepStringifyDecimals() does at
 * runtime, so a getters.ts return type stays structurally assignable to its
 * declared Detail/list type after the conversion.
 */
export type DeepStringifyDecimals<T> = T extends Prisma.Decimal
  ? string
  : T extends Date
    ? T
    : T extends (infer U)[]
      ? DeepStringifyDecimals<U>[]
      : T extends object
        ? { [K in keyof T]: DeepStringifyDecimals<T[K]> }
        : T;

/**
 * Converts every `Prisma.Decimal` instance reachable inside `value` to its
 * `.toString()` form, walking plain objects and arrays.
 *
 * A getters.ts entity spread (`{ ...parent }`) only overrides the entity's
 * own scalar Decimal columns — a Decimal-backed column that arrives nested
 * inside an *embedded relation* (a many-to-one FK object, or a one-to-many
 * child list) is not touched by that override and reaches the
 * Server-to-Client Component boundary as a raw decimal.js instance, which
 * React cannot serialize. Apply this to any embedded relation value (or
 * relation array) whose target entity carries a Decimal column, at any
 * nesting depth.
 */
/**
 * Pads a Decimal's string form (from `.toString()`, e.g. "1" or "1.5") out
 * to `scale` fractional digits (e.g. "1.00", "1.50") for display.
 *
 * String-based, not `Number()`-based: `Decimal.toString()` exists precisely
 * to avoid float rounding, and running the result through `Number()` here
 * would reintroduce the same precision loss for large values. Truncates
 * (never rounds) if the input already carries more fractional digits than
 * `scale` — data should already conform to the declared scale, so this only
 * guards against pathological input.
 */
export function formatDecimalDisplay(
  value: string | number | null | undefined,
  scale: number
): string {
  if (value === null || value === undefined || value === '') return '';
  const str = String(value);
  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const paddedFrac = (fracPart + '0'.repeat(scale)).slice(0, scale);
  const result = scale > 0 ? `${intPart}.${paddedFrac}` : intPart;
  return negative ? `-${result}` : result;
}

export function deepStringifyDecimals<T>(value: T): DeepStringifyDecimals<T> {
  if (value instanceof Prisma.Decimal) {
    return value.toString() as DeepStringifyDecimals<T>;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepStringifyDecimals(item)) as DeepStringifyDecimals<T>;
  }
  if (value instanceof Date) {
    return value as DeepStringifyDecimals<T>;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepStringifyDecimals(val);
    }
    return result as DeepStringifyDecimals<T>;
  }
  return value as DeepStringifyDecimals<T>;
}
