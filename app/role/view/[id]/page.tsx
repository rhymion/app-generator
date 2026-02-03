import FormView from '@/components/role/FormView';
import { getRoleDetailPageData } from '@/lib/role/getters';
import { RoleDetailPageProps } from '@/lib/role/types';
import { notFound } from 'next/navigation';

export default async function ViewRolePage({ params }: RoleDetailPageProps) {
  const { id } = await params;
  const data = await getRoleDetailPageData(id);
  if (!data) {
    notFound();
  }
  return <FormView src={data.role} permissions={data.permissions} />;
}
