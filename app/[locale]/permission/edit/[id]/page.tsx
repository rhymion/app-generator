import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/permission/FormUpsert';
import { getPermissionDetailPageData } from '@/lib/permission/getters';
import { getRoleListPageData } from '@/lib/role/getters';
import { PermissionDetailPageProps } from '@/lib/permission/types';
import { notFound } from 'next/navigation';

export default async function EditPermissionPage({ params }: PermissionDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <PermissionEditContent id={id} />
    </Suspense>
  );
}

async function PermissionEditContent({ id }: { id: string }) {
  const [detail, rolesData] = await Promise.all([
    getPermissionDetailPageData(id, 'update'),
    getRoleListPageData(false),
  ]);
  if (!detail.permission) {
    notFound();
  }
  return <FormUpsert src={detail.permission} isEdit={true} permissions={detail.userPermissions} allRoles={rolesData.roles} rolePermissions={rolesData.userPermissions} />;
}
