import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/xxxxx_xxxxx/FormUpsert';
import { getXxxxxXxxxxNewPageAccessCheck } from '@/lib/xxxxx_xxxxx/getters';

export default function AddXxxxxXxxxxPage() {
  return (
    <Suspense fallback={<Loading />}>
      <XxxxxXxxxxNewContent />
    </Suspense>
  );
}

async function XxxxxXxxxxNewContent() {
  const userPermissions = await getXxxxxXxxxxNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    team: '',
    yyyyy_yyyyys: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
