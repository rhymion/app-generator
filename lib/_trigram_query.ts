// Runs the id-selecting query of the list panel's trigram search.
//
// The one place the generated getters reach the database through a raw query for the search box,
// so the raw-SQL audit (code_generator/check_generated_allowlist.yaml) has a single entry to
// review. The query is a tagged `Prisma.sql` built by the generated getter: its table and column
// names are literal text fixed at generation time and the user's text is a bound parameter.
import type { Prisma } from '@/app/generated/prisma/client';
import prisma from '@/lib/prisma';

/** The ids selected by `query` (`SELECT "id" FROM "<table>" WHERE ...`). */
export async function selectTrigramIds(query: Prisma.Sql): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(query);
  return rows.map((row) => row.id);
}
