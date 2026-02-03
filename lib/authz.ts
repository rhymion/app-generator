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
export type ModelName = 'role' | 'user_account';
export type ModelPermissions = Record<Operation, boolean>;

const EMPTY_PERMISSIONS: ModelPermissions = {
  create: false,
  read: false,
  update: false,
  delete: false,
};

const AUTHENTICATED_DEFAULTS: Record<ModelName, ModelPermissions> = {
  role: {
    create: false,
    read: true,
    update: false,
    delete: false,
  },
  user_account: {
    create: true,
    read: true,
    update: true,
    delete: false,
  },
};

const ADMIN_OVERRIDES: Partial<Record<ModelName, Partial<ModelPermissions>>> = {
  role: {
    create: true,
    update: true,
    delete: true,
  },
  user_account: {
    delete: true,
  },
};

async function getUserRoles(userId: string): Promise<string[]> {
  const user = await prisma.user_account.findUnique({
    where: { id: userId },
    select: { roles: { select: { name: true } } },
  });
  return user?.roles?.map((role) => role.name) ?? [];
}

function buildPermissionsForRoles(roles: string[], isAuthenticated: boolean): Record<ModelName, ModelPermissions> {
  if (!isAuthenticated) {
    return {
      role: { ...EMPTY_PERMISSIONS },
      user_account: { ...EMPTY_PERMISSIONS },
    };
  }

  const permissions: Record<ModelName, ModelPermissions> = {
    role: { ...AUTHENTICATED_DEFAULTS.role },
    user_account: { ...AUTHENTICATED_DEFAULTS.user_account },
  };

  if (roles.includes('Admin')) {
    for (const [model, overrides] of Object.entries(ADMIN_OVERRIDES)) {
      const modelName = model as ModelName;
      Object.assign(permissions[modelName], overrides);
    }
  }

  return permissions;
}

export async function getModelPermissions(model: ModelName, userId?: string | null): Promise<ModelPermissions> {
  const resolvedUserId = userId ?? (await getSessionUserId());
  if (!resolvedUserId) {
    return { ...EMPTY_PERMISSIONS };
  }

  const roles = await getUserRoles(resolvedUserId);
  const allPermissions = buildPermissionsForRoles(roles, true);
  return { ...allPermissions[model] };
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
