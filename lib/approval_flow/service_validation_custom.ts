// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
// Custom save-time validation for approval_flow.
//
// validateCustomRules() is called unconditionally from validateOnAdd()/
// validateOnUpdate() (see lib/approval_flow/service_validation.ts), after
// the generated schema-driven checks (required fields, one-to-one
// uniqueness). Throw an Error to reject the save — the message surfaces to
// the caller (UI form or direct API request) as the save failure.
import type { PrismaClient } from '@/app/generated/prisma/client';
import { isCrossEntityRef } from './autocomplete_filter';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// cmd_652 (corrected from cmd_646 — see docs/knowledge/
// same-entity-validation-socket.md): preceded_by/followed_by links are only
// meaningful WITHIN the same entity_name chain (see
// lib/approval_flow/autocomplete_filter.ts's filterAutocompleteOptions()
// for the client-side narrowing half of this same judgment, expressed as a
// query predicate). This is the save-time backstop — authoritative, runs
// regardless of what the client-side filter let through (a bare API call,
// a stale form, a race with another edit).
async function validateSameEntityRefs(
  tx: Tx,
  data: Record<string, unknown>,
  propName: 'preceded_by' | 'followed_by',
  label: string,
): Promise<void> {
  const selfValue = data.entity_name;
  const ids = Array.isArray(data[propName])
    ? (data[propName] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  if (typeof selfValue !== 'string' || selfValue.length === 0 || ids.length === 0) return;
  const linked = await tx.approval_flow.findMany({
    where: { id: { in: ids } },
    select: { id: true, entity_name: true },
  });
  for (const row of linked) {
    if (isCrossEntityRef(selfValue, row.entity_name)) {
      throw new Error(`${label} must share this record's entity_name`);
    }
  }
}

export async function validateCustomRules(
  tx: unknown,
  data: Record<string, unknown>,
  _currentId: string | null,
): Promise<void> {
  const db = tx as Tx;
  await validateSameEntityRefs(db, data, 'preceded_by', 'Preceded By');
  await validateSameEntityRefs(db, data, 'followed_by', 'Followed By');
}
