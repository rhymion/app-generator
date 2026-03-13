import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/setting7/FormUpsert';
import { getSetting7NewPageAccessCheck } from '@/lib/setting7/getters';

export default function AddSetting7Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Setting7NewContent />
    </Suspense>
  );
}

async function Setting7NewContent() {
  const userPermissions = await getSetting7NewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    team: '',
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
