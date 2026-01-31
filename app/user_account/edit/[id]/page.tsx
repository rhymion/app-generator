import FormUpsert from '@/components/user_account/FormUpsert';
import { getUserAccountDetail } from '@/lib/user_account/getters';
import { getAllRoles } from '@/lib/role/getters';
import { UserAccountDetailPageProps } from '@/lib/user_account/types';
import { notFound } from 'next/navigation';

export default async function EditUserAccountPage({ params }: UserAccountDetailPageProps) {
  const { id } = await params;
  const [user_account, allRoles] = await Promise.all([
    getUserAccountDetail(id),
    getAllRoles(),
  ]);
  if (!user_account) {
    notFound();
  }
  return <FormUpsert src={user_account} isEdit={true} allRoles={allRoles} />;
}
