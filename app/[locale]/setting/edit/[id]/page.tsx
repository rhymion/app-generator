import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/setting/FormUpsert';
import { getSettingDetailPageData } from '@/lib/setting/getters';
import { getRoleListPageData } from '@/lib/role/getters';
import { SettingDetailPageProps } from '@/lib/setting/types';
import { notFound } from 'next/navigation';

export default async function EditSettingPage({ params }: SettingDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <SettingEditContent id={id} />
    </Suspense>
  );
}

async function SettingEditContent({ id }: { id: string }) {
  const [detail, rolesData] = await Promise.all([
    getSettingDetailPageData(id, 'update'),
    getRoleListPageData(false),
  ]);
  if (!detail.setting) {
    notFound();
  }
  return <FormUpsert src={detail.setting} isEdit={true} permissions={detail.userPermissions} allRoles={rolesData.roles} rolePermissions={rolesData.userPermissions} />;
}
