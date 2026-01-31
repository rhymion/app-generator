import FormUpsert from '@/components/role/FormUpsert';
import { getRoleDetail } from '@/lib/role/getters';
import { getAllUserAccounts } from '@/lib/user_account/getters';
import { RoleDetailPageProps } from '@/lib/role/types';
import { notFound } from 'next/navigation';

export default async function EditRolePage({ params }: RoleDetailPageProps) {
  const { id } = await params;
  const [role, allUserAccounts] = await Promise.all([
    getRoleDetail(id),
    getAllUserAccounts(),
  ]);
  if (!role) {
    notFound();
  }
  return <FormUpsert src={role} isEdit={true} allUserAccounts={allUserAccounts} />;
}
