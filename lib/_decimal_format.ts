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
 *
 * Deliberately Prisma-free and in its own module, separate from
 * `_decimal.ts` (which imports the Node.js Prisma client as a *value*, for
 * `deepStringifyDecimals`'s `instanceof Prisma.Decimal` check): a 'use
 * client' component that imported `formatDecimalDisplay` from `_decimal.ts`
 * would pull that whole module — Prisma client included — into the browser
 * bundle, even via a re-export barrel (the bundler still evaluates the
 * re-exporting module's own top-level imports). Client components must
 * import this function from here directly, never through `_decimal.ts`.
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
