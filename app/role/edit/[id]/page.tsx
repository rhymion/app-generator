import FormUpsert from '@/components/role/FormUpsert';
import { getRoleEditPageData } from '@/lib/role/getters';
import { RoleDetailPageProps } from '@/lib/role/types';
import { notFound } from 'next/navigation';

export default async function EditRolePage({ params }: RoleDetailPageProps) {
  const { id } = await params;
  const data = await getRoleEditPageData(id);
  if (!data) {
    notFound();
  }
  return <FormUpsert src={data.role} isEdit={true} allUserAccounts={data.allUserAccounts} />;
}
