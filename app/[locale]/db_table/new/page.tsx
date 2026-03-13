import { Suspense } from 'react';
import FormSkeleton from '@/components/_standard/FormSkeleton';
import FormUpsert from '@/components/db_table/FormUpsert';
import { getDbTableNewPageAccessCheck } from '@/lib/db_table/getters';

export default function AddDbTablePage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
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
