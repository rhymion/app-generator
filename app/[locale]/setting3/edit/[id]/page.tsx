import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/setting3/FormUpsert';
import { getSetting3DetailPageData } from '@/lib/setting3/getters';
import { Setting3DetailPageProps } from '@/lib/setting3/types';
import { notFound } from 'next/navigation';

export default async function EditSetting3Page({ params }: Setting3DetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading />}>
      <Setting3EditContent id={id} />
    </Suspense>
  );
}

async function Setting3EditContent({ id }: { id: string }) {
  const detail = await getSetting3DetailPageData(id, 'update');
  if (!detail.setting3) {
    notFound();
  }
  return <FormUpsert src={detail.setting3} isEdit={true} permissions={detail.userPermissions} />;
}
