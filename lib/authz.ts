'use server';

import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/auth';
import prisma from '@/lib/prisma';

export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

export async function getSessionUserIdOrThrow(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new Error('User not authenticated');
  }
  return userId;
}

export type Operation = 'create' | 'read' | 'update' | 'delete';
export type ModelName = string;
export type ModelPermissions = Record<Operation, boolean>;

export type ItemContext = {
  creator_id?: string | null;
  assignee_id?: string | null;
  [key: string]: unknown;
} | null | undefined;

const EMPTY_PERMISSIONS: ModelPermissions = {
  create: false,
  read: false,
  update: false,
  delete: false,
};

const SPECIAL_ROLE_NAMES = ['Creator', 'Assignee'] as const;

async function getUserRoleIds(userId: string): Promise<string[]> {
  const user = await prisma.user_account.findUnique({
    where: { id: userId },
    select: { roles: { select: { id: true } } },
  });
  return user?.roles?.map((role) => role.id) ?? [];
}

export async function getModelPermissions(
  model: ModelName,
  userId?: string | null,
  item?: ItemContext,
): Promise<ModelPermissions> {
  const resolvedUserId = userId ?? (await getSessionUserId());
  if (!resolvedUserId) {
    return { ...EMPTY_PERMISSIONS };
  }

  const roleIds = await getUserRoleIds(resolvedUserId);

  // Build OR conditions for the permission query
  const orConditions: any[] = [
    { role_id: null }, // Global permissions (no role)
  ];

  // Regular roles: user's roles EXCEPT Creator/Assignee (ignore direct assignments)
  if (roleIds.length > 0) {
    orConditions.push({
      role_id: { in: roleIds },
      role: { name: { notIn: [...SPECIAL_ROLE_NAMES] } },
    });
  }

  // Special roles based on item context
  if (item) {
    const matchingSpecialRoles: string[] = [];
    if (item.creator_id && item.creator_id === resolvedUserId) {
      matchingSpecialRoles.push('Creator');
    }
    if (item.assignee_id && item.assignee_id === resolvedUserId) {
      matchingSpecialRoles.push('Assignee');
    }
    if (matchingSpecialRoles.length > 0) {
      orConditions.push({
        role: { name: { in: matchingSpecialRoles } },
      });
    }
  }

  const permissions = await prisma.permission.findMany({
    where: {
      name: model,
      OR: orConditions,
    },
    select: {
      create: true,
      read: true,
      update: true,
      delete: true,
      role: { select: { name: true } },
    },
  });

  if (permissions.length === 0) {
    // Default: grant all permissions if no explicit permissions are defined
    return {
      create: true,
      read: true,
      update: true,
      delete: true,
    };
  }

  // Merge with OR logic, but mask `create` for Creator/Assignee roles
  return permissions.reduce<ModelPermissions>(
    (acc, row) => {
      const isSpecialRole = row.role && SPECIAL_ROLE_NAMES.includes(row.role.name as any);
      return {
        create: acc.create || (!isSpecialRole && row.create),
        read: acc.read || row.read,
        update: acc.update || row.update,
        delete: acc.delete || row.delete,
      };
    },
    { ...EMPTY_PERMISSIONS },
  );
}

export async function canAccess(
  model: ModelName,
  operation: Operation,
  userId?: string | null,
  item?: ItemContext,
): Promise<boolean> {
  const permissions = await getModelPermissions(model, userId, item);
  return Boolean(permissions[operation]);
}

export async function requirePermission(
  model: ModelName,
  operation: Operation,
  item?: ItemContext,
): Promise<void> {
  const permissions = await getModelPermissions(model, undefined, item);
  if (!permissions[operation]) {
    throw new Error(`Access denied: ${model}.${operation}`);
  }
}

export async function assertPermission(permissions: ModelPermissions, operation: Operation, model?: ModelName): Promise<void> {
  if (!permissions[operation]) {
    throw new Error(`Access denied: ${model ?? 'model'}.${operation}`);
  }
}
