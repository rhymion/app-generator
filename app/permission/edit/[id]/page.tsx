import FormUpsert from '@/components/permission/FormUpsert';
import { getPermissionDetail } from '@/lib/permission/getters';
import { getAllRoles } from '@/lib/role/getters';
import { PermissionDetailPageProps } from '@/lib/permission/types';
import { notFound } from 'next/navigation';

export default async function EditPermissionPage({ params }: PermissionDetailPageProps) {
  const { id } = await params;
  const [permission, allRoles] = await Promise.all([
    getPermissionDetail(id),
    getAllRoles(),
  ]);
  if (!permission) {
    notFound();
  }
  return <FormUpsert src={permission} isEdit={true} allRoles={allRoles} />;
}
