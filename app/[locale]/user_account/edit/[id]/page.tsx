import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/user_account/FormUpsert';
import { getUserAccountDetailPageData } from '@/lib/user_account/getters';
import { getRoleListPageData } from '@/lib/role/getters';
import { UserAccountDetailPageProps } from '@/lib/user_account/types';
import { notFound } from 'next/navigation';

export default async function EditUserAccountPage({ params }: UserAccountDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <UserAccountEditContent id={id} />
    </Suspense>
  );
}

async function UserAccountEditContent({ id }: { id: string }) {
  const [detail, rolesData] = await Promise.all([
    getUserAccountDetailPageData(id, 'update'),
    getRoleListPageData(false),
  ]);
  if (!detail.userAccount) {
    notFound();
  }
  return <FormUpsert src={detail.userAccount} isEdit={true} permissions={detail.userPermissions} allRoles={rolesData.roles} rolePermissions={rolesData.userPermissions} />;
}
