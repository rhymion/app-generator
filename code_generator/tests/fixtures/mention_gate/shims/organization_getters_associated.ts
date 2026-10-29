// Fixture-only stand-in for @/lib/organization/getters_associated (cmd_538,
// extending the mention-gate check to cover FormUpsert.tsx).
// lib/mention/record_org.ts (schema-global, generated whenever any field has
// x-mention: true) imports getAssociatedOrganizations() when a hosting entity
// has an organization column, to read that record through its organization
// scope -- pulled into this gate's compile graph through FormUpsert.tsx (which
// imports searchMentionUserOptions transitively). Same rationale as
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
