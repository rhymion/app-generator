import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormView from '@/components/setting/FormView';
import { getSettingDetailPageData } from '@/lib/setting/getters';
import { SettingDetailPageProps } from '@/lib/setting/types';
import { notFound } from 'next/navigation';

export default async function ViewSettingPage({ params }: SettingDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <SettingViewContent id={id} />
    </Suspense>
  );
}

async function SettingViewContent({ id }: { id: string }) {
  const { setting, userPermissions } = await getSettingDetailPageData(id);
  if (!setting) {
    notFound();
  }
  return <FormView src={setting} permissions={userPermissions} />;
}
