import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/parent_only/FormUpsert';
import { getParentOnlyNewPageAccessCheck } from '@/lib/parent_only/getters';

export default function AddParentOnlyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ParentOnlyNewContent />
    </Suspense>
  );
}

async function ParentOnlyNewContent() {
  const userPermissions = await getParentOnlyNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    login_time: null,
    logout_time: null,
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
