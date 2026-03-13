import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/setting5/FormUpsert';
import { getSetting5DetailPageData } from '@/lib/setting5/getters';
import { Setting5DetailPageProps } from '@/lib/setting5/types';
import { notFound } from 'next/navigation';

export default async function EditSetting5Page({ params }: Setting5DetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <Setting5EditContent id={id} />
    </Suspense>
  );
}

async function Setting5EditContent({ id }: { id: string }) {
  const detail = await getSetting5DetailPageData(id, 'update');
  if (!detail.setting5) {
    notFound();
  }
  return <FormUpsert src={detail.setting5} isEdit={true} permissions={detail.userPermissions} />;
}
