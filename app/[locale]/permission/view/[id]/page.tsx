import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/permission/FormView';
import { getPermissionDetailPageData } from '@/lib/permission/getters';
import { PermissionDetailPageProps } from '@/lib/permission/types';
import { notFound } from 'next/navigation';

export default async function ViewPermissionPage({ params }: PermissionDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <PermissionViewContent id={id} />
    </Suspense>
  );
}

async function PermissionViewContent({ id }: { id: string }) {
  const { permission, userPermissions } = await getPermissionDetailPageData(id);
  if (!permission) {
    notFound();
  }
  return <FormView src={permission} permissions={userPermissions} />;
}
