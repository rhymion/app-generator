import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/organization/FormUpsert';
import { searchUserOptions } from '@/lib/user/getters';
import { getOrganizationNewPageAccessCheck } from '@/lib/organization/getters';

export default function AddOrganizationPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <OrganizationNewContent />
    </Suspense>
  );
}

async function OrganizationNewContent() {
  const [userPermissions, initialUsers] = await Promise.all([
    getOrganizationNewPageAccessCheck(),
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
