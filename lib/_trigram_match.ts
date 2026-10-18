// Helpers for the list panel's trigram search on `x-trigram-filter` columns.
//
// Prisma's `contains` filter renders the bare column (`"col" ILIKE ...`), which the
// `idx_<table>_<column>_gin_trgm_v2` index (built on `COALESCE("col", '')`) does not serve. The
// generated getter therefore selects matching ids with its own literal COALESCE SQL and narrows
// the Prisma query by `id IN (...)`. This module holds the part that does not depend on the
// entity: turning the user's text into the ILIKE pattern.

/** Escapes the LIKE wildcards (`\`, `%`, `_`) so the text is matched as a literal substring. */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** The ILIKE pattern that matches rows containing `term` as a substring. */
export function trigramPattern(term: string): string {
  return `%${escapeLikeTerm(term)}%`;
}

/**
 * The most matching ids the generated getter puts into an `id IN (...)` clause. A longer list
 * exceeds the database's bind-parameter limit, and a term matching that many rows is not narrowed
 * by the trigram index anyway.
 */
export const TRIGRAM_ID_LIMIT = 10000;
