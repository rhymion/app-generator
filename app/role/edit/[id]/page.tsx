import FormUpsert from '@/components/role/FormUpsert';
import { getRoleDetailPageData } from '@/lib/role/getters';
import { getUserAccountListPageData } from '@/lib/user_account/getters';
import { RoleDetailPageProps } from '@/lib/role/types';
import { notFound } from 'next/navigation';

export default async function EditRolePage({ params }: RoleDetailPageProps) {
  const { id } = await params;
  const [detail, userAccountsData] = await Promise.all([
    getRoleDetailPageData(id, 'update'),
    getUserAccountListPageData(false),
  ]);
  if (!detail.role) {
    notFound();
  }
  return <FormUpsert src={detail.role} isEdit={true} allUserAccounts={userAccountsData.userAccounts} userAccountPermissions={userAccountsData.userPermissions} />;
}
