import FormUpsert from '@/components/setting1/FormUpsert';
import { getSetting1DetailPageData } from '@/lib/setting1/getters';
import { Setting1DetailPageProps } from '@/lib/setting1/types';
import { notFound } from 'next/navigation';

export default async function EditSetting1Page({ params }: Setting1DetailPageProps) {
  const { id } = await params;
  const detail = await getSetting1DetailPageData(id, 'update');
  if (!detail.setting1) {
    notFound();
  }
  return <FormUpsert src={detail.setting1} isEdit={true} permissions={detail.userPermissions} />;
}
