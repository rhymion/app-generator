import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/setting1/FormUpsert';
import { getSetting1NewPageAccessCheck } from '@/lib/setting1/getters';

export default function AddSetting1Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Setting1NewContent />
    </Suspense>
  );
}

async function Setting1NewContent() {
  const userPermissions = await getSetting1NewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    team: '',
    yyyyy_yyyyys: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
