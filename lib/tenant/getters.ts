'use server';

import prisma from '@/lib/prisma';
import type { Tenant, TenantDetail } from '@/lib/tenant/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllTenants(): Promise<Tenant[]> {
  const tenants = await prisma.tenant.findMany({
  });
  return tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
  }));
}

export async function getTenantDetail(id: string): Promise<TenantDetail | null> {
  const tenant = await prisma.tenant.findUnique({
    where: {
      id,
    },
  });

  if (!tenant) {
    return null;
  }

  return {
    ...tenant,
  };
}

export async function getTenantListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, tenants] = await Promise.all([
    getModelPermissions('tenant'),
    getAllTenants(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'tenant');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredTenants = tenants;
  return { tenants: filteredTenants, userPermissions: await toPermissions(userPermissions) };
}

export async function getTenantDetailPageData(id: string, operation: Operation = 'read') {
  const [tenant, { permissions: basePermissions, userId }] = await Promise.all([
    getTenantDetail(id),
    getModelPermissions('tenant'),
  ]);
  const resolved = await resolvePermissions(basePermissions, tenant, userId ?? '');
  await assertPermission(resolved, operation, 'tenant');
  return { tenant, userPermissions: await toPermissions(resolved) };
}

export async function getTenantNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('tenant');
  await assertPermission(richPermissions.general, 'create', 'tenant');
  return richPermissions.general;
}
