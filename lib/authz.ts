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

const EMPTY_PERMISSIONS: ModelPermissions = {
  create: false,
  read: false,
  update: false,
  delete: false,
};

async function getUserRoleIds(userId: string): Promise<string[]> {
  const user = await prisma.user_account.findUnique({
    where: { id: userId },
    select: { roles: { select: { id: true } } },
  });
  return user?.roles?.map((role) => role.id) ?? [];
}

function mergePermissionRows(rows: { create: boolean; read: boolean; update: boolean; delete: boolean }[]): ModelPermissions {
  return rows.reduce<ModelPermissions>(
    (acc, row) => ({
      create: acc.create || row.create,
      read: acc.read || row.read,
      update: acc.update || row.update,
      delete: acc.delete || row.delete,
    }),
    { ...EMPTY_PERMISSIONS }
  );
}

export async function getModelPermissions(model: ModelName, userId?: string | null): Promise<ModelPermissions> {
  const resolvedUserId = userId ?? (await getSessionUserId());
  if (!resolvedUserId) {
    return { ...EMPTY_PERMISSIONS };
  }

  const roleIds = await getUserRoleIds(resolvedUserId);

  const permissions = await prisma.permission.findMany({
    where: {
      name: model,
      OR: [
        { role_id: null },
        ...(roleIds.length > 0 ? [{ role_id: { in: roleIds } }] : []),
      ],
    },
    select: {
      create: true,
      read: true,
      update: true,
      delete: true,
    },
  });

  if (permissions.length === 0) {
    return {
      create: true,
      read: true,
      update: true,
      delete: true,
    };
  }

  return mergePermissionRows(permissions);
}

export async function canAccess(model: ModelName, operation: Operation, userId?: string | null): Promise<boolean> {
  const permissions = await getModelPermissions(model, userId);
  return Boolean(permissions[operation]);
}

export async function requirePermission(model: ModelName, operation: Operation): Promise<void> {
  const allowed = await canAccess(model, operation);
  if (!allowed) {
    throw new Error(`Access denied: ${model}.${operation}`);
  }
}

export async function assertPermission(permissions: ModelPermissions, operation: Operation, model?: ModelName): Promise<void> {
  if (!permissions[operation]) {
    throw new Error(`Access denied: ${model ?? 'model'}.${operation}`);
  }
}
