import FormUpsert from '@/components/setting/FormUpsert';
import { getSettingDetailPageData } from '@/lib/setting/getters';
import { SettingDetailPageProps } from '@/lib/setting/types';
import { notFound } from 'next/navigation';

export default async function EditSettingPage({ params }: SettingDetailPageProps) {
  const { id } = await params;
  const detail = await getSettingDetailPageData(id, 'update');
  if (!detail.setting) {
    notFound();
  }
  return <FormUpsert src={detail.setting} isEdit={true} permissions={detail.userPermissions} />;
}
