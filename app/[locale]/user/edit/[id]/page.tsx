import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/user/FormUpsert';
import { getUserDetailPageData } from '@/lib/user/getters';
import { searchRoleOptions } from '@/lib/role/getters';
import { UserDetailPageProps } from '@/lib/user/types';
import { notFound } from 'next/navigation';

export default async function EditUserPage({ params }: UserDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <UserEditContent id={id} />
    </Suspense>
  );
}

async function UserEditContent({ id }: { id: string }) {
  const [detail, initialRoles] = await Promise.all([
    getUserDetailPageData(id, 'update'),
    searchRoleOptions('', [], 50),
  ]);
  if (!detail.user) {
    notFound();
  }
  return <FormUpsert src={detail.user} isEdit={true} permissions={detail.userPermissions} initialRoles={ initialRoles } searchRoleOptions={ searchRoleOptions } />;
}
