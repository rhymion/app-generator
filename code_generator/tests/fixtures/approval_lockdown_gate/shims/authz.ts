// Fixture-only stand-in for @/lib/authz (decimal-gate check).
// Public type/function *signatures* copied verbatim from the real
// lib/authz.ts so generated getters.ts/service_validation.ts/route.ts
// type-check against the real contract -- but the real file itself is not
// used, because its own implementation imports @/lib/prisma expecting the
// FULL production `user` model, which this fixture's Prisma schema
// intentionally does not carry. authz.ts's own correctness is covered by
// the main repo's own test:e2e:build/tsc gate already -- this file exists
// only so the decimal-branch call sites type-check. Mirrors
// tests/fixtures/mention_gate/shims/authz.ts, plus `canAccess` (needed by
// api_import_route.ts.jinja2, which mention_gate's fixture does not check).
export type Operation = 'create' | 'read' | 'update' | 'delete' | 'import';
export type ModelName = string;
export type OperationFlags = Record<Operation, boolean>;
export type ModelPermissions = OperationFlags;

export interface RichPermissions extends OperationFlags {
  general: OperationFlags;
  creator: OperationFlags | null;
  assignee: OperationFlags | null;
}

export type ItemContext = {
  creator_id?: string | null;
  assignee_id?: string | null;
  [key: string]: unknown;
} | null | undefined;

export async function toPermissions(_p: RichPermissions): Promise<ModelPermissions> {
  throw new Error('fixture stub');
}

export async function resolvePermissions(
  _perms: RichPermissions,
  _item: ItemContext,
  _userId: string,
): Promise<RichPermissions> {
  throw new Error('fixture stub');
}

export const getModelPermissions = async (
  _model: ModelName,
  _userId?: string | null,
): Promise<{ permissions: RichPermissions; userId: string | null }> => {
  throw new Error('fixture stub');
};

export async function assertPermission(_permissions: OperationFlags, _operation: Operation, _model?: ModelName): Promise<void> {
  throw new Error('fixture stub');
}

export async function requirePermission(
  _model: ModelName,
  _operation: Operation,
  _item?: ItemContext,
  _userId?: string | null,
): Promise<RichPermissions> {
  throw new Error('fixture stub');
}

export async function canAccess(
  _model: ModelName,
  _operation: Operation,
  _userId?: string | null,
  _item?: ItemContext,
): Promise<boolean> {
  throw new Error('fixture stub');
}

export async function getSessionUserId(): Promise<string | null> {
  throw new Error('fixture stub');
}

export async function getSessionUserIdOrThrow(): Promise<string> {
  throw new Error('fixture stub');
}
