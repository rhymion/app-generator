// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
// Custom save-time validation for dashboard.
//
// validateCustomRules() is called unconditionally from validateOnAdd()/
// validateOnUpdate() (see lib/dashboard/service_validation.ts), after the
// generated schema-driven checks (required fields, one-to-one uniqueness).
// Throw an Error to reject the save — the message surfaces to the caller
// (UI form or direct API request) as the save failure.
//
// `data` is the same raw create/update payload service_validation.ts
// receives, including every connect-style (many-to-many / optional-FK-list)
// child's selected id array under its property name (e.g. a self-ref m2m
// child exposes its linked ids as `data.<property_name>: string[]`) —
// see build_context.py's validation_data_obj for what is exposed.
//
// Default (unedited) stub is a no-op. Cast `tx` to your own Prisma
// transaction-client type as needed, e.g.:
//   import type { PrismaClient } from '@/app/generated/prisma/client';
//   type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
export async function validateCustomRules(
  _tx: unknown,
  _data: Record<string, unknown>,
  _currentId: string | null,
): Promise<void> {}
