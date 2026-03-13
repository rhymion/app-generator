import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/setting2/FormUpsert';
import { getSetting2NewPageAccessCheck } from '@/lib/setting2/getters';

export default function AddSetting2Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Setting2NewContent />
    </Suspense>
  );
}

async function Setting2NewContent() {
  const userPermissions = await getSetting2NewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
