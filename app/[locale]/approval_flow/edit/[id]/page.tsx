import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/approval_flow/FormUpsert';
import { getApprovalFlowDetailPageData } from '@/lib/approval_flow/getters';
import { searchApprovalFlowOptions } from '@/lib/approval_flow/getters';
import { searchRoleOptions } from '@/lib/role/getters';
import { ApprovalFlowDetailPageProps } from '@/lib/approval_flow/types';
import { notFound } from 'next/navigation';

export default async function EditApprovalFlowPage({ params }: ApprovalFlowDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ApprovalFlowEditContent id={id} />
    </Suspense>
  );
}

async function ApprovalFlowEditContent({ id }: { id: string }) {
  const [detail, initialApprovalFlows, initialRoles] = await Promise.all([
    getApprovalFlowDetailPageData(id, 'update'),
    searchApprovalFlowOptions('', [], 50),
    searchRoleOptions('', [], 50),
  ]);
  if (!detail.approvalFlow) {
    notFound();
  }
  return <FormUpsert src={detail.approvalFlow} isEdit={true} permissions={detail.userPermissions} initialApprovalFlows={ initialApprovalFlows } searchApprovalFlowOptions={ searchApprovalFlowOptions } initialRoles={ initialRoles } searchRoleOptions={ searchRoleOptions } />;
}
