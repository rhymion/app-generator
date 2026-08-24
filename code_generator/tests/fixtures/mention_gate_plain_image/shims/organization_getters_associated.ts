// Fixture-only stand-in for @/lib/organization/getters_associated (cmd_538,
// extending the mention-gate check to cover FormUpsert.tsx).
// lib/mention/search.ts (schema-global, generated whenever any field has
// x-mention: true) imports getAssociatedOrganizations() unconditionally for
// its org-scoped candidate filtering -- only pulled into this gate's
// compile graph now that FormUpsert.tsx (which imports
// searchMentionUserOptions transitively) is in scope. Same rationale as
// authz.ts in this directory: the real implementation imports
// @/lib/organization/types and the full production `organization` Prisma
// model, unrelated to what this gate checks.
export interface Organization {
  id: string;
  name: string;
  description?: string | null;
}

export async function getAssociatedOrganizations(_userId: string): Promise<Organization[]> {
  throw new Error('fixture stub');
}
