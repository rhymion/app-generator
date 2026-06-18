import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/approval_flow/FormView';
import { getApprovalFlowDetailPageData } from '@/lib/approval_flow/getters';
import { ApprovalFlowDetailPageProps } from '@/lib/approval_flow/types';
import { notFound } from 'next/navigation';

export default async function ViewApprovalFlowPage({ params }: ApprovalFlowDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ApprovalFlowViewContent id={id} />
    </Suspense>
  );
}

async function ApprovalFlowViewContent({ id }: { id: string }) {
  const { approvalFlow, userPermissions } = await getApprovalFlowDetailPageData(id);
  if (!approvalFlow) {
    notFound();
  }
  return <FormView src={approvalFlow} permissions={userPermissions} />;
}
