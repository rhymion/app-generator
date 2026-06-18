import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/plan/FormUpsert';
import { searchUserOptions } from '@/lib/user/getters';
import { getPlanNewPageAccessCheck } from '@/lib/plan/getters';

export default function AddPlanPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <PlanNewContent />
    </Suspense>
  );
}

async function PlanNewContent() {
  const [userPermissions, initialUsers] = await Promise.all([
    getPlanNewPageAccessCheck(),
    searchUserOptions('', [], 50),
  ]);
  const src = {
    id: '',
    tier: null,
    reaction_kinds_allowed: null,
    sub_account_limit: null,
    can_view_paid_posts: false,
    users: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialUsers={ initialUsers } searchUserOptions={ searchUserOptions } />;
}
