import { prisma } from './db-helpers';

export async function getApprovableById(approvable_id: string) {
  const approvable = await prisma.approvable.findUnique({ where: { id: approvable_id } });
  return approvable ? JSON.parse(JSON.stringify(approvable)) : null;
}

export async function getPendingApprovalRequest(approvable_id: string) {
  const ar = await prisma.approval_request.findFirst({
    where: { approvable_id, status: 0 },
  });
  return ar ? JSON.parse(JSON.stringify(ar)) : null;
}
