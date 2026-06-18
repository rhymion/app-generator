import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/approval_flow/FormUpsert';
import { searchApprovalFlowOptions } from '@/lib/approval_flow/getters';
import { searchRoleOptions } from '@/lib/role/getters';
import { getApprovalFlowNewPageAccessCheck } from '@/lib/approval_flow/getters';

export default function AddApprovalFlowPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ApprovalFlowNewContent />
    </Suspense>
  );
}

async function ApprovalFlowNewContent() {
  const [userPermissions, initialApprovalFlows, initialRoles] = await Promise.all([
    getApprovalFlowNewPageAccessCheck(),
    searchApprovalFlowOptions('', [], 50),
    searchRoleOptions('', [], 50),
  ]);
  const src = {
    id: '',
    entity_name: '',
    requestor_role_id: '',
    approver_role_id: '',
    preceded_by: [],
    followed_by: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialApprovalFlows={ initialApprovalFlows } searchApprovalFlowOptions={ searchApprovalFlowOptions } initialRoles={ initialRoles } searchRoleOptions={ searchRoleOptions } />;
}
