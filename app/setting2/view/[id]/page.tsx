import FormView from '@/components/setting2/FormView';
import { getSetting2DetailPageData } from '@/lib/setting2/getters';
import { Setting2DetailPageProps } from '@/lib/setting2/types';
import { notFound } from 'next/navigation';

export default async function ViewSetting2Page({ params }: Setting2DetailPageProps) {
  const { id } = await params;
  const { setting2, userPermissions } = await getSetting2DetailPageData(id);
  if (!setting2) {
    notFound();
  }
  return <FormView src={setting2} permissions={userPermissions} />;
}
