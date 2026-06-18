import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/role/FormUpsert';
import { searchUserOptions } from '@/lib/user/getters';
import { getRoleNewPageAccessCheck } from '@/lib/role/getters';

export default function AddRolePage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <RoleNewContent />
    </Suspense>
  );
}

async function RoleNewContent() {
  const [userPermissions, initialUsers] = await Promise.all([
    getRoleNewPageAccessCheck(),
    searchUserOptions('', [], 50),
  ]);
  const src = {
    id: '',
    name: '',
    description: '',
    users: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialUsers={ initialUsers } searchUserOptions={ searchUserOptions } />;
}
