import FormView from '@/components/permission/FormView';
import { getPermissionDetailPageData } from '@/lib/permission/getters';
import { PermissionDetailPageProps } from '@/lib/permission/types';
import { notFound } from 'next/navigation';

export default async function ViewPermissionPage({ params }: PermissionDetailPageProps) {
  const { id } = await params;
  const { permission, userPermissions } = await getPermissionDetailPageData(id);
  if (!permission) {
    notFound();
  }
  return <FormView src={permission} permissions={userPermissions} />;
}
