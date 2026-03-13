import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/setting7/FormUpsert';
import { getSetting7DetailPageData } from '@/lib/setting7/getters';
import { Setting7DetailPageProps } from '@/lib/setting7/types';
import { notFound } from 'next/navigation';

export default async function EditSetting7Page({ params }: Setting7DetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <Setting7EditContent id={id} />
    </Suspense>
  );
}

async function Setting7EditContent({ id }: { id: string }) {
  const detail = await getSetting7DetailPageData(id, 'update');
  if (!detail.setting7) {
    notFound();
  }
  return <FormUpsert src={detail.setting7} isEdit={true} permissions={detail.userPermissions} />;
}
