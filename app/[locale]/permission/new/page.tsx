import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/permission/FormUpsert';
import { searchRoleOptions } from '@/lib/role/getters';
import { getPermissionNewPageAccessCheck } from '@/lib/permission/getters';

export default function AddPermissionPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <PermissionNewContent />
    </Suspense>
  );
}

async function PermissionNewContent() {
  const [userPermissions, initialRoles] = await Promise.all([
    getPermissionNewPageAccessCheck(),
    searchRoleOptions('', [], 50),
  ]);
  const src = {
    id: '',
    name: '',
    create: false,
    read: false,
    update: false,
    delete: false,
    role_id: '',
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} initialRoles={ initialRoles } searchRoleOptions={ searchRoleOptions } />;
}
