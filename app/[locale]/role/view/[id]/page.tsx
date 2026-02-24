import FormView from '@/components/role/FormView';
import { getRoleDetailPageData } from '@/lib/role/getters';
import { RoleDetailPageProps } from '@/lib/role/types';
import { notFound } from 'next/navigation';

export default async function ViewRolePage({ params }: RoleDetailPageProps) {
  const { id } = await params;
  const { role, userPermissions } = await getRoleDetailPageData(id);
  if (!role) {
    notFound();
  }
  return <FormView src={role} permissions={userPermissions} />;
}
