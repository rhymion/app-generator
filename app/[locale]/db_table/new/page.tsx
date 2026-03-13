import { Suspense } from 'react';
import Loading from '@/app/[locale]/loading';
import FormUpsert from '@/components/db_table/FormUpsert';
import { getDbTableNewPageAccessCheck } from '@/lib/db_table/getters';

export default function AddDbTablePage() {
  return (
    <Suspense fallback={<Loading />}>
      <DbTableNewContent />
    </Suspense>
  );
}

async function DbTableNewContent() {
  const userPermissions = await getDbTableNewPageAccessCheck();
  const src = {
    id: '',
    name: '',
    description: '',
    fields: [],
    db_table_comments: [],
  };
  return <FormUpsert src={src} isEdit={false} permissions={userPermissions} />;
}
