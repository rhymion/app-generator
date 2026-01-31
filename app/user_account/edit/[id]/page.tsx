import FormUpsert from '@/components/user_account/FormUpsert';
import { getUserAccountDetail } from '@/lib/user_account/getters';
import { UserAccountDetailPageProps } from '@/lib/user_account/types';
import { notFound } from 'next/navigation';

export default async function EditUserAccountPage({ params }: UserAccountDetailPageProps) {
  const { id } = await params;
  const user_account = await getUserAccountDetail(id);
  if (!user_account) {
    notFound();
  }
  return <FormUpsert src={user_account} isEdit={true} />;
}
