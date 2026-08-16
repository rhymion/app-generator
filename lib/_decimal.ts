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
