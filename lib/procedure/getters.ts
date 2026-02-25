'use server';

import prisma from '@/lib/prisma';
import type { Procedure, ProcedureDetail } from '@/lib/procedure/types';
import type { ModelPermissions } from '@/lib/authz';
import { assertPermission, getModelPermissions } from '@/lib/authz';
import type { Operation } from '@/lib/authz';
import { getServerSession } from 'next-auth/next';

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
      children: { include: { parent: true, 
      assignee: true } }, 
      preceded_by: { include: { parent: true, 
      assignee: true } }, 
      followed_by: { include: { parent: true, 
      assignee: true } }, 
      parent: true, 
      assignee: true, 
      creator: { select: { id: true, 
      name: true } }, 
      updater: { select: { id: true, 
      name: true } } 
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
  const userPermissions = await getModelPermissions('procedure');
  if (isAssertPermission) {
    await assertPermission(userPermissions, 'read', 'procedure');
  }
  const procedures = await getAllProcedures();
  return { procedures, userPermissions };
}

export async function getProcedureDetailPageData(id: string, operation: Operation = 'read') {
  const procedure = await getProcedureDetail(id);
  const userPermissions = await getModelPermissions('procedure', undefined, procedure);
  await assertPermission(userPermissions, operation, 'procedure');
  return { procedure, userPermissions };
}

export async function getProcedureNewPageAccessCheck() {
  const userPermissions = await getModelPermissions('procedure');
  await assertPermission(userPermissions, 'create', 'procedure');
  return userPermissions;
}
