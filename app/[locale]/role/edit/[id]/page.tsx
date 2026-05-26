import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/role/FormUpsert';
import { getRoleDetailPageData } from '@/lib/role/getters';
import { searchUserOptions } from '@/lib/user/getters';
import { RoleDetailPageProps } from '@/lib/role/types';
import { notFound } from 'next/navigation';

export default async function EditRolePage({ params }: RoleDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <RoleEditContent id={id} />
    </Suspense>
  );
}

async function RoleEditContent({ id }: { id: string }) {
  const [detail, initialUsers] = await Promise.all([
    getRoleDetailPageData(id, 'update'),
    searchUserOptions('', [], 50),
  ]);
  if (!detail.role) {
    notFound();
  }
  return <FormUpsert src={detail.role} isEdit={true} permissions={detail.userPermissions} initialUsers={ initialUsers } searchUserOptions={ searchUserOptions } />;
}
