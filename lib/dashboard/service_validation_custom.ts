// GENERATED ONCE — safe to edit (will not be overwritten on regeneration)
import { DASHBOARDABLE_ENTITIES } from './catalog';
import { validateWidgets } from './widgets-validation';

// Custom save-time validation for dashboard.
//
// validateCustomRules() is called unconditionally from validateOnAdd()/
// validateOnUpdate() (see lib/dashboard/service_validation.ts), after the
// generated schema-driven checks (required fields, one-to-one uniqueness).
// Throw an AppError to reject the save — its message surfaces to the caller
// (UI form or direct API request) as the save failure.
//
// `data` is the same raw create/update payload service_validation.ts
// receives, including every connect-style (many-to-many / optional-FK-list)
// child's selected id array under its property name (e.g. a self-ref m2m
// child exposes its linked ids as `data.<property_name>: string[]`) —
// see build_context.py's validation_data_obj for what is exposed.
//
// Rejects a save that contains a widget which could not be drawn (see widgets-validation.ts). Cast `tx` to your own Prisma
// transaction-client type as needed, e.g.:
//   import type { PrismaClient } from '@/app/generated/prisma/client';
//   type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
type DashboardReader = {
  dashboard: { findUnique: (args: unknown) => Promise<{ widgets: Parameters<typeof validateWidgets>[2] } | null> };
};

export async function validateCustomRules(
  tx: unknown,
  data: Record<string, unknown>,
  currentId: string | null,
): Promise<void> {
  const stored = currentId
    ? (await (tx as DashboardReader).dashboard.findUnique({ where: { id: currentId }, select: { widgets: true } }))?.widgets
    : undefined;
  validateWidgets(DASHBOARDABLE_ENTITIES, data.widgets, stored);
}
