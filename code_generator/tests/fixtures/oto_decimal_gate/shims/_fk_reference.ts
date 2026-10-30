// Fixture-only stand-in for @/lib/_fk_reference (see shims/authz.ts in this directory for why).
export type FkReference = {
  model: string;
  selfOnly?: boolean;
  id: string | null | undefined;
  previousId?: string | null;
  required?: boolean;
  load: (id: string) => Promise<Record<string, unknown> | null>;
};

export async function assertFkReferencesUsable(_actorId: string, _refs: FkReference[]): Promise<void> {
  throw new Error('fixture stub');
}

export async function assertStoredFkReferencesReachable(
  _actorId: string,
  _refs: Pick<FkReference, 'model' | 'selfOnly' | 'id' | 'load'>[],
): Promise<void> {
  throw new Error('fixture stub');
}
