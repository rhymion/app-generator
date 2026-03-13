import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/setting8/FormUpsert';
import { getSetting8NewPageAccessCheck } from '@/lib/setting8/getters';

export default function AddSetting8Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Setting8NewContent />
    </Suspense>
  );
}

async function Setting8NewContent() {
  const userPermissions = await getSetting8NewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
