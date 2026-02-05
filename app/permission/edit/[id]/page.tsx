import FormUpsert from '@/components/permission/FormUpsert';
import { getPermissionDetailPageData } from '@/lib/permission/getters';
import { getRoleListPageData } from '@/lib/role/getters';
import { PermissionDetailPageProps } from '@/lib/permission/types';
import { notFound } from 'next/navigation';

export default async function EditPermissionPage({ params }: PermissionDetailPageProps) {
  const { id } = await params;
  const [detail, rolesData] = await Promise.all([
    getPermissionDetailPageData(id, 'update'),
    getRoleListPageData(false),
  ]);
  if (!detail.permission) {
    notFound();
  }
  return <FormUpsert src={detail.permission} isEdit={true} allRoles={rolesData.roles} rolePermissions={rolesData.userPermissions} />;
}
