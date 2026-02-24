import FormView from '@/components/setting1/FormView';
import { getSetting1DetailPageData } from '@/lib/setting1/getters';
import { Setting1DetailPageProps } from '@/lib/setting1/types';
import { notFound } from 'next/navigation';

export default async function ViewSetting1Page({ params }: Setting1DetailPageProps) {
  const { id } = await params;
  const { setting1, userPermissions } = await getSetting1DetailPageData(id);
  if (!setting1) {
    notFound();
  }
  return <FormView src={setting1} permissions={userPermissions} />;
}
