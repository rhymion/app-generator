import FormView from '@/components/permission/FormView';
import { getPermissionDetail } from '@/lib/permission/getters';
import { PermissionDetailPageProps } from '@/lib/permission/types';
import { notFound } from 'next/navigation';

export default async function ViewPermissionPage({ params }: PermissionDetailPageProps) {
  const { id } = await params;
  const permission = await getPermissionDetail(id);
  if (!permission) {
    notFound();
  }
  return <FormView src={permission} />;
}
