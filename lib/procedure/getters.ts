'use server';

import prisma from '@/lib/prisma';
import type { Procedure, ProcedureDetail } from '@/lib/procedure/types';
import { assertPermission, getModelPermissions, resolvePermissions, toPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';

export async function getAllProcedures(): Promise<Procedure[]> {
  const procedures = await prisma.procedure.findMany({
    include: { parent: true, assignee: true },
  });
  return procedures.map((procedure) => ({
    id: procedure.id,
    name: procedure.name,
    description: procedure.description,
    parent_id: procedure.parent_id,
    assignee_id: procedure.assignee_id,
    creator_id: procedure.creator_id,
    parent: procedure.parent,
    assignee: procedure.assignee,
  }));
}

export async function getProcedureDetail(id: string): Promise<ProcedureDetail | null> {
  const procedure = await prisma.procedure.findUnique({
    where: {
      id,
    },
    include: {
      children: { include: { parent: true, assignee: true } }, preceded_by: { include: { parent: true, assignee: true } }, followed_by: { include: { parent: true, assignee: true } }, parent: true, assignee: true, creator: { select: { id: true, name: true } }, updater: { select: { id: true, name: true } }
    },
  });

  if (!procedure) {
    return null;
  }

  return {
    ...procedure,
    children: procedure.children,
    preceded_by: procedure.preceded_by,
    followed_by: procedure.followed_by,
    parent: procedure.parent,
    assignee: procedure.assignee,
  };
}

export async function getProcedureListPageData(isAssertPermission: boolean = true) {
  const [{ permissions: userPermissions, userId }, procedures] = await Promise.all([
    getModelPermissions('procedure'),
    getAllProcedures(),
  ]);
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'procedure');
  }
  // If the user lacks general read but has Creator/Assignee read, filter to their own items.
  const filteredProcedures = userPermissions.general.read
    ? procedures
    : procedures.filter(item =>
        (userPermissions.creator?.read && item.creator_id === userId) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userPermissions.assignee?.read && (item as any).assignee_id === userId)
      );
  return { procedures: filteredProcedures, userPermissions: await toPermissions(userPermissions) };
}

export async function getProcedureDetailPageData(id: string, operation: Operation = 'read') {
  const [procedure, { permissions: basePermissions, userId }] = await Promise.all([
    getProcedureDetail(id),
    getModelPermissions('procedure'),
  ]);
  const resolved = await resolvePermissions(basePermissions, procedure, userId ?? '');
  await assertPermission(resolved, operation, 'procedure');
  return { procedure, userPermissions: await toPermissions(resolved) };
}

export async function getProcedureNewPageAccessCheck() {
  const { permissions: richPermissions } = await getModelPermissions('procedure');
  await assertPermission(richPermissions.general, 'create', 'procedure');
  return richPermissions.general;
}
