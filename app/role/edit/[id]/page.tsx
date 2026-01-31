import FormUpsert from '@/components/role/FormUpsert';
import { getRoleDetail } from '@/lib/role/getters';
import { RoleDetailPageProps } from '@/lib/role/types';
import { notFound } from 'next/navigation';

export default async function EditRolePage({ params }: RoleDetailPageProps) {
  const { id } = await params;
  const role = await getRoleDetail(id);
  if (!role) {
    notFound();
  }
  return <FormUpsert src={role} isEdit={true} />;
}
