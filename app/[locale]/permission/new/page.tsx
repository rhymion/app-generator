import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/permission/FormUpsert';
import { getRoleListPageData } from '@/lib/role/getters';
import { getPermissionNewPageAccessCheck } from '@/lib/permission/getters';

export default function AddPermissionPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <PermissionNewContent />
    </Suspense>
  );
}

async function PermissionNewContent() {
  const [userPermissions, rolesData] = await Promise.all([
    getPermissionNewPageAccessCheck(),
    getRoleListPageData(false),
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
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} allRoles={rolesData.roles} rolePermissions={rolesData.userPermissions} />;
}
