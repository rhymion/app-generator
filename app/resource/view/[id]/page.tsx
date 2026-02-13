import FormView from '@/components/resource/FormView';
import { getResourceDetailPageData } from '@/lib/resource/getters';
import { ResourceDetailPageProps } from '@/lib/resource/types';
import { notFound } from 'next/navigation';

export default async function ViewResourcePage({ params }: ResourceDetailPageProps) {
  const { id } = await params;
  const { resource, userPermissions } = await getResourceDetailPageData(id);
  if (!resource) {
    notFound();
  }
  return <FormView src={resource} permissions={userPermissions} />;
}
