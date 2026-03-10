import FormView from '@/components/setting/FormView';
import { getSettingDetailPageData } from '@/lib/setting/getters';
import { SettingDetailPageProps } from '@/lib/setting/types';
import { notFound } from 'next/navigation';

export default async function ViewSettingPage({ params }: SettingDetailPageProps) {
  const { id } = await params;
  const { setting, userPermissions } = await getSettingDetailPageData(id);
  if (!setting) {
    notFound();
  }
  return <FormView src={setting} permissions={userPermissions} />;
}
